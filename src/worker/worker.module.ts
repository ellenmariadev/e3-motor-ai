import { Module } from "@nestjs/common";
import { BurstWorkerService } from "./burst-worker.service.js";
import { TurnProcessorService } from "./turn-processor.service.js";
import { AgentModule } from "../agent/agent.module.js";

@Module({
  imports: [AgentModule],
  providers: [BurstWorkerService, TurnProcessorService],
  exports: [TurnProcessorService, BurstWorkerService],
})
export class WorkerModule {}
