import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { migrate } from '../src/migrations/migrate';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectionString = process.env.PG_TEST_URL ?? process.env.PG_URL;
if (!connectionString) {
  throw new Error('PG_TEST_URL or PG_URL must be set to run migration tests.');
}

const schema = `skynest_mig_test_${process.pid}_${Date.now()}`;
const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skynest-migrations-'));

const client = new Client({ connectionString });

before(async () => {
  fs.writeFileSync(
    path.join(migrationsDir, '0001_create_widgets.sql'),
    'CREATE TABLE widgets (\n' +
      '  widget_id uuid NOT NULL DEFAULT uuidv7(),\n' +
      '  label text NOT NULL,\n' +
      '  CONSTRAINT pk_widgets PRIMARY KEY (widget_id)\n' +
      ');\n',
  );
  fs.writeFileSync(
    path.join(migrationsDir, '0002_add_widget_flag.sql'),
    'ALTER TABLE widgets ADD COLUMN active boolean NOT NULL DEFAULT true;\n',
  );
  await client.connect();
});

after(async () => {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
  fs.rmSync(migrationsDir, { recursive: true, force: true });
});

test('applies ordered migrations to a clean schema and runs a smoke assertion', async () => {
  const result = await migrate({ connectionString, migrationsDir, schema });

  assert.deepEqual(result.applied, ['0001_create_widgets.sql', '0002_add_widget_flag.sql']);
  assert.deepEqual(result.skipped, []);

  const tracked = await client.query(
    `SELECT count(*)::int AS count FROM "${schema}".schema_migrations`,
  );
  assert.equal(tracked.rows[0].count, 2);

  const widgets = await client.query('SELECT to_regclass($1) AS relation', [`${schema}.widgets`]);
  assert.notEqual(widgets.rows[0].relation, null);

  const columns = await client.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    [schema, 'widgets'],
  );
  const names = columns.rows.map((row) => row.column_name);
  assert.ok(names.includes('widget_id'));
  assert.ok(names.includes('active'));
});

test('is idempotent and skips already-applied migrations', async () => {
  const result = await migrate({ connectionString, migrationsDir, schema });

  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.skipped, ['0001_create_widgets.sql', '0002_add_widget_flag.sql']);
});

test('rolls back a failing migration without recording it', async () => {
  fs.writeFileSync(
    path.join(migrationsDir, '0003_rollback_probe.sql'),
    'CREATE TABLE rollback_probe (id integer);\n' + 'INSERT INTO missing_table (id) VALUES (1);\n',
  );

  await assert.rejects(
    migrate({ connectionString, migrationsDir, schema }),
    /0003_rollback_probe\.sql failed/,
  );

  const probe = await client.query('SELECT to_regclass($1) AS relation', [`${schema}.rollback_probe`]);
  assert.equal(probe.rows[0].relation, null);

  const recorded = await client.query(
    `SELECT count(*)::int AS count FROM "${schema}".schema_migrations WHERE version = '0003'`,
  );
  assert.equal(recorded.rows[0].count, 0);
});
