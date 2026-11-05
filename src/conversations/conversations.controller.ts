import { Controller, Post, Body, Get, Param, HttpCode } from "@nestjs/common";
import { IncomingMessageDto } from "./dto/incoming-message.dto.js";
import { ConversationsService } from "./conversations.service.js";

@Controller()
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Post("webhook/mensagem")
  @HttpCode(202)
  async webhook(@Body() dto: IncomingMessageDto) {
    return this.service.handleIncoming(dto);
  }

  @Get("conversas/:tenantId/:telefone")
  async getHistory(
    @Param("tenantId") tenantId: string,
    @Param("telefone") telefone: string,
  ) {
    return this.service.getHistory(tenantId, telefone);
  }
}
