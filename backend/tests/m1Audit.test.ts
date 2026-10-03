import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { AUDIT_ACTIONS, appendAudit, maskSensitiveValues } from '../src/audit';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const migrationsDir = path.join(__dirname, '..', 'migrations');
const branchRole = readFileSync(path.join(migrationsDir, 'm1_001_create_branch_and_role.sql'), 'utf8');
const accountOfficer = readFileSync(
  path.join(migrationsDir, 'm1_002_create_user_account_and_officer.sql'),
  'utf8',
);
const guestAccounts = readFileSync(
  path.join(migrationsDir, 'm1_003_create_guest_and_guest_account.sql'),
  'utf8',
);
const auditLog = readFileSync(path.join(migrationsDir, 'm1_004_create_audit_log.sql'), 'utf8');

async function expectSqlError(client: Client, sql: string, values: unknown[], code: string) {
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(
      client.query(sql, values),
      (error: { code?: string }) => error.code === code,
      `Expected PostgreSQL error ${code}`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

test('maskSensitiveValues redacts password/NIC/token keys recursively', () => {
  const masked = maskSensitiveValues({
    username: 'nimal',
    password_hash: '$2a$12$secret',
    nic: '200012345678',
    profile: { access_token: 'abc123', city: 'Colombo', password: 'pw' },
    items: [{ secret: 'x' }, { note: 'ok' }],
  }) as Record<string, unknown>;

  assert.equal(masked.username, 'nimal');
  assert.equal(masked.password_hash, '[REDACTED]');
  assert.equal(masked.nic, '[REDACTED]');
  const profile = masked.profile as Record<string, unknown>;
  assert.equal(profile.access_token, '[REDACTED]');
  assert.equal(profile.password, '[REDACTED]');
  assert.equal(profile.city, 'Colombo');
  const items = masked.items as Array<Record<string, unknown>>;
  assert.equal(items[0].secret, '[REDACTED]');
  assert.equal(items[1].note, 'ok');

  assert.equal(maskSensitiveValues('plain'), 'plain');
  assert.equal(maskSensitiveValues(null), null);
  assert.equal(maskSensitiveValues(42), 42);
});

test('M1-S06 audit_log append-only contract in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m1_audit_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    // Scratch schema only: m1_004's unqualified DROP TABLE must never reach public.
    await client.query(`SET LOCAL search_path TO "${schema}"`);

    await client.query(branchRole);
    await client.query(accountOfficer);
    await client.query(guestAccounts);
    await client.query(auditLog);

    const columns = await client.query(
      `SELECT column_name, data_type, udt_name, character_maximum_length, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'audit_log'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      [
        'audit_id', 'user_id', 'entity_name', 'entity_id', 'action',
        'before_value', 'after_value', 'changed_at', 'ip_address',
      ],
    );
    for (const [field, dataType] of [
      ['audit_id', 'uuid'],
      ['user_id', 'uuid'],
      ['entity_name', 'character varying'],
      ['entity_id', 'character varying'],
      ['action', 'character varying'],
      ['before_value', 'text'],
      ['after_value', 'text'],
      ['changed_at', 'timestamp with time zone'],
      ['ip_address', 'character varying'],
    ]) {
      const column = columns.rows.find((row) => row.column_name === field);
      assert.equal(column.data_type, dataType, `audit_log.${field} must use ${dataType}`);
    }
    for (const field of ['user_id', 'entity_name', 'entity_id', 'action', 'changed_at']) {
      assert.equal(
        columns.rows.find((row) => row.column_name === field).is_nullable,
        'NO',
        `audit_log.${field} must be NOT NULL`,
      );
    }
    assert.equal(
      columns.rows.find((row) => row.column_name === 'entity_name').character_maximum_length,
      255,
    );
    assert.equal(
      columns.rows.find((row) => row.column_name === 'ip_address').character_maximum_length,
      255,
    );

    const system = await client.query(
      "SELECT user_id FROM user_account WHERE username = 'system'",
    );
    const systemUserId = system.rows[0].user_id;

    // Every controlled action label is accepted.
    for (const action of AUDIT_ACTIONS) {
      const inserted = await client.query(
        `INSERT INTO audit_log (user_id, entity_name, entity_id, action)
         VALUES ($1, 'user_account', 'test', $2) RETURNING audit_id, changed_at`,
        [systemUserId, action],
      );
      assert.equal(inserted.rows[0].changed_at !== null, true);
      const version = await client.query(
        'SELECT uuid_extract_version($1::uuid) AS v',
        [inserted.rows[0].audit_id],
      );
      assert.equal(version.rows[0].v, 7);
    }
    const actionCount = await client.query('SELECT count(*)::int AS count FROM audit_log');
    assert.equal(actionCount.rows[0].count, AUDIT_ACTIONS.length);

    // Unknown action label is rejected.
    await expectSqlError(
      client,
      `INSERT INTO audit_log (user_id, entity_name, entity_id, action)
       VALUES ($1, 'x', 'y', 'EVIL_ACTION')`,
      [systemUserId],
      '23514',
    );

    // Actor FK and non-null actor enforcement.
    const account = await client.query(
      `INSERT INTO user_account (username) VALUES ('audit.actor') RETURNING user_id`,
    );
    const actorId = account.rows[0].user_id;
    await expectSqlError(
      client,
      `INSERT INTO audit_log (user_id, entity_name, entity_id, action)
       VALUES ('00000000-0000-7000-8000-00000000000c', 'x', 'y', 'CREATE')`,
      [],
      '23503',
    );
    await expectSqlError(
      client,
      `INSERT INTO audit_log (entity_name, entity_id, action) VALUES ('x', 'y', 'CREATE')`,
      [],
      '23502',
    );

    // UUIDv7 only.
    await expectSqlError(
      client,
      `INSERT INTO audit_log (audit_id, user_id, entity_name, entity_id, action)
       VALUES (uuidv4(), $1, 'x', 'y', 'CREATE')`,
      [actorId],
      '23514',
    );
    await expectSqlError(
      client,
      `INSERT INTO audit_log (audit_id, user_id, entity_name, entity_id, action)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, 'x', 'y', 'CREATE')`,
      [actorId],
      '23514',
    );

    // Non-blank entity fields and text(65535) caps.
    await expectSqlError(
      client,
      `INSERT INTO audit_log (user_id, entity_name, entity_id, action)
       VALUES ($1, '   ', 'y', 'CREATE')`,
      [actorId],
      '23514',
    );
    await expectSqlError(
      client,
      `INSERT INTO audit_log (user_id, entity_name, entity_id, action)
       VALUES ($1, 'x', '   ', 'CREATE')`,
      [actorId],
      '23514',
    );
    await expectSqlError(
      client,
      `INSERT INTO audit_log (user_id, entity_name, entity_id, action, before_value)
       VALUES ($1, 'x', 'y', 'CREATE', repeat('a', 65536))`,
      [actorId],
      '23514',
    );

    // appendAudit writes masked before/after evidence.
    await appendAudit(client, {
      userId: actorId,
      entityName: 'guest',
      entityId: 'guest-1',
      action: 'CREATE',
      before: { full_name: 'Nimal', password_hash: 'supersecret', nic: '200012345678' },
      after: { full_name: 'Nimal', status: 'active', refresh_token: 'tok' },
      ipAddress: '127.0.0.1',
    });
    const maskedRow = await client.query(
      `SELECT before_value, after_value, ip_address FROM audit_log
        WHERE entity_name = 'guest' AND entity_id = 'guest-1'`,
    );
    assert.equal(maskedRow.rows.length, 1);
    const before = JSON.parse(maskedRow.rows[0].before_value);
    assert.equal(before.password_hash, '[REDACTED]');
    assert.equal(before.nic, '[REDACTED]');
    assert.equal(before.full_name, 'Nimal');
    const after = JSON.parse(maskedRow.rows[0].after_value);
    assert.equal(after.refresh_token, '[REDACTED]');
    assert.equal(after.full_name, 'Nimal');
    assert.equal(maskedRow.rows[0].ip_address, '127.0.0.1');

    // Append-only: UPDATE and DELETE are denied, including for a new row.
    const denied = await client.query(
      `INSERT INTO audit_log (user_id, entity_name, entity_id, action)
       VALUES ($1, 'x', 'y', 'CREATE') RETURNING audit_id`,
      [actorId],
    );
    await expectSqlError(
      client,
      'UPDATE audit_log SET action = $1 WHERE audit_id = $2',
      ['LOGIN', denied.rows[0].audit_id],
      '55000',
    );
    await expectSqlError(
      client,
      'DELETE FROM audit_log WHERE audit_id = $1',
      [denied.rows[0].audit_id],
      '55000',
    );

    // Referenced actor cannot be hard-deleted.
    await expectSqlError(
      client,
      'DELETE FROM user_account WHERE user_id = $1',
      [actorId],
      '23001',
    );
  } finally {
    try {
      await client.query('ROLLBACK');
      const cleanup = await client.query('SELECT to_regnamespace($1) AS schema_name', [schema]);
      assert.equal(cleanup.rows[0].schema_name, null, 'scratch schema must not persist');
    } finally {
      await client.end();
    }
  }
});
