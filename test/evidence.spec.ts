import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { INestApplicationContext } from "@nestjs/common";
import { createTestApp } from "./helpers/app.js";
import { resetSchema, migrate, truncateAll } from "./helpers/db.js";
import { forceDebounce } from "./helpers/force-debounce.js";
import { ConversationsService } from "../src/conversations/conversations.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { BurstWorkerService } from "../src/worker/burst-worker.service.js";
import { MockProvider } from "../src/llm/mock.provider.js";

describe("Teste 4 — Não invenção", () => {
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

  it("atualizar_ficha com trecho inventado é rejeitado e ficha fica vazia", async () => {
    const telefone = "5581010000004";

    // manda mensagem real do lead (para o message_id existir no batch)
    await svc.handleIncoming({
      message_id: "msg-real-1",
      tenant_id: "sol-nascente",
      telefone,
      texto: "oi, tudo bem?",
      timestamp: new Date().toISOString(),
    } as any);

    // precisamos do UUID interno da mensagem para o mock referenciar
    const msgRow = await db.query<{ id: string }>(
      `SELECT id FROM messages WHERE message_id = 'msg-real-1'`,
    );
    const realMessageId = msgRow.rows[0].id;

    mock.enqueue({
      type: "tool",
      toolCalls: [
        {
          id: "call-fake-1",
          name: "atualizar_ficha",
          arguments: {
            campo: "nome",
            valor: "João Pereira",
            trecho: "João Pereira", // ← INVENTADO, não está na msg
            message_id: realMessageId,
          },
        },
      ],
    });

    await forceDebounce(telefone);
    await worker.tick();

    const actions = await db.query<{ status: string }>(
      `SELECT status FROM actions WHERE ferramenta = 'atualizar_ficha'`,
    );
    expect(actions.rows).toHaveLength(1);
    expect(actions.rows[0].status).toBe("rejeitada");

    const profile = await db.query<{ ficha: any }>(
      `SELECT ficha FROM lead_profiles
       WHERE conversation_id = (SELECT id FROM conversations WHERE telefone = $1)`,
      [telefone],
    );
    // ou não existe linha, ou a ficha está vazia
    expect(profile.rows[0]?.ficha ?? {}).toEqual({});
  });

  it("atualizar_ficha com trecho real é aceito", async () => {
    const telefone = "5581010000005";
    await svc.handleIncoming({
      message_id: "msg-real-2",
      tenant_id: "sol-nascente",
      telefone,
      texto: "João Pereira, de Caruaru",
      timestamp: new Date().toISOString(),
    } as any);

    const msgRow = await db.query<{ id: string }>(
      `SELECT id FROM messages WHERE message_id = 'msg-real-2'`,
    );

    mock.enqueue({
      type: "tool",
      toolCalls: [
        {
          id: "call-ok-1",
          name: "atualizar_ficha",
          arguments: {
            campo: "nome",
            valor: "João Pereira",
            trecho: "João Pereira",
            message_id: msgRow.rows[0].id,
          },
        },
      ],
    });

    await forceDebounce(telefone);
    await worker.tick();

    const profile = await db.query<{ ficha: any }>(
      `SELECT ficha FROM lead_profiles
       WHERE conversation_id = (SELECT id FROM conversations WHERE telefone = $1)`,
      [telefone],
    );
    expect(profile.rows[0].ficha.nome.valor).toBe("João Pereira");
  });
});
