import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { INestApplicationContext } from "@nestjs/common";
import { createTestApp } from "./helpers/app.js";
import { resetSchema, migrate, truncateAll } from "./helpers/db.js";
import { forceDebounce } from "./helpers/force-debounce.js";
import { ConversationsService } from "../src/conversations/conversations.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { BurstWorkerService } from "../src/worker/burst-worker.service.js";
import { MockProvider } from "../src/llm/mock.provider.js";

describe("Teste 2 — Rajada", () => {
  let app: INestApplicationContext;
  let svc: ConversationsService;
  let db: DatabaseService;
  let worker: BurstWorkerService;
  let mock: MockProvider;

  beforeAll(async () => {
    await resetSchema();
    await migrate();
    app = await createTestApp();
    svc = app.get(ConversationsService);
    db = app.get(DatabaseService);
    worker = app.get(BurstWorkerService);
    mock = app.get(MockProvider);
  });

  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await truncateAll();
    mock.reset();
  });

  it("3 mensagens na janela → 1 turno com as 3 → 1 resposta", async () => {
    const telefone = "5581010000002";
    const base = Date.now();

    for (let i = 0; i < 3; i++) {
      await svc.handleIncoming({
        message_id: `burst-${i}`,
        tenant_id: "sol-nascente",
        telefone,
        texto: `msg ${i}`,
        timestamp: new Date(base + i * 1000).toISOString(),
      } as any);
    }

    await forceDebounce(telefone);
    await worker.tick();

    const turns = await db.query<{ message_ids: string[] }>(
      `SELECT message_ids FROM turns`,
    );
    expect(turns.rows).toHaveLength(1);
    expect(turns.rows[0].message_ids).toHaveLength(3);

    const ia = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages WHERE autor = 'ia'`,
    );
    expect(ia.rows[0].n).toBe(1);
  });
});
