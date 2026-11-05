import { Controller, Get, Param } from "@nestjs/common";
import { MetricsService } from "./metrics.service.js";

@Controller("metricas")
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @Get(":tenantId")
  get(@Param("tenantId") tenantId: string) {
    return this.service.get(tenantId);
  }
}
