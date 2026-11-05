import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

export interface FieldEvidence {
  valor: string;
  trecho: string;
  message_id: string;
}

export type LeadFicha = Record<string, FieldEvidence | undefined>;

@Injectable()
export class LeadsRepository {
  constructor(private readonly db: DatabaseService) {}

  async get(conversationId: string): Promise<LeadFicha> {
    const { rows } = await this.db.query<{ ficha: LeadFicha }>(
      `SELECT ficha FROM lead_profiles WHERE conversation_id = $1`,
      [conversationId],
    );
    return rows[0]?.ficha ?? {};
  }

  async upsertField(
    conversationId: string,
    tenantId: string,
    campo: string,
    evidencia: FieldEvidence,
  ) {
    await this.db.query(
      `INSERT INTO lead_profiles (conversation_id, tenant_id, ficha)
       VALUES ($1, $2, jsonb_build_object($3::text, $4::jsonb))
       ON CONFLICT (conversation_id) DO UPDATE
         SET ficha = lead_profiles.ficha || jsonb_build_object($3::text, $4::jsonb),
             updated_at = now()`,
      [conversationId, tenantId, campo, JSON.stringify(evidencia)],
    );
  }
}
