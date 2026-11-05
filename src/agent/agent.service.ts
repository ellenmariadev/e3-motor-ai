import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { TenantLoaderService } from "../config/tenant-loader.service.js";
import { LeadsRepository } from "../leads/leads.repository.js";
import { PromptService } from "./prompt.service.js";
import type { LlmProvider, LlmMessage, LlmTool } from "../llm/llm.interface.js";
import { ActionExecutorService } from "../actions/action-executor.service.js";
import { PendingMessage } from "../worker/turn-processor.service.js";
import { ConfigService } from "@nestjs/config";
import { QualificationService } from "../leads/qualification.service.js";

interface TurnInput {
  turnId: string;
  tenantId: string;
  conversationId: string;
  telefone: string;
  aiEpoch: number;
  simulacao: boolean;
  messages: PendingMessage[];
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: TenantLoaderService,
    private readonly leads: LeadsRepository,
    private readonly prompt: PromptService,
    private readonly executor: ActionExecutorService,
    private readonly qualification: QualificationService,
    private readonly config: ConfigService,
    @Inject("LLM_PROVIDER") private readonly llm: LlmProvider,
  ) {}

  async runTurn(input: TurnInput) {
    const tenant = this.tenants.get(input.tenantId);
    const ficha = await this.leads.get(input.conversationId);

    const { rows: hist } = await this.db.query<{
      autor: string;
      texto: string;
    }>(
      `SELECT autor, texto FROM messages
       WHERE conversation_id = $1 ORDER BY timestamp ASC`,
      [input.conversationId],
    );

    const messages: LlmMessage[] = [
      {
        role: "system",
        content: this.prompt.build({
          tenant,
          ficha,
          historico: hist,
          agora: new Date(),
        }),
      },
      {
        role: "user",
        content: input.messages.map((m) => m.texto).join("\n"),
      },
    ];

    const tools: LlmTool[] = this.executor.toolSpecs(tenant);

    const maxIter = Number(this.config.get("MAX_TOOL_ITERATIONS", 6));
    let finalText: string | undefined;
    const usage = {
      provider: "unknown",
      model: "unknown",
      inputTokens: 0,
      outputTokens: 0,
    };

    for (let i = 0; i < maxIter; i++) {
      const resp = await this.llm.call({ messages, tools });
      usage.provider = resp.usage.provider;
      usage.model = resp.usage.model;
      usage.inputTokens += resp.usage.inputTokens;
      usage.outputTokens += resp.usage.outputTokens;

      if (resp.toolCalls && resp.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: resp.text ?? "",
        });
        for (const tc of resp.toolCalls) {
          const result = await this.executor.execute({
            turnId: input.turnId,
            tenant,
            conversationId: input.conversationId,
            aiEpoch: input.aiEpoch,
            simulacao: input.simulacao,
            toolCallId: tc.id,
            ferramenta: tc.name,
            argumentos: tc.arguments,
            pendingMessages: input.messages,
          });
          messages.push({
            role: "tool",
            content: JSON.stringify(result),
            tool_call_id: tc.id,
            name: tc.name,
          });
        }
        continue;
      }

      finalText = resp.text;
      break;
    }

    await this.ensureQualificationActions(input, tenant);

    if (finalText) {
      await this.persistAiMessage(input, finalText);
    }

    return { usage };
  }

  private async ensureQualificationActions(
    input: TurnInput,
    tenant: ReturnType<TenantLoaderService["get"]>,
  ) {
    const ficha = await this.leads.get(input.conversationId);
    const decision = this.qualification.evaluate(ficha, tenant);
    const prefix = `backend-${input.turnId}`;

    if (decision.resultado === "qualificado") {
      await this.executeIfMissing(
        input,
        tenant,
        "adicionar_tag",
        `${prefix}-tag`,
        {
          tag: "qualificado",
        },
      );
      await this.executeIfMissing(
        input,
        tenant,
        "mover_estagio",
        `${prefix}-stage`,
        {
          estagio: "Qualificado",
        },
      );
    } else if (decision.resultado === "desqualificado") {
      await this.executeIfMissing(
        input,
        tenant,
        "adicionar_tag",
        `${prefix}-tag`,
        {
          tag: "desqualificado",
        },
      );
      await this.executeIfMissing(
        input,
        tenant,
        "mover_estagio",
        `${prefix}-stage`,
        {
          estagio: "Desqualificado",
        },
      );
    } else if (decision.resultado === "transferir") {
      await this.executeIfMissing(
        input,
        tenant,
        "adicionar_tag",
        `${prefix}-tag`,
        {
          tag:
            decision.motivo === "cliente-antigo" ? "cliente-antigo" : "duvida",
        },
      );
      await this.executeIfMissing(
        input,
        tenant,
        "transferir_humano",
        `${prefix}-transfer`,
        {
          motivo: decision.motivo ?? "necessita de atendimento humano",
        },
      );
    } else {
      await this.executeIfMissing(
        input,
        tenant,
        "mover_estagio",
        `${prefix}-stage`,
        {
          estagio: "Qualificacao",
        },
      );
    }
  }

  private executeIfMissing(
    input: TurnInput,
    tenant: ReturnType<TenantLoaderService["get"]>,
    ferramenta: string,
    toolCallId: string,
    argumentos: Record<string, string>,
  ) {
    return this.executor.execute({
      turnId: input.turnId,
      tenant,
      conversationId: input.conversationId,
      aiEpoch: input.aiEpoch,
      simulacao: input.simulacao,
      toolCallId,
      ferramenta,
      argumentos,
      pendingMessages: input.messages,
    });
  }

  private async persistAiMessage(input: TurnInput, texto: string) {
    await this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT ai_epoch, status FROM conversations WHERE id = $1 FOR UPDATE`,
        [input.conversationId],
      );
      const c = rows[0];
      if (!c || c.ai_epoch !== input.aiEpoch || c.status !== "ia") return;

      await client.query(
        `INSERT INTO messages
           (tenant_id, conversation_id, message_id, autor, texto, timestamp, processada, turn_id)
         VALUES ($1, $2, $3, 'ia', $4, now(), true, $5)`,
        [
          input.tenantId,
          input.conversationId,
          `ia-${input.turnId}`,
          texto,
          input.turnId,
        ],
      );
    });
  }
}
