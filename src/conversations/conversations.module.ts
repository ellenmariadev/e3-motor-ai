import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller.js";
import { ConversationsService } from "./conversations.service.js";
import { ConversationsRepository } from "./conversations.repository.js";

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsRepository],
  exports: [ConversationsService, ConversationsRepository],
})
export class ConversationsModule {}
