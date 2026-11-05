import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { TenantLoaderService } from "../config/tenant-loader.service.js";

@Injectable()
export class MetricsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: TenantLoaderService,
  ) {}

  async get(tenantId: string) {
    this.tenants.get(tenantId);

    const {
      rows: [conv],
    } = await this.db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE 'qualificado' = ANY(tags))::int AS qualificados,
         COUNT(*) FILTER (WHERE status = 'humano')::int AS transferidos
       FROM conversations WHERE tenant_id = $1`,
      [tenantId],
    );

    const {
      rows: [turns],
    } = await this.db.query(
      `SELECT
         COALESCE(SUM(custo),0) AS custo_total,
         COALESCE(SUM(tokens_input),0)::int AS tokens_input,
         COALESCE(SUM(tokens_output),0)::int AS tokens_output,
         COALESCE(AVG(latencia_ms),0)::int AS latencia_media,
         COUNT(*)::int AS turnos
       FROM turns WHERE tenant_id = $1 AND status = 'concluido'`,
      [tenantId],
    );

    const total = conv.total || 0;
    return {
      tenant_id: tenantId,
      total_conversas: total,
      turnos_concluidos: turns.turnos,
      custo_total: Number(turns.custo_total),
      custo_medio_por_conversa:
        total > 0 ? Number(turns.custo_total) / total : 0,
      percentual_qualificados: total > 0 ? conv.qualificados / total : 0,
      percentual_transferidos: total > 0 ? conv.transferidos / total : 0,
      tokens_input_total: turns.tokens_input,
      tokens_output_total: turns.tokens_output,
      latencia_media_ms: turns.latencia_media,
      definicoes: {
        custo_medio_por_conversa:
          "soma(custo dos turnos) / total de conversas do tenant",
        percentual_qualificados:
          "conversas com tag qualificado / total de conversas",
        percentual_transferidos:
          "conversas em status humano / total de conversas",
      },
    };
  }
}
