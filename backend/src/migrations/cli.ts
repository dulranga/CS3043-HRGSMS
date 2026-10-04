import path from 'node:path';
import dotenv from 'dotenv';
import { migrate } from './migrate';

dotenv.config();

async function main(): Promise<void> {
  const connectionString = process.env.PG_URL;
  if (!connectionString) {
    throw new Error('PG_URL environment variable is required to run migrations.');
  }

  const migrationsDir =
    process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, '../../migrations');

  const result = await migrate({
    connectionString,
    migrationsDir,
    schema: process.env.PG_SCHEMA,
    logger: (message) => console.log(message),
  });

  console.log(`Applied ${result.applied.length}, skipped ${result.skipped.length}.`);
}

main().catch((error: Error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
});
