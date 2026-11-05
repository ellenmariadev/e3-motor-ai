import { Injectable, BadRequestException } from "@nestjs/common";

const CAMPOS_PERMITIDOS = new Set([
  "nome",
  "cidade",
  "tipo_imovel", // 'proprio' | 'alugado'
  "tipo_residencia", // 'casa' | 'apartamento'
  "conta_luz",
  "forma_pagamento", // 'financiado' | 'avista'
  "cliente_antigo",
]);

export interface PendingMessage {
  id: string;
  autor: "lead" | "humano" | "ia";
  texto: string;
}

@Injectable()
export class EvidenceValidatorService {
  validate(params: {
    campo: string;
    valor: string;
    trecho: string;
    messageId: string;
    messages: PendingMessage[];
    fichaAtual: Record<string, { valor: string } | undefined>;
  }) {
    const { campo, valor, trecho, messageId, messages, fichaAtual } = params;

    if (!CAMPOS_PERMITIDOS.has(campo)) {
      throw new BadRequestException(`campo não permitido: ${campo}`);
    }

    const msg = messages.find((m) => m.id === messageId);
    if (!msg) {
      throw new BadRequestException(
        `message_id ${messageId} não pertence ao lote`,
      );
    }
    if (msg.autor !== "lead") {
      throw new BadRequestException(
        `evidência precisa vir do lead, não de '${msg.autor}'`,
      );
    }

    const normalizedTrecho = trecho.trim();
    if (
      normalizedTrecho.length === 0 ||
      !msg.texto.includes(normalizedTrecho)
    ) {
      throw new BadRequestException(
        `trecho não encontrado na mensagem ${messageId}`,
      );
    }

    const anterior = fichaAtual[campo];
    if (anterior && anterior.valor && anterior.valor !== valor) {
      throw new BadRequestException(
        `conflito com valor já confirmado em '${campo}': '${anterior.valor}'`,
      );
    }

    return true;
  }
}
