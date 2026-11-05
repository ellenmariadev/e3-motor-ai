import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { ConfigModule } from "@nestjs/config";
import { TenantsModule } from "./config/tenants.module.js";
import { ConversationsModule } from "./conversations/conversations.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { InterventionsModule } from "./interventions/interventions.module.js";
import { WorkerModule } from "./worker/worker.module.js";
import { ActionsModule } from "./actions/actions.module.js";
import { LlmModule } from "./llm/llm.module.js";
import { LeadsModule } from "./leads/leads.module.js";
import { MetricsModule } from "./metrics/metrics.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    TenantsModule,
    ConversationsModule,
    InterventionsModule,
    WorkerModule,
    ActionsModule,
    LlmModule,
    LeadsModule,
    MetricsModule,
  ],
})
export class AppModule {}
