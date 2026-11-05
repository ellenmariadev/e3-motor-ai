import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  async runTurn(input: {
    turnId: string;
    tenantId: string;
    conversationId: string;
    telefone: string;
    aiEpoch: number;
    simulacao: boolean;
    messages: Array<{
      id: string;
      autor: string;
      texto: string;
      timestamp: Date;
      message_id: string;
    }>;
  }): Promise<void> {
    // TEMP
    this.logger.warn(
      `[stub] turno ${input.turnId} com ${input.messages.length} mensagem(ns) ` +
        `para ${input.tenantId}/${input.telefone} (simulacao=${input.simulacao})`,
    );
  }
}
