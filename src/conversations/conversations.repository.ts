import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service.js";

export interface ConversationRow {
  id: string;
  tenant_id: string;
  telefone: string;
  status: "ia" | "humano";
  estagio: string;
  tags: string[];
  simulacao: boolean;
  ai_epoch: number;
  debounce_until: Date | null;
  first_pending_at: Date | null;
  processing_until: Date | null;
  processing_token: string | null;
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findOrCreate(
    client: PoolClient,
    tenantId: string,
    telefone: string,
    simulacao: boolean,
  ): Promise<ConversationRow> {
    const { rows } = await client.query<ConversationRow>(
      `INSERT INTO conversations (tenant_id, telefone, simulacao)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, telefone) DO UPDATE
         SET simulacao = conversations.simulacao OR EXCLUDED.simulacao
       RETURNING *`,
      [tenantId, telefone, simulacao],
    );
    return rows[0];
  }

  async find(
    tenantId: string,
    telefone: string,
  ): Promise<ConversationRow | null> {
    const { rows } = await this.db.query<ConversationRow>(
      `SELECT * FROM conversations WHERE tenant_id = $1 AND telefone = $2`,
      [tenantId, telefone],
    );
    return rows[0] ?? null;
  }

  async lock(client: PoolClient, id: string): Promise<ConversationRow> {
    const { rows } = await client.query<ConversationRow>(
      `SELECT * FROM conversations WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0];
  }

  async insertMessage(
    client: PoolClient,
    params: {
      tenantId: string;
      conversationId: string;
      messageId: string;
      autor: "lead" | "humano" | "ia";
      texto: string;
      timestamp: string;
    },
  ): Promise<{ inserted: boolean; id?: string }> {
    const { rows } = await client.query(
      `INSERT INTO messages (tenant_id, conversation_id, message_id, autor, texto, timestamp, processada)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, message_id) DO NOTHING
       RETURNING id`,
      [
        params.tenantId,
        params.conversationId,
        params.messageId,
        params.autor,
        params.texto,
        params.timestamp,
        params.autor !== "lead",
      ],
    );
    if (rows.length === 0) return { inserted: false };
    return { inserted: true, id: rows[0].id };
  }

  async updateDebounce(
    client: PoolClient,
    conversationId: string,
    windowMs: number,
    maxWaitMs: number,
  ) {
    await client.query(
      `UPDATE conversations c
       SET debounce_until = LEAST(
             now() + ($2::int * interval '1 millisecond'),
             COALESCE(c.first_pending_at, now()) + ($3::int * interval '1 millisecond')
           ),
           first_pending_at = COALESCE(c.first_pending_at, now()),
           updated_at = now()
       WHERE c.id = $1`,
      [conversationId, windowMs, maxWaitMs],
    );
  }
}
