import { Client } from "pg";

export async function forceDebounce(telefone: string) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE conversations
       SET debounce_until = now() - interval '1 second',
           first_pending_at = now() - interval '1 second'
       WHERE telefone = $1`,
      [telefone],
    );
  } finally {
    await client.end();
  }
}
