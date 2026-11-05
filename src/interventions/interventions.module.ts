import { Module } from "@nestjs/common";
import { InterventionsController } from "./interventions.controller.js";
import { InterventionsService } from "./interventions.service.js";

@Module({
  controllers: [InterventionsController],
  providers: [InterventionsService],
})
export class InterventionsModule {}
