const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migrations = [
  readFileSync(path.join(__dirname, '..', 'migrations', 'm1_001_create_branch_and_role.sql'), 'utf8'),
  readFileSync(path.join(__dirname, '..', 'migrations', 'm1_002_create_user_account_and_officer.sql'), 'utf8'),
  readFileSync(path.join(__dirname, '..', 'migrations', 'm1_003_create_guest_and_guest_account.sql'), 'utf8'),
];

async function expectSqlError(client, sql, values, code) {
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(
      client.query(sql, values),
      (error) => error.code === code,
      `Expected PostgreSQL error ${code}`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

test('M1-S05 guest and guest_account in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m1_guests_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    for (const migration of migrations) {
      await client.query(migration);
    }

    const columns = await client.query(
      `SELECT table_name, column_name, data_type, character_maximum_length,
              is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name IN ('guest', 'guest_account')
        ORDER BY table_name, ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
      [
        'guest.guest_id', 'guest.full_name', 'guest.email', 'guest.phone', 'guest.nic',
        'guest.active', 'guest.created_at', 'guest.updated_at',
        'guest_account.guest_account_id', 'guest_account.guest_id', 'guest_account.user_id',
        'guest_account.created_at', 'guest_account.updated_at',
      ],
    );
    for (const [table, field, dataType] of [
      ['guest', 'guest_id', 'uuid'],
      ['guest_account', 'guest_account_id', 'uuid'],
      ['guest_account', 'guest_id', 'uuid'],
      ['guest_account', 'user_id', 'uuid'],
      ['guest', 'active', 'boolean'],
    ]) {
      assert.equal(
        columns.rows.find((row) => row.table_name === table && row.column_name === field).data_type,
        dataType,
        `${table}.${field} must use ${dataType}`,
      );
    }
    for (const [table, field] of [
      ['guest', 'full_name'], ['guest', 'email'], ['guest', 'phone'], ['guest', 'nic'],
    ]) {
      assert.equal(
        columns.rows.find((row) => row.table_name === table && row.column_name === field).data_type,
        'character varying',
        `${table}.${field} must use character varying`,
      );
    }

    // Valid guest with a normalized NIC.
    const guest = await client.query(
      `INSERT INTO guest (full_name, email, phone, nic)
       VALUES ('Amara Silva', 'amara@example.com', '+94 77 123 4567', '200012345678')
       RETURNING guest_id, active`,
    );
    const guestId = guest.rows[0].guest_id;
    assert.equal(guest.rows[0].active, true);
    const guestVersion = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS v', [guestId],
    );
    assert.equal(guestVersion.rows[0].v, 7);

    // Valid one-to-one link.
    const account = await client.query(
      `INSERT INTO user_account (username) VALUES ('amara.silva') RETURNING user_id`,
    );
    const userId = account.rows[0].user_id;
    const link = await client.query(
      `INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)
       RETURNING guest_account_id`,
      [guestId, userId],
    );
    const linkVersion = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS v', [link.rows[0].guest_account_id],
    );
    assert.equal(linkVersion.rows[0].v, 7);

    // Takeover-prone duplicate links: one account per guest and one guest per account.
    const secondAccount = await client.query(
      `INSERT INTO user_account (username) VALUES ('intruder') RETURNING user_id`,
    );
    await expectSqlError(client,
      `INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)`,
      [guestId, secondAccount.rows[0].user_id], '23505');
    const secondGuest = await client.query(
      `INSERT INTO guest (full_name) VALUES ('Other Guest') RETURNING guest_id`,
    );
    await expectSqlError(client,
      `INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)`,
      [secondGuest.rows[0].guest_id, userId], '23505');

    // FK integrity: guest_id and user_id must exist (use fresh unlinked parents so
    // the only violation is the missing FK target).
    const fkAccount = await client.query(
      `INSERT INTO user_account (username) VALUES ('fk.account') RETURNING user_id`,
    );
    const fkGuest = await client.query(
      `INSERT INTO guest (full_name) VALUES ('FK Guest') RETURNING guest_id`,
    );
    await expectSqlError(client,
      `INSERT INTO guest_account (guest_id, user_id)
       VALUES ('00000000-0000-7000-8000-00000000000c', $1)`,
      [fkAccount.rows[0].user_id], '23503');
    await expectSqlError(client,
      `INSERT INTO guest_account (guest_id, user_id)
       VALUES ($1, '00000000-0000-7000-8000-00000000000d')`,
      [fkGuest.rows[0].guest_id], '23503');

    // guest NIC: non-normalized rejected, duplicate non-null rejected.
    await expectSqlError(client,
      `INSERT INTO guest (full_name, nic) VALUES ('Bad Nic', ' 200012345678 ')`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO guest (full_name, nic) VALUES ('Dup Nic', '200012345678')`, [], '23505');

    // Disjoint staff/guest: an officer's user_account cannot also link as a guest_account.
    const branch = await client.query('SELECT branch_id FROM branch LIMIT 1');
    const role = await client.query(
      "SELECT role_id FROM role WHERE role_name = 'FRONT_DESK'",
    );
    const staffAccount = await client.query(
      `INSERT INTO user_account (username) VALUES ('staff.member') RETURNING user_id`,
    );
    await client.query(
      `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
       VALUES ($1, 'Staff Member', $2, $3)`,
      [staffAccount.rows[0].user_id, branch.rows[0].branch_id, role.rows[0].role_id],
    );
    await expectSqlError(client,
      `INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)`,
      [secondGuest.rows[0].guest_id, staffAccount.rows[0].user_id], '23514');

    // Reverse direction: a guest_account's user_account cannot become an officer.
    const guestOnlyAccount = await client.query(
      `INSERT INTO user_account (username) VALUES ('guest.only') RETURNING user_id`,
    );
    await client.query(
      `INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)`,
      [secondGuest.rows[0].guest_id, guestOnlyAccount.rows[0].user_id],
    );
    await expectSqlError(client,
      `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
       VALUES ($1, 'Clash Officer', $2, $3)`,
      [guestOnlyAccount.rows[0].user_id, branch.rows[0].branch_id, role.rows[0].role_id],
      '23514');

    // Referenced parents cannot be hard-deleted.
    await expectSqlError(client,
      'DELETE FROM guest WHERE guest_id = $1', [guestId], '23001');
    await expectSqlError(client,
      'DELETE FROM user_account WHERE user_id = $1', [userId], '23001');
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
