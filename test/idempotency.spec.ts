import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { INestApplicationContext } from "@nestjs/common";
import { createTestApp } from "./helpers/app.js";
import { resetSchema, migrate, truncateAll } from "./helpers/db.js";
import { forceDebounce } from "./helpers/force-debounce.js";
import { ConversationsService } from "../src/conversations/conversations.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { BurstWorkerService } from "../src/worker/burst-worker.service.js";
import { MockProvider } from "../src/llm/mock.provider.js";

describe("Teste 1 — Idempotência", () => {
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

  it("mensagem duplicada não gera segundo turno nem segunda resposta", async () => {
    const dto = {
      message_id: "idem-1",
      tenant_id: "sol-nascente",
      telefone: "5581010000001",
      texto: "oi",
      timestamp: new Date().toISOString(),
    };

    const r1 = await svc.handleIncoming(dto as any);
    const r2 = await svc.handleIncoming(dto as any);

    expect((r1 as any).duplicated).toBe(false);
    expect((r2 as any).duplicated).toBe(true);

    await forceDebounce(dto.telefone);
    await worker.tick();
    await worker.tick();

    const msgs = await db.query(
      `SELECT count(*)::int AS n FROM messages WHERE message_id = $1`,
      [dto.message_id],
    );
    expect(msgs.rows[0].n).toBe(1);

    const turns = await db.query(`SELECT count(*)::int AS n FROM turns`);
    expect(turns.rows[0].n).toBe(1);

    const ia = await db.query(
      `SELECT count(*)::int AS n FROM messages WHERE autor = 'ia'`,
    );
    expect(ia.rows[0].n).toBe(1);
  });
});
