import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Client } from 'pg';
import {
  SystemConfigValidationError,
  getSystemConfig,
  listSystemConfig,
  setSystemConfig,
  validateSystemConfigInput,
} from '../src/systemConfig';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const migrationsDir = path.join(__dirname, '..', 'migrations');
const migrations = [
  '0000_create_audit_and_config.sql',
  'm1_001_create_branch_and_role.sql',
  'm1_002_create_user_account_and_officer.sql',
  'm1_003_create_guest_and_guest_account.sql',
  'm1_004_create_audit_log.sql',
  'm1_005_create_billing_policy.sql',
  'm1_006_create_system_config.sql',
].map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'));

// Test-only registry; production keys are registered by a reviewed migration.
// tax_rate is registered on purpose to prove the financial-key CHECK still wins.
const TEST_REGISTRY = `
CREATE OR REPLACE FUNCTION system_config_key_registry()
RETURNS TABLE (config_key text, value_pattern text)
LANGUAGE sql STABLE AS $$
    VALUES ('session_idle_timeout_minutes', '^[1-9][0-9]{0,3}$'),
           ('support_contact_label', NULL),
           ('tax_rate', NULL)
$$;`;

async function applyMigrations(client: Client) {
  for (const sql of migrations) {
    await client.query(sql);
  }
}

async function expectSqlError(client: Client, run: () => Promise<unknown>, code: string) {
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(
      run(),
      (error: { code?: string }) => error.code === code,
      `Expected PostgreSQL error ${code}`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

async function createOfficer(
  client: Client,
  username: string,
  roleName: string,
  { accountActive = true, officerActive = true } = {},
) {
  const account = await client.query(
    'INSERT INTO user_account (username, password_hash, active) VALUES ($1, $2, $3) RETURNING user_id',
    [username, 'hash', accountActive],
  );
  const userId = account.rows[0].user_id as string;
  await client.query(
    `INSERT INTO officer (officer_id, full_name, branch_id, role_id, active)
     SELECT $1, $2, (SELECT branch_id FROM branch ORDER BY name LIMIT 1), role_id, $4
       FROM role WHERE role_name = $3`,
    [userId, `Officer ${username}`, roleName, officerActive],
  );
  return userId;
}

async function configAudit(client: Client, key: string) {
  return (
    await client.query(
      `SELECT user_id, action, before_value, after_value
         FROM audit_log
        WHERE entity_name = 'system_config' AND entity_id = $1
        ORDER BY changed_at, audit_id`,
      [key],
    )
  ).rows;
}

test('validateSystemConfigInput rejects malformed, financial and secret keys and blank values', () => {
  assert.deepEqual(validateSystemConfigInput('session_idle_timeout_minutes', '30'), {
    configKey: 'session_idle_timeout_minutes',
    configValue: '30',
  });
  validateSystemConfigInput('support_contact_label', 'x'.repeat(65535));

  const invalid: Array<[unknown, unknown, string]> = [
    ['Session_Timeout', '30', 'configKey'],
    ['1st_key', '30', 'configKey'],
    ['has space', '30', 'configKey'],
    ['', '30', 'configKey'],
    [null, '30', 'configKey'],
    ['k'.repeat(256), '30', 'configKey'],
    ['tax_rate', '8', 'configKey'],
    ['late_checkout_fee', '2000', 'configKey'],
    ['cancellation_window_hours', '24', 'configKey'],
    ['no_show_grace_days', '1', 'configKey'],
    ['smtp_password', 'x', 'configKey'],
    ['api_token', 'x', 'configKey'],
    ['support_contact_label', '', 'configValue'],
    ['support_contact_label', '   ', 'configValue'],
    ['support_contact_label', 42, 'configValue'],
    ['support_contact_label', 'x'.repeat(65536), 'configValue'],
  ];
  for (const [key, value, field] of invalid) {
    assert.throws(
      () => validateSystemConfigInput(key, value),
      (error: unknown) => error instanceof SystemConfigValidationError && field in error.fieldErrors,
      `${String(key)} / ${String(value).slice(0, 20)} must be rejected on ${field}`,
    );
  }
  // Non-financial words that merely contain a banned fragment remain allowed.
  validateSystemConfigInput('operator_display_name', 'x');
  validateSystemConfigInput('feedback_contact_label', 'x');
});

test('M1-S07 system_config contract in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m1_config_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await applyMigrations(client);

    // Column inventory: original Table 40 fields with the shared actor FK.
    const columns = await client.query(
      `SELECT column_name, data_type, character_maximum_length, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'system_config'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map((row) => [row.column_name, row.data_type, row.character_maximum_length, row.is_nullable]),
      [
        ['config_key', 'character varying', 255, 'NO'],
        ['config_value', 'text', null, 'NO'],
        ['effective_from', 'date', null, 'NO'],
        ['updated_by', 'uuid', null, 'NO'],
        ['updated_at', 'timestamp with time zone', null, 'NO'],
      ],
    );
    const pk = await client.query(
      `SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'system_config'::regclass AND i.indisprimary`,
    );
    assert.deepEqual(pk.rows.map((row) => row.attname), ['config_key']);

    // The legacy 0000 financial keys are gone and no keys are seeded.
    assert.deepEqual(await listSystemConfig(client), []);

    const today = (
      await client.query("SELECT ((now() AT TIME ZONE 'Asia/Colombo')::date)::text AS d")
    ).rows[0].d as string;
    const systemUserId = (
      await client.query("SELECT user_id FROM user_account WHERE username = 'system'")
    ).rows[0].user_id as string;
    const admin = await createOfficer(client, 'sys.admin', 'SYSTEM_ADMINISTRATOR');
    const secondAdmin = await createOfficer(client, 'sys.admin2', 'SYSTEM_ADMINISTRATOR');
    const disabledAccountAdmin = await createOfficer(client, 'old.admin', 'SYSTEM_ADMINISTRATOR', {
      accountActive: false,
    });
    const disabledOfficerAdmin = await createOfficer(client, 'off.admin', 'SYSTEM_ADMINISTRATOR', {
      officerActive: false,
    });
    const otherRoles = [];
    for (const role of ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'AUDITOR']) {
      otherRoles.push(await createOfficer(client, role.toLowerCase(), role));
    }
    const guestUser = (
      await client.query(
        "INSERT INTO user_account (username, password_hash) VALUES ('guest.user', 'hash') RETURNING user_id",
      )
    ).rows[0].user_id as string;
    const guestId = (
      await client.query("INSERT INTO guest (full_name) VALUES ('Guest User') RETURNING guest_id")
    ).rows[0].guest_id;
    await client.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [guestId, guestUser]);

    // With the shipped empty registry even an administrator cannot add a key.
    await expectSqlError(
      client,
      () => setSystemConfig(client, 'session_idle_timeout_minutes', '30', admin),
      '23514',
    );

    await client.query(TEST_REGISTRY);
    const key = 'session_idle_timeout_minutes';

    // Unauthorized creation is rejected and leaves no row or audit evidence.
    for (const actor of [
      ...otherRoles,
      disabledAccountAdmin,
      disabledOfficerAdmin,
      guestUser,
      systemUserId,
      '00000000-0000-7000-8000-00000000000c',
    ]) {
      await expectSqlError(client, () => setSystemConfig(client, key, '30', actor), '42501');
    }
    await expectSqlError(
      client,
      () =>
        client.query(
          `INSERT INTO system_config (config_key, config_value, effective_from, updated_by, updated_at)
           VALUES ($1, '30', CURRENT_DATE, NULL, now())`,
          [key],
        ),
      '42501',
    );
    assert.equal(await getSystemConfig(client, key), null);
    assert.deepEqual(await configAudit(client, key), []);

    // Authorized create: database-set activation date and a CREATE audit row.
    const created = await setSystemConfig(client, key, '30', admin);
    assert.equal(created.configValue, '30');
    assert.equal(created.effectiveFrom, today);
    assert.equal(created.updatedBy, admin);
    assert.deepEqual(await configAudit(client, key), [
      { user_id: admin, action: 'CREATE', before_value: null, after_value: '30' },
    ]);

    // Immediate update by another administrator, audited with the old value.
    const updated = await setSystemConfig(client, key, '45', secondAdmin);
    assert.equal(updated.configValue, '45');
    assert.equal(updated.updatedBy, secondAdmin);
    assert.equal(updated.effectiveFrom, today);
    assert.ok(updated.updatedAt.getTime() >= created.updatedAt.getTime());
    assert.equal((await getSystemConfig(client, key))?.configValue, '45');
    const auditAfterUpdate = await configAudit(client, key);
    assert.deepEqual(auditAfterUpdate[1], {
      user_id: secondAdmin,
      action: 'UPDATE',
      before_value: '30',
      after_value: '45',
    });
    const auditTimes = await client.query(
      `SELECT bool_and(a.changed_at = c.updated_at) AS matches
         FROM audit_log a JOIN system_config c ON c.config_key = a.entity_id
        WHERE a.entity_name = 'system_config' AND a.action = 'UPDATE'`,
    );
    assert.equal(auditTimes.rows[0].matches, true);

    // No future scheduling: caller-supplied activation date and time are overwritten.
    await client.query(
      `UPDATE system_config
          SET config_value = '60', effective_from = DATE '2099-01-01',
              updated_at = TIMESTAMPTZ '2099-01-01T00:00:00Z', updated_by = $2
        WHERE config_key = $1`,
      [key, admin],
    );
    const unscheduled = await getSystemConfig(client, key);
    assert.equal(unscheduled?.effectiveFrom, today);
    assert.ok(unscheduled!.updatedAt.getTime() < Date.UTC(2099, 0, 1));

    // Unauthorized and invalid updates roll back: value and audit trail unchanged.
    const auditCount = (await configAudit(client, key)).length;
    for (const actor of [...otherRoles, disabledAccountAdmin, disabledOfficerAdmin, guestUser, systemUserId]) {
      await expectSqlError(client, () => setSystemConfig(client, key, '99', actor), '42501');
    }
    for (const value of ['0', '-5', 'abc', '12345', '30 ']) {
      await expectSqlError(client, () => setSystemConfig(client, key, value, admin), '23514');
    }
    await expectSqlError(
      client,
      () => client.query("UPDATE system_config SET config_value = '   ', updated_by = $2 WHERE config_key = $1", [key, admin]),
      '23514',
    );
    await expectSqlError(
      client,
      () => client.query("UPDATE system_config SET config_key = 'renamed_key', updated_by = $2 WHERE config_key = $1", [key, admin]),
      '23514',
    );
    assert.equal((await getSystemConfig(client, key))?.configValue, '60');
    assert.equal((await configAudit(client, key)).length, auditCount);

    // Validation errors are raised before any database call.
    await assert.rejects(setSystemConfig(client, 'tax_rate', '8', admin), SystemConfigValidationError);
    await assert.rejects(setSystemConfig(client, key, '', admin), SystemConfigValidationError);

    // Financial keys stay rejected by the database even if registered; malformed and
    // unregistered keys are rejected too.
    const rawInsert = (configKey: string, value: string) => () =>
      client.query(
        `INSERT INTO system_config (config_key, config_value, effective_from, updated_by, updated_at)
         VALUES ($1, $2, CURRENT_DATE, $3, now())`,
        [configKey, value, admin],
      );
    await expectSqlError(client, rawInsert('tax_rate', '8'), '23514');
    await expectSqlError(client, rawInsert('Session_Timeout', '8'), '23514');
    await expectSqlError(client, rawInsert('unregistered_key', '8'), '23514');
    await expectSqlError(client, rawInsert('support_contact_label', 'x'.repeat(65536)), '23514');

    // A maximum-length value and its audit evidence both fit the text(65535) caps.
    const longValue = 'x'.repeat(65535);
    await setSystemConfig(client, 'support_contact_label', longValue, admin);
    const longAudit = await configAudit(client, 'support_contact_label');
    assert.equal(longAudit[0].after_value.length, 65535);

    // FR-080: the change and its audit row commit or roll back together.
    await client.query('SAVEPOINT abandoned_change');
    await setSystemConfig(client, key, '90', admin);
    assert.equal((await getSystemConfig(client, key))?.configValue, '90');
    await client.query('ROLLBACK TO SAVEPOINT abandoned_change');
    await client.query('RELEASE SAVEPOINT abandoned_change');
    assert.equal((await getSystemConfig(client, key))?.configValue, '60');
    assert.equal((await configAudit(client, key)).length, auditCount);

    // Settings cannot be deleted or truncated, even by an administrator.
    await expectSqlError(
      client,
      () => client.query('DELETE FROM system_config WHERE config_key = $1', [key]),
      '55000',
    );
    await expectSqlError(client, () => client.query('TRUNCATE system_config'), '55000');

    // The actor referenced by a setting cannot be hard-deleted.
    await client.query('DELETE FROM officer WHERE officer_id = $1', [secondAdmin]);
    await expectSqlError(
      client,
      () => client.query('DELETE FROM user_account WHERE user_id = $1', [secondAdmin]),
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

test('M1-S07 concurrent updates serialize and keep a gap-free audit chain', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const setup = new Client({ connectionString: process.env.PG_URL });
  const first = new Client({ connectionString: process.env.PG_URL });
  const second = new Client({ connectionString: process.env.PG_URL });
  const schema = `m1_config_race_${randomBytes(8).toString('hex')}`;
  const key = 'session_idle_timeout_minutes';
  let setupCommitted = false;
  let sessionsConnected = false;

  await setup.connect();
  try {
    await setup.query('BEGIN');
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET LOCAL search_path TO "${schema}"`);
    await applyMigrations(setup);
    await setup.query(TEST_REGISTRY);
    const admin = await createOfficer(setup, 'race.admin', 'SYSTEM_ADMINISTRATOR');
    await setSystemConfig(setup, key, '30', admin);
    await setup.query('COMMIT');
    setupCommitted = true;

    await Promise.all([first.connect(), second.connect()]);
    sessionsConnected = true;
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}"`);
    await second.query(`SET LOCAL search_path TO "${schema}"`);
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    await setSystemConfig(first, key, '45', admin);
    const competing = setSystemConfig(second, key, '60', admin);

    let blocked = false;
    for (let attempt = 0; attempt < 40 && !blocked; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const waitState = await setup.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [
        secondPid,
      ]);
      blocked = waitState.rows[0].blocked;
    }
    assert.equal(blocked, true, 'the competing update must wait on the row lock');

    await first.query('COMMIT');
    const winner = await competing;
    await second.query('COMMIT');
    assert.equal(winner.configValue, '60');

    const audit = await setup.query(
      `SELECT action, before_value, after_value FROM "${schema}".audit_log
        WHERE entity_name = 'system_config' AND entity_id = $1
        ORDER BY changed_at, audit_id`,
      [key],
    );
    assert.deepEqual(audit.rows, [
      { action: 'CREATE', before_value: null, after_value: '30' },
      { action: 'UPDATE', before_value: '30', after_value: '45' },
      { action: 'UPDATE', before_value: '45', after_value: '60' },
    ]);
  } finally {
    if (!setupCommitted) {
      try { await setup.query('ROLLBACK'); } catch {}
    }
    if (sessionsConnected) {
      try { await first.query('ROLLBACK'); } catch {}
      try { await second.query('ROLLBACK'); } catch {}
      try { await first.end(); } catch {}
      try { await second.end(); } catch {}
    }
    if (setupCommitted) {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await setup.end();
  }
});
