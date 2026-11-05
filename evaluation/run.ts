import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { readFile } from 'node:fs/promises';
import { AppModule } from '../src/app.module.js';
import { ConversationsService } from '../src/conversations/conversations.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { BurstWorkerService } from '../src/worker/burst-worker.service.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runConversation(app: any, c: any) {
  const svc: ConversationsService = app.get(ConversationsService);
  const db: DatabaseService = app.get(DatabaseService);
  const worker: BurstWorkerService = app.get(BurstWorkerService);

  const mensagens: string[] = c.mensagens ?? c.burst ?? [];

  for (let i = 0; i < mensagens.length; i++) {
    await svc.handleIncoming({
      message_id: `${c.id}-${i}`,
      tenant_id: 'sol-nascente',
      telefone: c.telefone,
      texto: mensagens[i],
      timestamp: new Date().toISOString(),
      simulacao: true,
    } as any);
    if (c.burst) await sleep(1000);
  }

  // força debounce para não esperar 8s
  await db.query(
    `UPDATE conversations SET debounce_until = now() WHERE telefone = $1`,
    [c.telefone],
  );

  // executa tick até não haver mais trabalho
  for (let i = 0; i < 5; i++) {
    await worker.tick();
    await sleep(200);
    const pend = await db.query(
      `SELECT 1 FROM conversations WHERE telefone = $1
         AND debounce_until IS NOT NULL`,
      [c.telefone],
    );
    if (pend.rows.length === 0) break;
  }

  const hist = await svc.getHistory('sol-nascente', c.telefone);
  return hist;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const conversations = JSON.parse(
    await readFile(new URL('./conversations.json', import.meta.url), 'utf8'),
  ) as any[];
  const report: any[] = [];

  for (const c of conversations as any[]) {
    try {
      const hist = await runConversation(app, c);
      report.push({ id: c.id, hist });
    } catch (e) {
      report.push({ id: c.id, error: String(e) });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await app.close();
}

main().catch((e) => { console.error(e); process.exit(1); });