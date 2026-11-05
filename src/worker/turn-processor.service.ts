import { Injectable, Logger } from "@nestjs/common";
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
      await this.agent.runTurn({
        turnId,
        tenantId: claim.tenant_id,
        conversationId: claim.id,
        telefone: claim.telefone,
        aiEpoch: claim.ai_epoch,
        simulacao: claim.simulacao,
        messages,
      });

      await this.finalize(
        claim,
        turnId,
        messageIds,
        "concluido",
        Date.now() - startedAt,
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

  private async finalize(
    claim: ClaimedConversation,
    turnId: string,
    messageIds: string[],
    status: "concluido",
    latencia: number,
  ) {
    await this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT ai_epoch, processing_token FROM conversations WHERE id = $1 FOR UPDATE`,
        [claim.id],
      );
      const current = rows[0];

      // só marca mensagens como processadas se ainda somos donos do claim
      if (current.processing_token === claim.processing_token) {
        await client.query(
          `UPDATE messages SET processada = true, turn_id = $2 WHERE id = ANY($1::uuid[])`,
          [messageIds, turnId],
        );

        // limpa debounce se não chegou nada novo
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
        `UPDATE turns SET status = $2, latencia_ms = $3, finalizado_em = now() WHERE id = $1`,
        [turnId, status, latencia],
      );
    });
  }
}
