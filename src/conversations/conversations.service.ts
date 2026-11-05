import { Injectable, Logger, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service.js";
import { TenantLoaderService } from "../config/tenant-loader.service.js";
import { ConversationsRepository } from "./conversations.repository.js";
import { IncomingMessageDto } from "./dto/incoming-message.dto.js";

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly tenants: TenantLoaderService,
    private readonly config: ConfigService,
  ) {}

  async handleIncoming(dto: IncomingMessageDto) {
    const tenant = this.tenants.get(dto.tenant_id);

    const windowMs = Number(this.config.get("BURST_WINDOW_MS", 8000));
    const maxWaitMs = Number(this.config.get("BURST_MAX_WAIT_MS", 20000));
    const autor = dto.autor ?? "lead";
    const simulacao = dto.simulacao === true;

    return this.db.transaction(async (client) => {
      const conv = await this.repo.findOrCreate(
        client,
        tenant.tenant_id,
        dto.telefone,
        simulacao,
      );

      const { inserted } = await this.repo.insertMessage(client, {
        tenantId: tenant.tenant_id,
        conversationId: conv.id,
        messageId: dto.message_id,
        autor,
        texto: dto.texto,
        timestamp: dto.timestamp,
      });

      if (!inserted) {
        return { conversationId: conv.id, duplicated: true };
      }

      if (autor === "humano") {
        await client.query(
          `UPDATE conversations
           SET status = 'humano',
               debounce_until = NULL,
               first_pending_at = NULL,
               ai_epoch = ai_epoch + 1,
               updated_at = now()
           WHERE id = $1`,
          [conv.id],
        );
        return { conversationId: conv.id, duplicated: false };
      }

      if (conv.status === "humano") {
        return { conversationId: conv.id, duplicated: false };
      }

      await this.repo.updateDebounce(client, conv.id, windowMs, maxWaitMs);
      return { conversationId: conv.id, duplicated: false };
    });
  }

  async getHistory(tenantId: string, telefone: string) {
    this.tenants.get(tenantId);
    const conv = await this.repo.find(tenantId, telefone);
    if (!conv) throw new ForbiddenException("conversa não encontrada");

    const [messages, profile, appointments, turns] = await Promise.all([
      this.db.query(
        `SELECT id, autor, texto, timestamp, processada, message_id
         FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC`,
        [conv.id],
      ),
      this.db.query(
        `SELECT ficha FROM lead_profiles WHERE conversation_id = $1`,
        [conv.id],
      ),
      this.db.query(
        `SELECT horario, status FROM appointments WHERE conversation_id = $1 ORDER BY horario`,
        [conv.id],
      ),
      this.db.query(
        `SELECT id, status, modelo, tokens_input, tokens_output, latencia_ms
         FROM turns WHERE conversation_id = $1 ORDER BY iniciado_em DESC LIMIT 5`,
        [conv.id],
      ),
    ]);

    return {
      conversa: {
        id: conv.id,
        tenant_id: conv.tenant_id,
        telefone: conv.telefone,
        status: conv.status,
        estagio: conv.estagio,
        tags: conv.tags,
        simulacao: conv.simulacao,
        ai_epoch: conv.ai_epoch,
      },
      ficha: profile.rows[0]?.ficha ?? {},
      mensagens: messages.rows,
      agendamentos: appointments.rows,
      ultimos_turnos: turns.rows,
    };
  }
}
