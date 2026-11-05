import { Module } from "@nestjs/common";
import { LeadsRepository } from "./leads.repository.js";
import { EvidenceValidatorService } from "./evidence-validator.service.js";
import { QualificationService } from "./qualification.service.js";

@Module({
  providers: [LeadsRepository, EvidenceValidatorService, QualificationService],
  exports: [LeadsRepository, EvidenceValidatorService, QualificationService],
})
export class LeadsModule {}
