import { Injectable } from "@nestjs/common";
import { TenantConfig } from "../config/tenant.types.js";
import { LeadFicha } from "./leads.repository.js";

export type QualificationResult =
  "em_qualificacao" | "qualificado" | "desqualificado" | "transferir";

@Injectable()
export class QualificationService {
  evaluate(
    ficha: LeadFicha,
    tenant: TenantConfig,
  ): { resultado: QualificationResult; motivo?: string } {
    const v = (k: string) => ficha[k]?.valor?.toLowerCase().trim();

    // cliente antigo
    if (v("cliente_antigo") === "true" || v("cliente_antigo") === "sim") {
      return { resultado: "transferir", motivo: "cliente-antigo" };
    }

    // cidade não atendida
    const cidade = v("cidade");
    if (cidade) {
      const atendida = tenant.cidades_atendidas.some(
        (c) => c.toLowerCase() === cidade,
      );
      if (!atendida)
        return { resultado: "desqualificado", motivo: "cidade-nao-atendida" };
    }

    // imóvel alugado
    if (v("tipo_imovel") === "alugado") {
      return { resultado: "desqualificado", motivo: "imovel-alugado" };
    }

    // apartamento
    if (v("tipo_residencia") === "apartamento") {
      return { resultado: "desqualificado", motivo: "apartamento" };
    }

    // conta <= 250
    const conta = this.parseConta(ficha["conta_luz"]?.valor);
    if (conta !== null && conta <= 250) {
      return { resultado: "desqualificado", motivo: "conta-baixa" };
    }

    // situação de dúvida explícita
    if (v("situacao_duvida") === "true") {
      return { resultado: "transferir", motivo: "duvida" };
    }

    // campos obrigatórios ausentes
    const obrigatorios = [
      "nome",
      "cidade",
      "tipo_imovel",
      "tipo_residencia",
      "conta_luz",
    ];
    const faltando = obrigatorios.filter((k) => !ficha[k]?.valor);
    if (faltando.length > 0) {
      return {
        resultado: "em_qualificacao",
        motivo: `faltando: ${faltando.join(",")}`,
      };
    }

    // qualificado
    return { resultado: "qualificado" };
  }

  private parseConta(raw?: string): number | null {
    if (!raw) return null;
    const cleaned = raw
      .replace(/[^\d,.]/g, "")
      .replace(".", "")
      .replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
}
