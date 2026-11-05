import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const runId = Date.now().toString(36);

process.env.LLM_DISABLE_TOOLS = "true";
process.env.WORKER_AUTO_START = "false";
process.env.LLM_MAX_RETRIES ??= "1";
process.env.LLM_MAX_RETRY_DELAY_MS ??= "2000";
process.env.LLM_MAX_OUTPUT_TOKENS ??= "768";
process.env.LLM_FALLBACK_MODELS ??=
  "qwen/qwen3.8-27b,openai/gpt-oss-20b,allam-2-7b";

const conversationsUrl = new URL("./conversations.json", import.meta.url);
const lastRunUrl = new URL("./last-run.json", import.meta.url);

async function runConversation(app: any, c: any, telefone: string) {
  const { ConversationsService } = await import(
    "../dist/conversations/conversations.service.js"
  );
  const { DatabaseService } = await import(
    "../dist/database/database.service.js"
  );
  const { BurstWorkerService } = await import(
    "../dist/worker/burst-worker.service.js"
  );

  const svc: any = app.get(ConversationsService);
  const db: any = app.get(DatabaseService);
  const worker: any = app.get(BurstWorkerService);

  const mensagens: string[] = c.mensagens ?? c.burst ?? [];

  for (let i = 0; i < mensagens.length; i++) {
    await svc.handleIncoming({
      message_id: `${c.id}-${runId}-${i}`,
      tenant_id: "sol-nascente",
      telefone,
      texto: mensagens[i],
      timestamp: new Date().toISOString(),
      simulacao: true,
    } as any);
    if (c.burst) await sleep(1000);
  }

  // força debounce para não esperar 8s
  await db.query(
    `UPDATE conversations SET debounce_until = now() WHERE telefone = $1`,
    [telefone],
  );

  // executa tick até não haver mais trabalho
  for (let i = 0; i < 5; i++) {
    await worker.tick();
    await sleep(200);
    const pend = await db.query(
      `SELECT 1 FROM conversations WHERE telefone = $1
         AND debounce_until IS NOT NULL`,
      [telefone],
    );
    if (pend.rows.length === 0) break;
  }

  return svc.getHistory("sol-nascente", telefone);
}

async function prepareEvalDatabase(): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida");

  const evalUrl = process.env.EVAL_DATABASE_URL
    ? new URL(process.env.EVAL_DATABASE_URL)
    : new URL(databaseUrl);
  if (!process.env.EVAL_DATABASE_URL) {
    const name = evalUrl.pathname.replace(/^\//, "") || "crm";
    evalUrl.pathname = `/${name}_eval`;
  }

  const connectionString = evalUrl.toString();
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return connectionString;
  } catch (error: any) {
    if (error?.code !== "3D000") throw error;

    const dbName = decodeURIComponent(evalUrl.pathname.replace(/^\//, ""));
    const adminUrl = new URL(evalUrl);
    adminUrl.pathname = "/postgres";
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      const quoted = `"${dbName.replace(/"/g, '""')}"`;
      await admin.query(`CREATE DATABASE ${quoted}`);
      console.error(`Banco de avaliação criado: ${dbName}`);
    } finally {
      await admin.end();
    }
    return connectionString;
  } finally {
    await client.end().catch(() => {});
  }
}

function isRateLimitError(error?: string | null): boolean {
  return Boolean(
    error && /\b429\b|rate_limit_exceeded|rate limit|tokens per day|\bTPD\b/i.test(error),
  );
}

function hasRateLimitFailure(history: any): boolean {
  return (history?.ultimos_turnos ?? []).some(
    (turn: any) => turn.status === "falhou" && isRateLimitError(turn.erro),
  );
}

async function readLastRun(): Promise<any[]> {
  try {
    return JSON.parse(await readFile(lastRunUrl, "utf8")) as any[];
  } catch {
    return [];
  }
}

async function main() {
  const provider = process.env.LLM_PROVIDER ?? "openai-compatible";
  if (provider === "mock") {
    throw new Error(
      "A avaliação real não pode usar LLM_PROVIDER=mock. Configure um provider compatível com a API.",
    );
  }

  const evalDatabaseUrl = await prepareEvalDatabase();
  process.env.DATABASE_URL = evalDatabaseUrl;
  console.error(`Banco da avaliação: ${evalDatabaseUrl}`);

  const { runMigrations } = await import("../dist/database/script.js");
  await runMigrations();

  const { AppModule } = await import("../dist/app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const conversations = JSON.parse(
      await readFile(conversationsUrl, "utf8"),
    ) as any[];
    const requestedCases = (process.env.EVAL_CASES ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const selected = requestedCases.length
      ? conversations.filter((c) => requestedCases.includes(c.id))
      : conversations;

    const unknown = requestedCases.filter(
      (id) => !conversations.some((c) => c.id === id),
    );
    if (unknown.length > 0) {
      throw new Error(`Casos inexistentes em EVAL_CASES: ${unknown.join(", ")}`);
    }

    const report: any[] = [];
    let aborted = false;

    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      const telefone = `${c.telefone}-${runId}`;
      try {
        const hist = await runConversation(app, c, telefone);
        report.push({
          id: c.id,
          provider,
          executado_em: new Date().toISOString(),
          hist,
        });
        console.error(`✓ ${c.id}`);
        if (hasRateLimitFailure(hist)) {
          aborted = true;
          console.error(
            `✗ ${c.id}: limite de tokens do provider; interrompendo os demais casos.`,
          );
          break;
        }
      } catch (e) {
        const message = String(e);
        report.push({ id: c.id, provider, error: message });
        console.error(`✗ ${c.id}: ${message.slice(0, 200)}`);
        if (isRateLimitError(message)) {
          aborted = true;
          break;
        }
      }
    }

    const byId = new Map<string, any>(
      (await readLastRun()).map((result) => [result.id, result]),
    );
    if (requestedCases.length === 0) byId.clear();
    for (const result of report) byId.set(result.id, result);

    if (aborted) {
      const executed = new Set(report.map((result) => result.id));
      for (const c of selected) {
        if (executed.has(c.id)) continue;
        byId.set(c.id, {
          id: c.id,
          provider,
          error:
            "Não executado: execução interrompida pelo limite de tokens do provider.",
        });
      }
    }

    const merged = conversations
      .map((c) => byId.get(c.id))
      .filter(Boolean) as any[];
    await writeFile(lastRunUrl, JSON.stringify(merged, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
