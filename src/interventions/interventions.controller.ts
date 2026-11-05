import { Controller, Post, Body } from "@nestjs/common";
import { IsIn, IsString } from "class-validator";
import { InterventionsService } from "./interventions.service.js";

class InterventionDto {
  @IsString() tenant_id: string;
  @IsString() telefone: string;
  @IsIn(["assumir", "religar"]) acao: "assumir" | "religar";
}

@Controller("intervencao")
export class InterventionsController {
  constructor(private readonly service: InterventionsService) {}

  @Post()
  async handle(@Body() dto: InterventionDto) {
    return this.service.handle(dto.tenant_id, dto.telefone, dto.acao);
  }
}
