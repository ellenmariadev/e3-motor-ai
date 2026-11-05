import { Client } from "pg";
import { runMigrations } from "../../src/database/script.js";

export async function resetSchema() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

export async function migrate() {
  await runMigrations();
}

export async function truncateAll() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      TRUNCATE
        actions, appointments, interventions, lead_profiles,
        messages, notifications, turns, conversations
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await client.end();
  }
}
