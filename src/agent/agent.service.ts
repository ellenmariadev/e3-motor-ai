import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { TenantLoaderService } from "../config/tenant-loader.service.js";
import { LeadsRepository } from "../leads/leads.repository.js";
import { PromptService } from "./prompt.service.js";
import type { LlmProvider, LlmMessage, LlmTool } from "../llm/llm.interface.js";
import { ActionExecutorService } from "../actions/action-executor.service.js";
import type { ConversationMessage } from "../conversations/message.types.js";
import { ConfigService } from "@nestjs/config";
import { QualificationService } from "../leads/qualification.service.js";
import { OWNERSHIP_PATTERN, RENTAL_PATTERN } from "../leads/evidence-rules.js";

interface TurnInput {
  turnId: string;
  tenantId: string;
  conversationId: string;
  telefone: string;
  aiEpoch: number;
  simulacao: boolean;
  messages: ConversationMessage[];
}

const EXISTING_CLIENT_PATTERN =
  /\b(já|ja)\s+(sou|fui)\s+cliente\b|\binstalei\s+com\s+voc[eê]s\b/i;
const NAME_CITY_PATTERN =
  /^([A-ZÀ-Ý][\p{L}]+(?:\s+[A-ZÀ-Ý][\p{L}]+)+),\s*(?:de\s+)?([A-ZÀ-Ý][\p{L}]+(?:\s+[A-ZÀ-Ý][\p{L}]+)*)$/u;
const BILL_PATTERN =
  /(?:uns|minha conta(?: de luz)?(?: vem)?)\s*(?:de\s*)?(?:r\$\s*)?(\d+(?:[.,]\d+)?)/i;

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
    await this.extractDeterministicEvidence(input, tenant);
    const ficha = await this.leads.get(input.conversationId);

    const { rows: hist } = await this.db.query<{
      autor: string;
      texto: string;
      message_id: string;
    }>(
      `SELECT autor, texto, message_id FROM messages
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

    const tools: LlmTool[] =
      this.config.get("LLM_DISABLE_TOOLS", "false") === "true"
        ? []
        : this.executor.toolSpecs(tenant);

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
          content: resp.text ?? null,
          tool_calls: resp.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
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

    const qualification = await this.ensureQualificationActions(input, tenant);

    if (
      qualification.resultado === "desqualificado" &&
      (qualification.motivo === "imovel-alugado" ||
        qualification.motivo === "apartamento") &&
      (!finalText ||
        (!finalText.toLowerCase().includes("assinatura") &&
          !finalText.toLowerCase().includes("outra opção")))
    ) {
      finalText =
        "Entendi. Neste caso, existe outra opção possível: energia solar por assinatura, sem instalação. A equipe pode explicar como funciona.";
    }

    if (finalText) {
      await this.persistAiMessage(input, finalText);
    }

    return { usage };
  }

  private async ensureQualificationActions(
    input: TurnInput,
    tenant: ReturnType<TenantLoaderService["get"]>,
  ) {
    await this.extractDeterministicEvidence(input, tenant);
    const ficha = await this.leads.get(input.conversationId);
    const hasExistingClientMessage = input.messages.some(
      (message) =>
        message.autor === "lead" && EXISTING_CLIENT_PATTERN.test(message.texto),
    );
    const hasRentalMessage = input.messages.some(
      (message) =>
        message.autor === "lead" && RENTAL_PATTERN.test(message.texto),
    );
    const decision = hasExistingClientMessage
      ? { resultado: "transferir" as const, motivo: "cliente-antigo" }
      : hasRentalMessage
        ? { resultado: "desqualificado" as const, motivo: "imovel-alugado" }
        : this.qualification.evaluate(ficha, tenant);
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
      const { rows: appointments } = await this.db.query(
        `SELECT 1 FROM appointments WHERE conversation_id = $1 LIMIT 1`,
        [input.conversationId],
      );
      if (appointments.length === 0) {
        const agenda = await this.executeIfMissing(
          input,
          tenant,
          "consultar_agenda",
          `${prefix}-agenda`,
          {},
        );
        const horario = agenda?.slots?.[0];
        if (typeof horario === "string") {
          await this.executeIfMissing(
            input,
            tenant,
            "marcar_agenda",
            `${prefix}-appointment`,
            { horario },
          );
          await this.executeIfMissing(
            input,
            tenant,
            "mover_estagio",
            `${prefix}-stage-scheduled`,
            { estagio: "Agendado" },
          );
          await this.executeIfMissing(
            input,
            tenant,
            "notificar_equipe",
            `${prefix}-notification`,
            {
              resumo: "Lead qualificado com visita técnica agendada.",
            },
          );
        }
      }
      const { rows: scheduled } = await this.db.query(
        `SELECT 1 FROM appointments WHERE conversation_id = $1 LIMIT 1`,
        [input.conversationId],
      );
      if (scheduled.length > 0) {
        await this.executeIfMissing(
          input,
          tenant,
          "mover_estagio",
          `${prefix}-stage-scheduled`,
          {
            estagio: "Agendado",
          },
        );
      } else {
        await this.executeIfMissing(
          input,
          tenant,
          "mover_estagio",
          `${prefix}-stage`,
          {
            estagio: "Qualificado",
          },
        );
      }
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
    return decision;
  }

  private async extractDeterministicEvidence(
    input: TurnInput,
    tenant: ReturnType<TenantLoaderService["get"]>,
  ) {
    const ficha = await this.leads.get(input.conversationId);
    const candidates: Array<{
      campo: string;
      valor: string;
      trecho: string;
      message_id: string;
    }> = [];

    for (const message of input.messages) {
      if (message.autor !== "lead") continue;
      const text = message.texto;
      const add = (campo: string, valor: string, trecho = text) => {
        if (!ficha[campo]?.valor) {
          candidates.push({
            campo,
            valor,
            trecho,
            message_id: message.message_id,
          });
        }
      };

      const nameCity = text.match(NAME_CITY_PATTERN);
      if (nameCity && !/\b(conta|casa|alug|própria|propria)\b/i.test(text)) {
        add("nome", nameCity[1].trim());
        add("cidade", nameCity[2].trim());
      }
      if (OWNERSHIP_PATTERN.test(text)) {
        add("tipo_imovel", "proprio");
      } else if (RENTAL_PATTERN.test(text)) {
        add("tipo_imovel", "alugado");
      }
      if (/\bcasa\b/i.test(text)) add("tipo_residencia", "casa", "casa");
      if (/\bapartamento\b/i.test(text)) {
        add("tipo_residencia", "apartamento", "apartamento");
      }
      const bill = text.match(BILL_PATTERN);
      if (bill) add("conta_luz", bill[1], bill[0]);
      if (/\bfinanciad[oa]\b/i.test(text)) {
        add("forma_pagamento", "financiado", "financiado");
      } else if (/\bà vista\b|\na vista\b/i.test(text)) {
        add("forma_pagamento", "avista", "à vista");
      }
    }

    for (const candidate of candidates) {
      await this.executeIfMissing(
        input,
        tenant,
        "atualizar_ficha",
        `backend-${input.turnId}-evidence-${candidate.campo}`,
        candidate,
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
