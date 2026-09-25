import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const MIGRATION_FILENAME = /^(\d+)_(.+)\.sql$/;
const SCHEMA_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const ADVISORY_LOCK_KEY = 4242424242;

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  sql: string;
}

export interface MigrateOptions {
  connectionString: string;
  migrationsDir: string;
  schema?: string;
  logger?: (message: string) => void;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export function loadMigrations(migrationsDir: string): MigrationFile[] {
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const match = MIGRATION_FILENAME.exec(entry.name);
      if (!match) {
        throw new Error(`Migration "${entry.name}" must be named <version>_<name>.sql`);
      }
      const [, version, name] = match;
      return {
        version,
        name,
        filename: entry.name,
        sql: fs.readFileSync(path.join(migrationsDir, entry.name), 'utf8'),
      };
    })
    .sort((a, b) => Number(a.version) - Number(b.version) || a.filename.localeCompare(b.filename));

  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version "${migration.version}"`);
    }
    seen.add(migration.version);
  }
  return migrations;
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const log = options.logger ?? (() => {});
  if (!fs.existsSync(options.migrationsDir)) {
    throw new Error(`Migrations directory not found: ${options.migrationsDir}`);
  }
  if (options.schema && !SCHEMA_IDENTIFIER.test(options.schema)) {
    throw new Error(`Invalid schema name "${options.schema}"`);
  }

  const migrations = loadMigrations(options.migrationsDir);
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();

  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    if (options.schema) {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${options.schema}"`);
      await client.query(`SET search_path TO "${options.schema}", public`);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text NOT NULL,
        name text NOT NULL,
        filename text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_schema_migrations PRIMARY KEY (version)
      )
    `);

    const existing = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const completed = new Set(existing.rows.map((row) => row.version));

    for (const migration of migrations) {
      if (completed.has(migration.version)) {
        skipped.push(migration.filename);
        continue;
      }

      log(`Applying ${migration.filename}`);
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, filename) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.filename],
        );
        await client.query('COMMIT');
        applied.push(migration.filename);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.filename} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }

  return { applied, skipped };
}
