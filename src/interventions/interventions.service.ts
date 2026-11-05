import { Injectable, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { TenantLoaderService } from "../config/tenant-loader.service.js";

@Injectable()
export class InterventionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: TenantLoaderService,
  ) {}

  async handle(
    tenantId: string,
    telefone: string,
    acao: "assumir" | "religar",
  ) {
    this.tenants.get(tenantId);

    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM conversations WHERE tenant_id = $1 AND telefone = $2 FOR UPDATE`,
        [tenantId, telefone],
      );
      const conv = rows[0];
      if (!conv) throw new BadRequestException("conversa não encontrada");

      if (acao === "assumir") {
        await client.query(
          `UPDATE conversations
           SET status = 'humano', debounce_until = NULL, first_pending_at = NULL,
               ai_epoch = ai_epoch + 1, updated_at = now()
           WHERE id = $1`,
          [conv.id],
        );
      } else {
        await client.query(
          `UPDATE conversations
           SET status = 'ia', ai_epoch = ai_epoch + 1, updated_at = now()
           WHERE id = $1`,
          [conv.id],
        );
        // re-agenda processamento das pendentes
        await client.query(
          `UPDATE conversations SET debounce_until = now()
           WHERE id = $1 AND EXISTS (
             SELECT 1 FROM messages WHERE conversation_id = $1 AND processada = false
           )`,
          [conv.id],
        );
      }

      await client.query(
        `INSERT INTO interventions (tenant_id, conversation_id, acao)
         VALUES ($1, $2, $3)`,
        [tenantId, conv.id, acao],
      );

      return { ok: true, status: acao === "assumir" ? "humano" : "ia" };
    });
  }
}
