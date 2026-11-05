import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TenantConfig } from "./tenant.types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

@Injectable()
export class TenantLoaderService implements OnModuleInit {
  private readonly logger = new Logger(TenantLoaderService.name);
  private readonly tenants = new Map<string, TenantConfig>();

  onModuleInit() {
    const dir = join(__dirname, "tenants");
    this.logger.log(`carregando tenants de ${dir}`);

    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      throw new Error(`nenhum tenant encontrado em ${dir}`);
    }

    for (const file of files) {
      const raw = readFileSync(join(dir, file), "utf8");
      const cfg = JSON.parse(raw) as TenantConfig;
      this.validate(cfg);
      this.tenants.set(cfg.tenant_id, cfg);
      this.logger.log(`loaded tenant ${cfg.tenant_id}`);
    }
  }

  private validate(cfg: TenantConfig) {
    if (!cfg.tenant_id || !cfg.nome_empresa || !cfg.nome_assistente) {
      throw new Error(`tenant inválido: ${JSON.stringify(cfg)}`);
    }
    if (
      !Array.isArray(cfg.cidades_atendidas) ||
      cfg.cidades_atendidas.length === 0
    ) {
      throw new Error(`tenant ${cfg.tenant_id} sem cidades_atendidas`);
    }
  }

  get(id: string): TenantConfig {
    const t = this.tenants.get(id);
    if (!t) throw new NotFoundException(`tenant ${id} não existe`);
    return t;
  }

  list(): TenantConfig[] {
    return [...this.tenants.values()];
  }
}
