import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { AppModule } from "../../src/app.module.js";

export async function createTestApp(): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(AppModule, { logger: false });
}
