import {
  IsISO8601,
  IsOptional,
  IsString,
  IsBoolean,
  IsIn,
} from "class-validator";

export class IncomingMessageDto {
  @IsString()
  message_id: string;

  @IsString()
  tenant_id: string;

  @IsString()
  telefone: string;

  @IsString()
  texto: string;

  @IsISO8601()
  timestamp: string;

  @IsOptional()
  @IsIn(["lead", "humano"])
  autor?: "lead" | "humano";

  @IsOptional()
  @IsBoolean()
  simulacao?: boolean;
}
