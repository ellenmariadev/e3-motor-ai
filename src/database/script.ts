import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");
const ADVISORY_LOCK_KEY = 727001;

export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não definida");

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

    try {
      const files = (await readdir(MIGRATIONS_DIR))
        .filter((f) => f.endsWith(".sql"))
        .sort();

      const { rows } = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations",
      );
      const done = new Set(rows.map((r) => r.name));

      let applied = 0;
      for (const file of files) {
        if (done.has(file)) continue;
        console.log(`Applying ${file}`);
        const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations(name) VALUES ($1)",
            [file],
          );
          await client.query("COMMIT");
          applied++;
        } catch (error) {
          await client.query("ROLLBACK");
          throw new Error(
            `Migration failed in ${file}: ${(error as Error).message}`,
          );
        }
      }
      console.log(
        applied === 0
          ? "Database already up to date"
          : `Migrations completed successfully (${applied} applied)`,
      );
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

const isDirectExecution =
  !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  runMigrations().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
}
