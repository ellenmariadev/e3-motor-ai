import { config } from "dotenv";
import { beforeAll } from "vitest";

config();
config({ path: ".env.test", override: true });

process.env.NODE_ENV = "test";
process.env.LLM_PROVIDER = "mock";

import { resetSchema, migrate } from "./db.js";

beforeAll(async () => {
  await resetSchema();
  await migrate();
});
