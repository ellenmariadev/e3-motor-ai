import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service.js";
import {
  type PendingMessage,
  TurnProcessorService,
} from "./turn-processor.service.js";

interface ClaimedConversation {
  id: string;
  tenant_id: string;
  telefone: string;
  ai_epoch: number;
  processing_token: string;
  simulacao: boolean;
}

@Injectable()
export class BurstWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BurstWorkerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly turnProcessor: TurnProcessorService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
    if (this.config.get("WORKER_AUTO_START", "true") === "false") return;
    const interval = Number(this.config.get("WORKER_POLL_INTERVAL_MS", 250));
    this.timer = setInterval(
      () => this.tick().catch((e) => this.logger.error(e)),
      interval,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const claimed = await this.claimOne();
      if (!claimed) return;

      const messages = await this.fetchBatch(claimed.id);
      if (messages.length === 0) {
        await this.release(claimed, "no-messages");
        return;
      }

      await this.turnProcessor.process(claimed, messages);
    } finally {
      this.running = false;
    }
  }

  private async claimOne(): Promise<ClaimedConversation | null> {
    const leaseMs = Number(this.config.get("WORKER_LEASE_MS", 30000));
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<ClaimedConversation>(
        `SELECT id, tenant_id, telefone, ai_epoch, simulacao
         FROM conversations
         WHERE status = 'ia'
           AND debounce_until IS NOT NULL
           AND debounce_until <= now()
           AND (processing_until IS NULL OR processing_until < now())
         ORDER BY debounce_until ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) return null;

      const conv = rows[0];
      const token = crypto.randomUUID();
      await client.query(
        `UPDATE conversations
         SET processing_until = now() + ($2::int * interval '1 millisecond'),
             processing_token = $3
         WHERE id = $1`,
        [conv.id, leaseMs, token],
      );
      return { ...conv, processing_token: token };
    });
  }

  private async fetchBatch(conversationId: string): Promise<PendingMessage[]> {
    const { rows } = await this.db.query<PendingMessage>(
      `SELECT id, autor, texto, timestamp, message_id
     FROM messages
     WHERE conversation_id = $1 AND processada = false
     ORDER BY timestamp ASC`,
      [conversationId],
    );
    return rows;
  }

  private async release(claim: ClaimedConversation, reason: string) {
    this.logger.warn(`releasing ${claim.id}: ${reason}`);
    await this.db.query(
      `UPDATE conversations
       SET processing_until = NULL, processing_token = NULL, debounce_until = NULL, first_pending_at = NULL
       WHERE id = $1 AND processing_token = $2`,
      [claim.id, claim.processing_token],
    );
  }
}
