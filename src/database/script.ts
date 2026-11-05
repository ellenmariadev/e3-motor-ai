import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runMigrations(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const applied = new Set(
      (
        await client.query<{ name: string }>(
          "SELECT name FROM schema_migrations",
        )
      ).rows.map((row) => row.name),
    );

    const dir = join(__dirname, "migrations");

    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = readFileSync(join(dir, file), "utf8");

      console.log(`Applying ${file}`);

      await client.query("BEGIN");

      try {
        await client.query(sql);

        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          file,
        ]);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("Migrations completed successfully");
  } finally {
    await client.end();
  }
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

runMigrations(connectionString).catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
