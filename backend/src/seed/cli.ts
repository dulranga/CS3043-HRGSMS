import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { migrate } from '../migrations/migrate';
import { seedDemoData } from './demoData';

// SkyNest demo-data CLI.
//
//   npm run seed --workspace backend
//     Seeds the configured (shared dev) database additively.
//
//   npm run seed --workspace backend -- --schema demo
//     Creates/updates an isolated schema, applies the migration chain, and
//     seeds it. Safe to repeat: pass --reset to drop and rebuild it.
//
//   npm run seed --workspace backend -- --schema demo --reset
//     Drops the schema first, so the demo data is rebuilt from scratch.

dotenv.config();

const SCHEMA_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const connectionString = process.env.PG_URL;
  if (!connectionString) {
    throw new Error('PG_URL environment variable is required to seed demo data.');
  }

  const schema = readFlag('--schema');
  const reset = process.argv.includes('--reset');
  const migrationsDir = path.resolve(__dirname, '../../migrations');

  if (schema && !SCHEMA_IDENTIFIER.test(schema)) {
    throw new Error('--schema must be a lowercase identifier such as "demo".');
  }
  if (reset && !schema) {
    throw new Error(
      '--reset requires --schema <name>. The shared dev schema is never reset automatically; ' +
        'use an isolated schema (e.g. --schema demo --reset) or a fresh database.',
    );
  }

  if (schema) {
    if (reset) {
      const admin = new Client({ connectionString, connectionTimeoutMillis: 15000 });
      await admin.connect();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        console.log(`Dropped schema "${schema}".`);
      } finally {
        await admin.end();
      }
    }
    console.log(`Applying migrations to schema "${schema}"...`);
    await migrate({
      connectionString,
      migrationsDir,
      schema,
      logger: (message) => console.log(message),
    });
  } else {
    const probe = new Client({ connectionString, connectionTimeoutMillis: 15000 });
    await probe.connect();
    try {
      await probe.query('SELECT 1 FROM schema_migrations LIMIT 1');
    } catch {
      throw new Error('The database is not migrated yet. Run "npm run migrate --workspace backend" first.');
    } finally {
      await probe.end();
    }
  }

  const result = await seedDemoData({
    connectionString,
    schema,
    logger: (message) => console.log(message),
  });

  console.log('\nDemo data ready.');
  console.log(`  Billing policy: ${result.billingPolicyId}`);
  console.log('  Row counts:', JSON.stringify(result.counts));
  console.log('  Sign in with:', result.credentials.map((c) => c.username).join(', '));
  console.log(`  Password for every demo account: ${result.credentials[0].password}`);
}

main().catch((error: Error) => {
  console.error(`Seeding failed: ${error.message}`);
  process.exit(1);
});
