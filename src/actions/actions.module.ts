import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module.js";
import { ActionExecutorService } from "./action-executor.service.js";

@Module({
  imports: [LeadsModule],
  providers: [ActionExecutorService],
  exports: [ActionExecutorService],
})
export class ActionsModule {}
