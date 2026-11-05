import { Injectable, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { TenantConfig } from "../config/tenant.types.js";
import { LeadsRepository } from "../leads/leads.repository.js";
import {
  EvidenceValidatorService,
  PendingMessage,
} from "../leads/evidence-validator.service.js";
import {
  hasLiteralValue,
  OWNERSHIP_PATTERN,
  RENTAL_PATTERN,
} from "../leads/evidence-rules.js";
import type { LlmTool } from "../llm/llm.interface.js";

interface ExecuteInput {
  turnId: string;
  tenant: TenantConfig;
  conversationId: string;
  aiEpoch: number;
  simulacao: boolean;
  toolCallId: string;
  ferramenta: string;
  argumentos: Record<string, any>;
  pendingMessages: PendingMessage[];
}

@Injectable()
export class ActionExecutorService {
  constructor(
    private readonly db: DatabaseService,
    private readonly leads: LeadsRepository,
    private readonly evidence: EvidenceValidatorService,
  ) {}

  toolSpecs(tenant: TenantConfig): LlmTool[] {
    return [
      {
        name: "atualizar_ficha",
        description:
          "Grava um campo do lead. Exige trecho literal da mensagem do lead.",
        parameters: {
          type: "object",
          properties: {
            campo: { type: "string" },
            valor: { type: "string" },
            trecho: { type: "string" },
            message_id: {
              type: "string",
              description:
                "ID literal da mensagem do lead; pode ser omitido quando o trecho identificar uma única mensagem.",
            },
          },
          required: ["campo", "valor", "trecho"],
        },
      },
      {
        name: "adicionar_tag",
        description: `Adiciona tag. Permitidas: ${tenant.tags_permitidas.join(", ")}.`,
        parameters: {
          type: "object",
          properties: { tag: { type: "string", enum: tenant.tags_permitidas } },
          required: ["tag"],
        },
      },
      {
        name: "mover_estagio",
        description: "Move o lead no funil.",
        parameters: {
          type: "object",
          properties: { estagio: { type: "string", enum: tenant.estagios } },
          required: ["estagio"],
        },
      },
      {
        name: "consultar_agenda",
        description: "Retorna horários livres nos próximos 7 dias.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "marcar_agenda",
        description:
          "Reserva um horário retornado por consultar_agenda neste mesmo turno.",
        parameters: {
          type: "object",
          properties: { horario: { type: "string" } },
          required: ["horario"],
        },
      },
      {
        name: "notificar_equipe",
        description: "Avisa a equipe de vendas com um resumo.",
        parameters: {
          type: "object",
          properties: { resumo: { type: "string" } },
          required: ["resumo"],
        },
      },
      {
        name: "transferir_humano",
        description: "Transfere para atendimento humano.",
        parameters: {
          type: "object",
          properties: { motivo: { type: "string" } },
          required: ["motivo"],
        },
      },
    ];
  }

  async execute(input: ExecuteInput): Promise<any> {
    const { rows: existing } = await this.db.query(
      `SELECT resultado FROM actions WHERE turn_id = $1 AND tool_call_id = $2`,
      [input.turnId, input.toolCallId],
    );
    if (existing.length > 0) return existing[0].resultado;

    let status: "executada" | "rejeitada" | "erro" = "executada";
    let result: any = {};
    let erro: string | undefined;

    try {
      const { rows } = await this.db.query(
        `SELECT ai_epoch, status FROM conversations WHERE id = $1`,
        [input.conversationId],
      );
      if (rows[0]?.ai_epoch !== input.aiEpoch || rows[0]?.status !== "ia") {
        throw new BadRequestException("turno invalidado (epoch/status)");
      }
      result = await this.dispatch(input);
    } catch (e: any) {
      status = e instanceof BadRequestException ? "rejeitada" : "erro";
      erro = String(e?.message ?? e);
      result = { ok: false, erro };
    }

    await this.db.query(
      `INSERT INTO actions
        (tenant_id, conversation_id, turn_id, tool_call_id, ferramenta, argumentos, resultado, status, simulacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING`,
      [
        input.tenant.tenant_id,
        input.conversationId,
        input.turnId,
        input.toolCallId,
        input.ferramenta,
        JSON.stringify(input.argumentos),
        JSON.stringify(result),
        status,
        input.simulacao,
      ],
    );

    return result;
  }

  private async dispatch(input: ExecuteInput): Promise<any> {
    switch (input.ferramenta) {
      case "atualizar_ficha":
        return this.atualizarFicha(input);
      case "adicionar_tag":
        return this.adicionarTag(input);
      case "mover_estagio":
        return this.moverEstagio(input);
      case "consultar_agenda":
        return this.consultarAgenda(input);
      case "marcar_agenda":
        return this.marcarAgenda(input);
      case "notificar_equipe":
        return this.notificarEquipe(input);
      case "transferir_humano":
        return this.transferirHumano(input);
      default:
        throw new BadRequestException(
          `ferramenta desconhecida: ${input.ferramenta}`,
        );
    }
  }

  private async atualizarFicha(input: ExecuteInput) {
    const { campo, valor, trecho } = input.argumentos;
    if (["nome", "cidade"].includes(campo) && !hasLiteralValue(valor, trecho)) {
      throw new BadRequestException(
        `${campo} exige que o valor apareça literalmente no trecho informado`,
      );
    }
    if (
      campo === "tipo_imovel" &&
      ((valor === "proprio" && !OWNERSHIP_PATTERN.test(trecho)) ||
        (valor === "alugado" && !RENTAL_PATTERN.test(trecho)))
    ) {
      throw new BadRequestException(
        "tipo_imovel exige evidência explícita no trecho informado",
      );
    }
    const messageId =
      input.argumentos.message_id ?? this.findEvidenceMessageId(input, trecho);
    const ficha = await this.leads.get(input.conversationId);
    this.evidence.validate({
      campo,
      valor,
      trecho,
      messageId,
      messages: input.pendingMessages,
      fichaAtual: ficha,
    });
    await this.leads.upsertField(
      input.conversationId,
      input.tenant.tenant_id,
      campo,
      {
        valor,
        trecho,
        message_id: messageId,
      },
    );
    return { ok: true, campo, valor };
  }

  private findEvidenceMessageId(input: ExecuteInput, trecho: string): string {
    const matches = input.pendingMessages.filter(
      (message) =>
        message.autor === "lead" && message.texto.includes(trecho.trim()),
    );
    if (matches.length !== 1) {
      throw new BadRequestException(
        "message_id é obrigatório quando o trecho não identifica uma única mensagem do lead",
      );
    }
    return matches[0].message_id;
  }

  private async adicionarTag(input: ExecuteInput) {
    const { tag } = input.argumentos;
    if (!input.tenant.tags_permitidas.includes(tag)) {
      throw new BadRequestException(`tag inválida: ${tag}`);
    }
    await this.db.query(
      `UPDATE conversations
       SET tags = array_append(tags, $2::text), updated_at = now()
       WHERE id = $1 AND NOT ($2 = ANY(tags))`,
      [input.conversationId, tag],
    );
    return { ok: true, tag };
  }

  private async moverEstagio(input: ExecuteInput) {
    const { estagio } = input.argumentos;
    if (!input.tenant.estagios.includes(estagio)) {
      throw new BadRequestException(`estágio inválido: ${estagio}`);
    }
    await this.db.query(
      `UPDATE conversations SET estagio = $2, updated_at = now() WHERE id = $1`,
      [input.conversationId, estagio],
    );
    return { ok: true, estagio };
  }

  private async consultarAgenda(input: ExecuteInput) {
    const { rows: booked } = await this.db.query(
      `SELECT horario FROM appointments
       WHERE tenant_id = $1 AND horario > now() AND horario < now() + interval '7 days'`,
      [input.tenant.tenant_id],
    );
    const taken = new Set(
      booked.map((r: any) => new Date(r.horario).toISOString()),
    );

    const slots: string[] = [];
    const base = new Date();
    base.setUTCHours(0, 0, 0, 0);
    for (let d = 1; d <= 7 && slots.length < 20; d++) {
      const day = new Date(base.getTime() + d * 86400000);
      const dow = day.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      for (const h of [9, 10, 14, 15, 16]) {
        const dt = new Date(day);
        dt.setUTCHours(h, 0, 0, 0);
        if (dt <= new Date()) continue;
        const iso = dt.toISOString();
        if (!taken.has(iso)) slots.push(iso);
      }
    }

    await this.db.query(
      `UPDATE turns SET acoes = array_append(acoes, $2) WHERE id = $1`,
      [input.turnId, `agenda:${slots.join(",")}`],
    );
    return { ok: true, slots };
  }

  private async marcarAgenda(input: ExecuteInput) {
    const { horario } = input.argumentos;
    const { rows: turn } = await this.db.query(
      `SELECT acoes FROM turns WHERE id = $1`,
      [input.turnId],
    );
    const offered = ((turn[0]?.acoes ?? []) as string[])
      .filter((a) => a.startsWith("agenda:"))
      .flatMap((a) => a.slice("agenda:".length).split(","))
      .filter(Boolean);
    if (!offered.includes(horario)) {
      throw new BadRequestException(
        "horário não foi oferecido por consultar_agenda neste turno",
      );
    }
    const { rows } = await this.db.query(
      `INSERT INTO appointments (tenant_id, conversation_id, horario)
       VALUES ($1,$2,$3) ON CONFLICT (tenant_id, horario) DO NOTHING RETURNING id`,
      [input.tenant.tenant_id, input.conversationId, horario],
    );
    if (rows.length === 0) throw new BadRequestException("horário já ocupado");
    return { ok: true, appointmentId: rows[0].id, horario };
  }

  private async notificarEquipe(input: ExecuteInput) {
    const { resumo } = input.argumentos;
    await this.db.query(
      `INSERT INTO notifications (tenant_id, conversation_id, resumo, simulacao)
       VALUES ($1,$2,$3,$4)`,
      [input.tenant.tenant_id, input.conversationId, resumo, input.simulacao],
    );
    return { ok: true, simulado: input.simulacao };
  }

  private async transferirHumano(input: ExecuteInput) {
    const { motivo } = input.argumentos;
    await this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT ai_epoch FROM conversations WHERE id = $1 FOR UPDATE`,
        [input.conversationId],
      );
      if (rows[0]?.ai_epoch !== input.aiEpoch) {
        throw new BadRequestException("turno invalidado");
      }
      await client.query(
        `UPDATE conversations
         SET status = 'humano', estagio = 'Humano',
             debounce_until = NULL, first_pending_at = NULL,
             ai_epoch = ai_epoch + 1, updated_at = now()
         WHERE id = $1`,
        [input.conversationId],
      );
      await client.query(
        `INSERT INTO notifications (tenant_id, conversation_id, resumo, simulacao)
         VALUES ($1,$2,$3,$4)`,
        [
          input.tenant.tenant_id,
          input.conversationId,
          `Transferência: ${motivo}`,
          input.simulacao,
        ],
      );
    });
    return { ok: true };
  }
}
