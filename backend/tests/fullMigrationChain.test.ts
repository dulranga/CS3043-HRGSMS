import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { loadMigrations, migrate } from '../src/migrations/migrate';
dotenv.config({ path: path.join(__dirname, '../.env') });
test('the production migration runner applies the full chain and skips it on rerun', async () => {
  const url = new URL(process.env.PG_TEST_URL || process.env.PG_URL!);
  url.hostname = url.hostname.replace('-pooler.', '.');
  const schema = `qa_chain_${randomBytes(8).toString('hex')}`;
  const directory = path.join(__dirname, '../migrations');
  const options = { connectionString: url.toString(), migrationsDir: directory, schema };
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const initial = await migrate(options);
    assert.equal(initial.applied.length, loadMigrations(directory).length);
    assert.deepEqual(initial.skipped, []);
    const repeat = await migrate(options);
    assert.deepEqual(repeat.applied, []);
    assert.equal(repeat.skipped.length, initial.applied.length);
    const report = await client.query(`SELECT * FROM "${schema}".view_current_occupancy`);
    assert.ok(report.rows.length > 0);
    assert.ok(report.rows.every(row => Number(row.occupied_rooms) === 0));
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
