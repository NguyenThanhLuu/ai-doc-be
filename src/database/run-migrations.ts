import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be configured before running migrations.");
}

const migrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migrationName of migrationNames) {
    const existingMigration = await client.query(
      "SELECT 1 FROM public.schema_migrations WHERE name = $1",
      [migrationName],
    );

    if (existingMigration.rowCount === 1) {
      continue;
    }

    const sql = await readFile(
      resolve(migrationsDirectory, migrationName),
      "utf8",
    );

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO public.schema_migrations (name) VALUES ($1)",
        [migrationName],
      );
      await client.query("COMMIT");
      console.log(`Applied migration: ${migrationName}`);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
