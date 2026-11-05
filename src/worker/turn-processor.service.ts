import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service.js";
import { AgentService } from "../agent/agent.service.js";

export interface PendingMessage {
  id: string;
  autor: "lead" | "humano" | "ia";
  texto: string;
  timestamp: Date;
  message_id: string;
}

export interface ClaimedConversation {
  id: string;
  tenant_id: string;
  telefone: string;
  ai_epoch: number;
  processing_token: string;
  simulacao: boolean;
}

@Injectable()
export class TurnProcessorService {
  private readonly logger = new Logger(TurnProcessorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly agent: AgentService,
    private readonly config: ConfigService,
  ) {}

  async process(claim: ClaimedConversation, messages: PendingMessage[]) {
    const turnId = crypto.randomUUID();
    const startedAt = Date.now();
    const messageIds = messages.map((m) => m.id);

    await this.db.query(
      `INSERT INTO turns (id, tenant_id, conversation_id, message_ids, status, iniciado_em)
       VALUES ($1, $2, $3, $4, 'iniciado', now())`,
      [turnId, claim.tenant_id, claim.id, messageIds],
    );

    try {
      const { usage } = await this.agent.runTurn({
        turnId,
        tenantId: claim.tenant_id,
        conversationId: claim.id,
        telefone: claim.telefone,
        aiEpoch: claim.ai_epoch,
        simulacao: claim.simulacao,
        messages,
      });

      await this.ensureClosed(turnId, claim.id);

      await this.finalize(
        claim,
        turnId,
        messageIds,
        "concluido",
        Date.now() - startedAt,
        usage,
      );
    } catch (err) {
      this.logger.error(`turn ${turnId} failed`, err);
      await this.db.query(
        `UPDATE turns SET status = 'falhou', erro = $2, finalizado_em = now()
         WHERE id = $1`,
        [turnId, String(err)],
      );
      // falha do LLM → transfere para humano
      await this.db.transaction(async (client) => {
        const { rows } = await client.query(
          `SELECT ai_epoch FROM conversations WHERE id = $1 FOR UPDATE`,
          [claim.id],
        );
        if (rows[0]?.ai_epoch !== claim.ai_epoch) return;
        await client.query(
          `UPDATE conversations
           SET status = 'humano', debounce_until = NULL, first_pending_at = NULL,
               processing_until = NULL, processing_token = NULL, ai_epoch = ai_epoch + 1
           WHERE id = $1`,
          [claim.id],
        );
      });
    }
  }

  private async ensureClosed(turnId: string, conversationId: string) {
    const { rows } = await this.db.query(
      `SELECT estagio, tags FROM conversations WHERE id = $1`,
      [conversationId],
    );
    const c = rows[0];
    if (!c) return;

    const temTagFinal = (c.tags as string[]).some((t) =>
      ["qualificado", "desqualificado", "cliente-antigo"].includes(t),
    );
    if (!temTagFinal && c.estagio === "Novo") {
      await this.db.query(
        `INSERT INTO actions
           (tenant_id, conversation_id, turn_id, ferramenta, argumentos, resultado, status, simulacao)
         SELECT tenant_id, id, $2, 'mover_estagio',
                '{"estagio":"Humano"}'::jsonb,
                '{"ok":true,"motivo":"backend-forced"}'::jsonb,
                'executada', simulacao
         FROM conversations WHERE id = $1`,
        [conversationId, turnId],
      );
      await this.db.query(
        `UPDATE conversations SET estagio = 'Humano', status = 'humano' WHERE id = $1`,
        [conversationId],
      );
    }
  }

  private async finalize(
    claim: ClaimedConversation,
    turnId: string,
    messageIds: string[],
    status: "concluido",
    latencia: number,
    usage: {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    },
  ) {
    await this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT ai_epoch, processing_token FROM conversations WHERE id = $1 FOR UPDATE`,
        [claim.id],
      );
      const current = rows[0];

      if (current.processing_token === claim.processing_token) {
        await client.query(
          `UPDATE messages SET processada = true, turn_id = $2 WHERE id = ANY($1::uuid[])`,
          [messageIds, turnId],
        );

        const { rows: pending } = await client.query(
          `SELECT 1 FROM messages WHERE conversation_id = $1 AND processada = false LIMIT 1`,
          [claim.id],
        );

        if (pending.length === 0) {
          await client.query(
            `UPDATE conversations
             SET debounce_until = NULL, first_pending_at = NULL,
                 processing_until = NULL, processing_token = NULL, updated_at = now()
             WHERE id = $1`,
            [claim.id],
          );
        } else {
          await client.query(
            `UPDATE conversations
             SET processing_until = NULL, processing_token = NULL, updated_at = now()
             WHERE id = $1`,
            [claim.id],
          );
        }
      }

      await client.query(
        `UPDATE turns
         SET status = $2, provedor = $3, modelo = $4,
             tokens_input = $5, tokens_output = $6,
             custo = $7, latencia_ms = $8, finalizado_em = now()
         WHERE id = $1`,
        [
          turnId,
          status,
          usage.provider,
          usage.model,
          usage.inputTokens,
          usage.outputTokens,
          this.estimateCost(usage),
          latencia,
        ],
      );
    });
  }

  private estimateCost(usage: { inputTokens: number; outputTokens: number }) {
    const inputRate = Number(this.config.get("LLM_INPUT_COST_PER_1K", 0));
    const outputRate = Number(this.config.get("LLM_OUTPUT_COST_PER_1K", 0));
    return (
      (usage.inputTokens / 1000) * inputRate +
      (usage.outputTokens / 1000) * outputRate
    );
  }
}
