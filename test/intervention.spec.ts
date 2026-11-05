import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { INestApplicationContext } from "@nestjs/common";
import { createTestApp } from "./helpers/app.js";
import { resetSchema, migrate, truncateAll } from "./helpers/db.js";
import { forceDebounce } from "./helpers/force-debounce.js";
import { ConversationsService } from "../src/conversations/conversations.service.js";
import { InterventionsService } from "../src/interventions/interventions.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { BurstWorkerService } from "../src/worker/burst-worker.service.js";
import { MockProvider } from "../src/llm/mock.provider.js";

describe("Teste 3 — Intervenção humana", () => {
  let app: INestApplicationContext;
  let svc: ConversationsService;
  let interventions: InterventionsService;
  let db: DatabaseService;
  let worker: BurstWorkerService;
  let mock: MockProvider;

  beforeAll(async () => {
    await resetSchema();
    await migrate();
    app = await createTestApp();
    svc = app.get(ConversationsService);
    interventions = app.get(InterventionsService);
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

  it("assumir antes do tick → IA não responde e turno não é criado", async () => {
    const telefone = "5581010000003";
    await svc.handleIncoming({
      message_id: "int-1",
      tenant_id: "sol-nascente",
      telefone,
      texto: "oi",
      timestamp: new Date().toISOString(),
    } as any);

    await forceDebounce(telefone);
    await interventions.handle("sol-nascente", telefone, "assumir");

    // tenta rodar o worker mesmo assim
    await worker.tick();

    const ia = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages WHERE autor = 'ia'`,
    );
    expect(ia.rows[0].n).toBe(0);

    const turns = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM turns`,
    );
    expect(turns.rows[0].n).toBe(0);

    const conv = await db.query<{ status: string }>(
      `SELECT status FROM conversations WHERE telefone = $1`,
      [telefone],
    );
    expect(conv.rows[0].status).toBe("humano");
  });

  it("religar → IA volta a responder", async () => {
    const telefone = "5581010000003";
    await svc.handleIncoming({
      message_id: "int-a",
      tenant_id: "sol-nascente",
      telefone,
      texto: "oi",
      timestamp: new Date().toISOString(),
    } as any);
    await interventions.handle("sol-nascente", telefone, "assumir");

    await svc.handleIncoming({
      message_id: "int-b",
      tenant_id: "sol-nascente",
      telefone,
      texto: "voltei",
      timestamp: new Date(Date.now() + 1000).toISOString(),
    } as any);
    await interventions.handle("sol-nascente", telefone, "religar");
    await forceDebounce(telefone);
    await worker.tick();

    const ia = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages WHERE autor = 'ia'`,
    );
    expect(ia.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("mensagem humana no webhook coloca conversa em modo humano", async () => {
    const telefone = "5581010000003";
    await svc.handleIncoming({
      message_id: "h-1",
      tenant_id: "sol-nascente",
      telefone,
      texto: "sou o consultor",
      timestamp: new Date().toISOString(),
      autor: "humano",
    } as any);

    const conv = await db.query<{ status: string }>(
      `SELECT status FROM conversations WHERE telefone = $1`,
      [telefone],
    );
    expect(conv.rows[0].status).toBe("humano");
  });
});
