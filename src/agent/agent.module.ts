import { Module } from "@nestjs/common";
import { AgentService } from "./agent.service.js";
import { PromptService } from "./prompt.service.js";
import { LeadsModule } from "../leads/leads.module.js";
import { ActionsModule } from "../actions/actions.module.js";

@Module({
  imports: [LeadsModule, ActionsModule],
  providers: [AgentService, PromptService],
  exports: [AgentService],
})
export class AgentModule {}
