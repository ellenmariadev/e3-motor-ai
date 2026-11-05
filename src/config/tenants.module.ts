import { Module, Global } from "@nestjs/common";
import { TenantLoaderService } from "./tenant-loader.service.js";

@Global()
@Module({
  providers: [TenantLoaderService],
  exports: [TenantLoaderService],
})
export class TenantsModule {}
