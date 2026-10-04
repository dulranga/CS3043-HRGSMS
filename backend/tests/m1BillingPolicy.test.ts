import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Client } from 'pg';
import {
  BillingPolicyInput,
  BillingPolicyValidationError,
  findEffectiveBillingPolicy,
  getBillingPolicy,
  isProductionEnvironment,
  listBillingPolicies,
  publishBillingPolicy,
  validateBillingPolicyInput,
} from '../src/billingPolicy';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const migrationsDir = path.join(__dirname, '..', 'migrations');
const migrations = [
  'm1_001_create_branch_and_role.sql',
  'm1_002_create_user_account_and_officer.sql',
  'm1_003_create_guest_and_guest_account.sql',
  'm1_004_create_audit_log.sql',
  'm1_005_create_billing_policy.sql',
].map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'));

const DEV = { production: false };
const PROD = { production: true };

function policy(overrides: Partial<BillingPolicyInput> = {}): BillingPolicyInput {
  return {
    effectiveFrom: '2026-11-01',
    taxPercent: '18.00',
    serviceChargePercent: '10.00',
    maxDiscountPercent: '25.00',
    cancellationFee: '5000.00',
    noShowFee: '7500.00',
    lateCheckoutFee: '2500.00',
    noShowGraceDays: 1,
    isDemo: false,
    ...overrides,
  };
}

async function applyMigrations(client: Client) {
  for (const sql of migrations) {
    await client.query(sql);
  }
}

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

async function expectPromiseSqlError(client: Client, run: () => Promise<unknown>, code: string) {
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

// Exact database timestamps as text; a JavaScript Date would drop microseconds
// and use the client clock rather than the database clock.
async function dbNow(client: Client): Promise<string> {
  return (await client.query('SELECT clock_timestamp()::text AS t')).rows[0].t;
}

async function publishedAt(client: Client, billingPolicyId: string): Promise<string> {
  return (
    await client.query('SELECT created_at::text AS t FROM billing_policy WHERE billing_policy_id = $1', [
      billingPolicyId,
    ])
  ).rows[0].t;
}

async function createOfficer(client: Client, username: string, roleName: string, active = true) {
  const account = await client.query(
    'INSERT INTO user_account (username, password_hash, active) VALUES ($1, $2, $3) RETURNING user_id',
    [username, 'hash', active],
  );
  const userId = account.rows[0].user_id;
  await client.query(
    `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
     SELECT $1, $2, (SELECT branch_id FROM branch ORDER BY name LIMIT 1), role_id
       FROM role WHERE role_name = $3`,
    [userId, `Officer ${username}`, roleName],
  );
  return userId as string;
}

test('validateBillingPolicyInput enforces typed bounds and production demo rejection', () => {
  const ok = validateBillingPolicyInput(policy({ taxPercent: 18, cancellationFee: ' 0.5 ' }), DEV);
  assert.equal(ok.taxPercent, '18');
  assert.equal(ok.cancellationFee, '0.5');
  validateBillingPolicyInput(policy({ taxPercent: '100', noShowGraceDays: 7 }), DEV);
  validateBillingPolicyInput(policy({ isDemo: true }), DEV);

  const invalid: Array<[Partial<BillingPolicyInput>, string]> = [
    [{ effectiveFrom: '2026-02-30' }, 'effectiveFrom'],
    [{ effectiveFrom: '01/11/2026' }, 'effectiveFrom'],
    [{ taxPercent: '100.01' }, 'taxPercent'],
    [{ serviceChargePercent: '-1' }, 'serviceChargePercent'],
    [{ maxDiscountPercent: '12.345' }, 'maxDiscountPercent'],
    [{ cancellationFee: '-0.01' }, 'cancellationFee'],
    [{ noShowFee: 'abc' }, 'noShowFee'],
    [{ lateCheckoutFee: '12345678901.00' }, 'lateCheckoutFee'],
    [{ lateCheckoutFee: Number.NaN }, 'lateCheckoutFee'],
    [{ noShowGraceDays: 0 }, 'noShowGraceDays'],
    [{ noShowGraceDays: 8 }, 'noShowGraceDays'],
    [{ noShowGraceDays: 1.5 }, 'noShowGraceDays'],
    [{ isDemo: undefined as unknown as boolean }, 'isDemo'],
  ];
  for (const [overrides, field] of invalid) {
    assert.throws(
      () => validateBillingPolicyInput(policy(overrides), DEV),
      (error: unknown) =>
        error instanceof BillingPolicyValidationError && field in error.fieldErrors,
      `${field} ${JSON.stringify(overrides)} must be rejected`,
    );
  }

  assert.throws(
    () => validateBillingPolicyInput(policy({ isDemo: true }), PROD),
    (error: unknown) => error instanceof BillingPolicyValidationError && 'isDemo' in error.fieldErrors,
  );
  assert.equal(isProductionEnvironment({ NODE_ENV: 'production' }), true);
  assert.equal(isProductionEnvironment({ NODE_ENV: 'development' }), false);
});

test('M1-S19 billing_policy contract in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m1_policy_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await applyMigrations(client);

    // Column inventory and types.
    const columns = await client.query(
      `SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'billing_policy'
        ORDER BY ordinal_position`,
      [schema],
    );
    const expected: Array<[string, string, number | null, number | null]> = [
      ['billing_policy_id', 'uuid', null, null],
      ['effective_from', 'date', null, null],
      ['tax_percent', 'numeric', 5, 2],
      ['service_charge_percent', 'numeric', 5, 2],
      ['max_discount_percent', 'numeric', 5, 2],
      ['cancellation_fee', 'numeric', 12, 2],
      ['no_show_fee', 'numeric', 12, 2],
      ['late_checkout_fee', 'numeric', 12, 2],
      ['no_show_grace_days', 'smallint', 16, 0],
      ['is_demo', 'boolean', null, null],
      ['created_by', 'uuid', null, null],
      ['created_at', 'timestamp with time zone', null, null],
    ];
    assert.deepEqual(columns.rows.map((row) => row.column_name), expected.map(([name]) => name));
    for (const [name, dataType, precision, scale] of expected) {
      const column = columns.rows.find((row) => row.column_name === name);
      assert.equal(column.data_type, dataType, `${name} type`);
      assert.equal(column.is_nullable, 'NO', `${name} must be NOT NULL`);
      if (dataType === 'numeric') {
        assert.equal(column.numeric_precision, precision, `${name} precision`);
        assert.equal(column.numeric_scale, scale, `${name} scale`);
      }
    }

    // Demo seed: zero rates/fees, one grace day, published by the system principal and audited.
    const systemUserId = (
      await client.query("SELECT user_id FROM user_account WHERE username = 'system'")
    ).rows[0].user_id;
    const seeded = await listBillingPolicies(client);
    assert.equal(seeded.length, 1);
    const demo = seeded[0];
    assert.equal(demo.isDemo, true);
    assert.equal(demo.noShowGraceDays, 1);
    assert.equal(demo.createdBy, systemUserId);
    for (const field of [
      'taxPercent', 'serviceChargePercent', 'maxDiscountPercent',
      'cancellationFee', 'noShowFee', 'lateCheckoutFee',
    ] as const) {
      assert.equal(Number(demo[field]), 0, `demo ${field} must be zero`);
    }
    const demoVersion = await client.query('SELECT uuid_extract_version($1::uuid) AS v', [
      demo.billingPolicyId,
    ]);
    assert.equal(demoVersion.rows[0].v, 7);
    const demoAudit = await client.query(
      `SELECT user_id, action FROM audit_log
        WHERE entity_name = 'billing_policy' AND entity_id = $1`,
      [demo.billingPolicyId],
    );
    assert.deepEqual(demoAudit.rows, [{ user_id: systemUserId, action: 'PUBLISH' }]);

    const today = (
      await client.query("SELECT ((now() AT TIME ZONE 'Asia/Colombo')::date)::text AS d")
    ).rows[0].d as string;
    assert.ok(today >= '2026-01-01', 'test assumes the database clock is on or after the demo date');

    const chainManager = await createOfficer(client, 'chain.manager', 'CHAIN_MANAGER');
    const frontDesk = await createOfficer(client, 'front.desk', 'FRONT_DESK');
    const branchManager = await createOfficer(client, 'branch.manager', 'BRANCH_MANAGER');
    const sysAdmin = await createOfficer(client, 'sys.admin', 'SYSTEM_ADMINISTRATOR');
    const inactiveChainManager = await createOfficer(client, 'old.chain', 'CHAIN_MANAGER', false);
    const guestUser = (
      await client.query(
        "INSERT INTO user_account (username, password_hash) VALUES ('guest.user', 'hash') RETURNING user_id",
      )
    ).rows[0].user_id;
    const guestId = (
      await client.query("INSERT INTO guest (full_name) VALUES ('Guest User') RETURNING guest_id")
    ).rows[0].guest_id;
    await client.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [
      guestId,
      guestUser,
    ]);

    // Unauthorized publication is rejected by the database (42501).
    for (const actor of [frontDesk, branchManager, sysAdmin, inactiveChainManager, guestUser]) {
      await expectPromiseSqlError(
        client,
        () => publishBillingPolicy(client, policy({ effectiveFrom: today }), actor, DEV),
        '42501',
      );
    }
    // The system principal may publish demo rows only.
    await expectPromiseSqlError(
      client,
      () => publishBillingPolicy(client, policy({ effectiveFrom: today }), systemUserId, DEV),
      '42501',
    );
    await expectPromiseSqlError(
      client,
      () =>
        publishBillingPolicy(
          client,
          policy({ effectiveFrom: today }),
          '00000000-0000-7000-8000-00000000000c',
          DEV,
        ),
      '42501',
    );
    // Production rejects demo publication before touching the database.
    await assert.rejects(
      publishBillingPolicy(client, policy({ effectiveFrom: today, isDemo: true }), chainManager, PROD),
      BillingPolicyValidationError,
    );
    assert.equal((await listBillingPolicies(client)).length, 1);

    // Production lookup ignores the demo row: no applicable policy blocks confirmation.
    assert.equal(await findEffectiveBillingPolicy(client, PROD, await dbNow(client)), null);
    const devBefore = await findEffectiveBillingPolicy(client, DEV, await dbNow(client));
    assert.equal(devBefore?.billingPolicyId, demo.billingPolicyId);

    // Database bounds (23514), required fields (23502) and UUIDv7-only IDs.
    const insertSql = `INSERT INTO billing_policy (
        billing_policy_id, effective_from, tax_percent, service_charge_percent,
        max_discount_percent, cancellation_fee, no_show_fee, late_checkout_fee,
        no_show_grace_days, is_demo, created_by
      ) VALUES (COALESCE($1, uuidv7()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
    const valid = [null, today, 0, 0, 0, 0, 0, 0, 1, false, chainManager];
    const withValue = (index: number, value: unknown) =>
      valid.map((existing, i) => (i === index ? value : existing));
    for (const [index, value] of [
      [2, 100.01], [2, -0.01], [3, 101], [3, -1], [4, 100.5], [4, -5],
      [5, -0.01], [6, -1], [7, -100], [8, 0], [8, 8],
    ] as Array<[number, unknown]>) {
      await expectSqlError(client, insertSql, withValue(index, value), '23514');
    }
    await expectSqlError(client, insertSql, withValue(0, '00000000-0000-4000-8000-000000000000'), '23514');
    await expectSqlError(client, insertSql, withValue(9, null), '23502');
    await expectSqlError(client, insertSql, withValue(1, null), '23502');

    // created_at is set by the database at publication, not by the caller.
    const backdated = await client.query(
      `INSERT INTO billing_policy (
         effective_from, tax_percent, service_charge_percent, max_discount_percent,
         cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
         is_demo, created_by, created_at
       ) VALUES ('2025-01-01', 0, 0, 0, 0, 0, 0, 1, true, $1, '2000-01-01T00:00:00Z')
       RETURNING created_at`,
      [systemUserId],
    );
    assert.ok(backdated.rows[0].created_at.getTime() > Date.UTC(2020, 0, 1));

    // Authorized publication with an audit PUBLISH row by the same actor.
    const first = await publishBillingPolicy(client, policy({ effectiveFrom: today }), chainManager, DEV);
    assert.equal(first.taxPercent, '18.00');
    assert.equal(first.cancellationFee, '5000.00');
    assert.equal(first.effectiveFrom, today);
    assert.equal(first.createdBy, chainManager);
    const firstAudit = await client.query(
      `SELECT user_id, action, after_value FROM audit_log
        WHERE entity_name = 'billing_policy' AND entity_id = $1`,
      [first.billingPolicyId],
    );
    assert.equal(firstAudit.rows.length, 1);
    assert.equal(firstAudit.rows[0].user_id, chainManager);
    assert.equal(firstAudit.rows[0].action, 'PUBLISH');
    assert.equal(JSON.parse(firstAudit.rows[0].after_value).tax_percent, 18);

    // Same-date correction: a later row with the same effective_from supersedes
    // for confirmations after its publication only.
    const correction = await publishBillingPolicy(
      client,
      policy({ effectiveFrom: today, taxPercent: '15.00' }),
      chainManager,
      DEV,
    );
    const firstPublishedAt = await publishedAt(client, first.billingPolicyId);
    const correctionPublishedAt = await publishedAt(client, correction.billingPolicyId);
    const ordering = await client.query(
      'SELECT $1::timestamptz < $2::timestamptz AS later',
      [firstPublishedAt, correctionPublishedAt],
    );
    assert.equal(ordering.rows[0].later, true);
    const latest = await findEffectiveBillingPolicy(client, DEV, await dbNow(client));
    assert.equal(latest?.billingPolicyId, correction.billingPolicyId);
    assert.equal(latest?.taxPercent, '15.00');
    const betweenPublications = await findEffectiveBillingPolicy(client, DEV, firstPublishedAt);
    assert.equal(betweenPublications?.billingPolicyId, first.billingPolicyId);
    const beforeFirst = (
      await client.query("SELECT ($1::timestamptz - interval '1 microsecond')::text AS t", [
        firstPublishedAt,
      ])
    ).rows[0].t as string;
    assert.equal(
      (await findEffectiveBillingPolicy(client, DEV, beforeFirst))?.billingPolicyId,
      demo.billingPolicyId,
    );
    assert.equal(await findEffectiveBillingPolicy(client, PROD, beforeFirst), null);
    assert.equal(
      (await findEffectiveBillingPolicy(client, PROD, await dbNow(client)))?.billingPolicyId,
      correction.billingPolicyId,
    );
    // Without an explicit time the transaction start (now()) is the confirmation
    // instant; this test transaction began before even the demo seed was published.
    assert.equal(await findEffectiveBillingPolicy(client, DEV), null);
    assert.equal(await findEffectiveBillingPolicy(client, PROD), null);
    // The earlier row is preserved and readable for existing invoice FKs.
    assert.equal((await getBillingPolicy(client, first.billingPolicyId))?.taxPercent, '18.00');

    // Future effective date applies from its Asia/Colombo local midnight.
    const tomorrow = (
      await client.query("SELECT ($1::date + 1)::text AS d", [today])
    ).rows[0].d as string;
    const future = await publishBillingPolicy(
      client,
      policy({ effectiveFrom: tomorrow, taxPercent: '20.00' }),
      chainManager,
      DEV,
    );
    const instants = (
      await client.query(
        `SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Colombo') - interval '1 minute' AS before_midnight,
                ($1::date::timestamp AT TIME ZONE 'Asia/Colombo') + interval '30 minutes' AS after_midnight`,
        [tomorrow],
      )
    ).rows[0];
    assert.equal(
      (await findEffectiveBillingPolicy(client, DEV, instants.before_midnight))?.billingPolicyId,
      correction.billingPolicyId,
    );
    assert.equal(
      (await findEffectiveBillingPolicy(client, DEV, instants.after_midnight))?.billingPolicyId,
      future.billingPolicyId,
    );
    assert.equal(
      (await findEffectiveBillingPolicy(client, DEV, await dbNow(client)))?.billingPolicyId,
      correction.billingPolicyId,
    );

    // History ordering: newest effective version first, same-date by publication time.
    const history = await listBillingPolicies(client);
    const ids = history.map((row) => row.billingPolicyId);
    assert.ok(ids.indexOf(future.billingPolicyId) < ids.indexOf(correction.billingPolicyId));
    assert.ok(ids.indexOf(correction.billingPolicyId) < ids.indexOf(first.billingPolicyId));

    // Append-only: no UPDATE, DELETE or TRUNCATE, even by the publisher.
    await expectSqlError(
      client,
      'UPDATE billing_policy SET tax_percent = 0 WHERE billing_policy_id = $1',
      [first.billingPolicyId],
      '55000',
    );
    await expectSqlError(
      client,
      'DELETE FROM billing_policy WHERE billing_policy_id = $1',
      [first.billingPolicyId],
      '55000',
    );
    await expectSqlError(client, 'TRUNCATE billing_policy', [], '55000');

    // A publisher referenced by a policy cannot be hard-deleted.
    await client.query('DELETE FROM officer WHERE officer_id = $1', [chainManager]);
    await expectSqlError(client, 'DELETE FROM user_account WHERE user_id = $1', [chainManager], '23001');
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

// Verbatim copy of Member 4's interim dev-branch mock (commit 7e8d1a6,
// m1_004_billing_policy_mock.sql), which m1_005 must upgrade in place.
const DEV_BRANCH_MOCK = `
CREATE TABLE IF NOT EXISTS billing_policy (
    billing_policy_id uuid PRIMARY KEY DEFAULT uuidv7(),
    effective_from date NOT NULL,
    tax_percent numeric(5, 2) NOT NULL CHECK (tax_percent BETWEEN 0 AND 100),
    service_charge_percent numeric(5, 2) NOT NULL CHECK (service_charge_percent BETWEEN 0 AND 100),
    max_discount_percent numeric(5, 2) NOT NULL CHECK (max_discount_percent BETWEEN 0 AND 100),
    cancellation_fee numeric(12, 2) NOT NULL CHECK (cancellation_fee >= 0),
    no_show_fee numeric(12, 2) NOT NULL CHECK (no_show_fee >= 0),
    late_checkout_fee numeric(12, 2) NOT NULL CHECK (late_checkout_fee >= 0),
    no_show_grace_days smallint NOT NULL CHECK (no_show_grace_days BETWEEN 1 AND 7),
    is_demo boolean NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT billing_policy_effective_created_unique UNIQUE (effective_from, created_at),
    CONSTRAINT billing_policy_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);`;

test('M1-S19 upgrades the dev-branch mock table in place and re-runs idempotently', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m1_policy_upgrade_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    for (const sql of migrations.slice(0, 4)) {
      await client.query(sql);
    }
    await client.query(DEV_BRANCH_MOCK);
    // A dependent FK like Member 4's invoice must survive the upgrade.
    await client.query(
      `CREATE TABLE invoice_fk_probe (
         billing_policy_id uuid REFERENCES billing_policy (billing_policy_id)
       )`,
    );

    await client.query(migrations[4]);
    await client.query(migrations[4]);

    const triggers = await client.query(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'billing_policy'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    assert.deepEqual(triggers.rows.map((row) => row.tgname), [
      'billing_policy_append_only_trigger',
      'billing_policy_audit_publish_trigger',
      'billing_policy_before_publish_trigger',
      'billing_policy_no_truncate_trigger',
    ]);
    const createdAtDefault = await client.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'billing_policy' AND column_name = 'created_at'`,
      [schema],
    );
    assert.equal(createdAtDefault.rows[0].column_default, 'clock_timestamp()');

    const policies = await listBillingPolicies(client);
    assert.equal(policies.length, 1, 'the demo seed is inserted once');
    assert.equal(policies[0].isDemo, true);

    await expectSqlError(
      client,
      `INSERT INTO billing_policy (
         billing_policy_id, effective_from, tax_percent, service_charge_percent,
         max_discount_percent, cancellation_fee, no_show_fee, late_checkout_fee,
         no_show_grace_days, is_demo, created_by
       ) SELECT uuidv4(), CURRENT_DATE, 0, 0, 0, 0, 0, 0, 1, true, user_id
           FROM user_account WHERE username = 'system'`,
      [],
      '23514',
    );
    await expectSqlError(client, 'UPDATE billing_policy SET tax_percent = 1', [], '55000');
    await client.query('INSERT INTO invoice_fk_probe VALUES ($1)', [policies[0].billingPolicyId]);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  }
});

test('M1-S19 serializes concurrent same-date publications', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const admin = new Client({ connectionString: process.env.PG_URL });
  const first = new Client({ connectionString: process.env.PG_URL });
  const second = new Client({ connectionString: process.env.PG_URL });
  const schema = `m1_policy_race_${randomBytes(8).toString('hex')}`;
  let setupCommitted = false;
  let sessionsConnected = false;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}"`);
    await applyMigrations(admin);
    const chainManager = await createOfficer(admin, 'race.chain', 'CHAIN_MANAGER');
    await admin.query('COMMIT');
    setupCommitted = true;

    await Promise.all([first.connect(), second.connect()]);
    sessionsConnected = true;
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}"`);
    await second.query(`SET LOCAL search_path TO "${schema}"`);
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    const firstPolicy = await publishBillingPolicy(
      first, policy({ effectiveFrom: '2026-12-01' }), chainManager, DEV,
    );
    const competing = publishBillingPolicy(
      second, policy({ effectiveFrom: '2026-12-01', taxPercent: '12.00' }), chainManager, DEV,
    );

    let blocked = false;
    for (let attempt = 0; attempt < 40 && !blocked; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const waitState = await admin.query(
        'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked',
        [secondPid],
      );
      blocked = waitState.rows[0].blocked;
    }
    assert.equal(blocked, true, 'the competing publication must wait on the publication lock');

    await first.query('COMMIT');
    const secondPolicy = await competing;
    await second.query('COMMIT');

    const rows = await admin.query(
      `SELECT billing_policy_id FROM "${schema}".billing_policy
        WHERE effective_from = DATE '2026-12-01'
        ORDER BY created_at DESC, billing_policy_id DESC`,
    );
    assert.deepEqual(
      rows.rows.map((row) => row.billing_policy_id),
      [secondPolicy.billingPolicyId, firstPolicy.billingPolicyId],
    );
  } finally {
    if (!setupCommitted) {
      try { await admin.query('ROLLBACK'); } catch {}
    }
    if (sessionsConnected) {
      try { await first.query('ROLLBACK'); } catch {}
      try { await second.query('ROLLBACK'); } catch {}
      try { await first.end(); } catch {}
      try { await second.end(); } catch {}
    }
    if (setupCommitted) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await admin.end();
  }
});
