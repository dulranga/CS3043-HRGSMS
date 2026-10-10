const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const branchRoleMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_001_create_branch_and_role.sql'),
  'utf8',
);
const accountOfficerMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_002_create_user_account_and_officer.sql'),
  'utf8',
);

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

test('M1-S03/S04 branch, role, user_account and officer in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m1_identity_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);

    await client.query(branchRoleMigration);
    await client.query(accountOfficerMigration);

    const columns = await client.query(
      `SELECT table_name, column_name, data_type, udt_name,
              character_maximum_length, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name IN ('branch', 'role', 'user_account', 'officer')
        ORDER BY table_name, ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
      [
        'branch.branch_id', 'branch.name', 'branch.city', 'branch.address',
        'branch.active', 'branch.created_at', 'branch.updated_at',
        'officer.officer_id', 'officer.full_name', 'officer.email', 'officer.phone',
        'officer.nic', 'officer.active', 'officer.created_at', 'officer.updated_at',
        'officer.branch_id', 'officer.role_id',
        'role.role_id', 'role.role_name', 'role.description',
        'user_account.user_id', 'user_account.username', 'user_account.password_hash',
        'user_account.active', 'user_account.created_at', 'user_account.updated_at',
        'user_account.last_login_at',
      ],
    );

    for (const [table, field, dataType] of [
      ['branch', 'branch_id', 'uuid'],
      ['role', 'role_id', 'uuid'],
      ['user_account', 'user_id', 'uuid'],
      ['officer', 'officer_id', 'uuid'],
      ['officer', 'branch_id', 'uuid'],
      ['officer', 'role_id', 'uuid'],
      ['branch', 'active', 'boolean'],
      ['role', 'description', 'character varying'],
      ['user_account', 'active', 'boolean'],
      ['user_account', 'last_login_at', 'timestamp with time zone'],
      ['officer', 'active', 'boolean'],
    ]) {
      assert.equal(
        columns.rows.find((row) => row.table_name === table && row.column_name === field).data_type,
        dataType,
        `${table}.${field} must use ${dataType}`,
      );
    }

    for (const [table, field] of [
      ['branch', 'name'], ['branch', 'city'],
      ['role', 'role_name'], ['role', 'description'],
      ['user_account', 'username'],
      ['officer', 'full_name'], ['officer', 'email'], ['officer', 'phone'], ['officer', 'nic'],
    ]) {
      const column = columns.rows.find(
        (row) => row.table_name === table && row.column_name === field,
      );
      assert.equal(column.data_type, 'character varying');
      assert.equal(column.character_maximum_length, 255);
    }
    for (const [table, field] of [['branch', 'address'], ['user_account', 'password_hash']]) {
      assert.equal(
        columns.rows.find((row) => row.table_name === table && row.column_name === field).data_type,
        'text',
        `${table}.${field} must map ER text(65535) to PostgreSQL text`,
      );
    }

    // Seed data: three branches, six roles, one system principal.
    const branchCount = await client.query('SELECT count(*)::int AS count FROM branch');
    assert.equal(branchCount.rows[0].count, 3);
    const roleCount = await client.query('SELECT count(*)::int AS count FROM role');
    assert.equal(roleCount.rows[0].count, 6);
    const roles = await client.query('SELECT role_name FROM role ORDER BY role_name');
    assert.deepEqual(
      roles.rows.map((row) => row.role_name),
      ['AUDITOR', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'FRONT_DESK', 'SERVICE_STAFF', 'SYSTEM_ADMINISTRATOR'],
    );
    const system = await client.query(
      "SELECT user_id, username, password_hash, active FROM user_account WHERE username = 'system'",
    );
    assert.equal(system.rows.length, 1);
    assert.equal(system.rows[0].username, 'system');
    assert.equal(system.rows[0].password_hash, null);
    assert.equal(system.rows[0].active, true);

    // UUIDv7 checks on every table.
    const branch = await client.query(
      `INSERT INTO branch (name, city) VALUES ('Nuwara Eliya', 'Nuwara Eliya')
       RETURNING branch_id, active`,
    );
    const branchId = branch.rows[0].branch_id;
    assert.equal(branch.rows[0].active, true);
    const role = await client.query(
      `INSERT INTO role (role_name, description) VALUES ('TRAINEE', 'Temporary role')
       RETURNING role_id`,
    );
    const roleId = role.rows[0].role_id;
    const versions = await client.query(
      `SELECT uuid_extract_version($1::uuid) AS branch_version,
              uuid_extract_version($2::uuid) AS role_version`,
      [branchId, roleId],
    );
    assert.equal(versions.rows[0].branch_version, 7);
    assert.equal(versions.rows[0].role_version, 7);

    // user_account + shared-key officer: officer_id must equal an existing user_id.
    const account = await client.query(
      `INSERT INTO user_account (username, password_hash)
       VALUES ('nimal.perera', '$2a$12$hashplaceholder')
       RETURNING user_id, active, last_login_at`,
    );
    const userId = account.rows[0].user_id;
    assert.equal(account.rows[0].active, true);
    assert.equal(account.rows[0].last_login_at, null);
    const officer = await client.query(
      `INSERT INTO officer (officer_id, full_name, email, phone, nic, branch_id, role_id)
       VALUES ($1, 'Nimal Perera', 'nimal.perera@skynest.lk', '+94 71 234 5678',
               '200012345678', $2, $3)
       RETURNING officer_id, active`,
      [userId, branchId, roleId],
    );
    assert.equal(officer.rows[0].officer_id, userId);
    assert.equal(officer.rows[0].active, true);

    const secondAccount = await client.query(
      `INSERT INTO user_account (username) VALUES ('other.staff') RETURNING user_id`,
    );
    const secondUserId = secondAccount.rows[0].user_id;

    // branch.name/city non-blank.
    await expectSqlError(client,
      `INSERT INTO branch (name, city) VALUES ('   ', 'X')`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO branch (name, city) VALUES ('X', '   ')`, [], '23514');
    // address length cap (text(65535)).
    await expectSqlError(client,
      `INSERT INTO branch (name, city, address) VALUES ('Long', 'X', repeat('a', 65536))`,
      [], '23514');
    // branch UUID version.
    await expectSqlError(client,
      `INSERT INTO branch (branch_id, name, city) VALUES (uuidv4(), 'Bad', 'X')`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO branch (branch_id, name, city)
       VALUES ('00000000-0000-0000-0000-000000000000', 'Nil', 'X')`, [], '23514');

    // role_name unique and non-blank.
    await expectSqlError(client,
      `INSERT INTO role (role_name) VALUES ('FRONT_DESK')`, [], '23505');
    await expectSqlError(client,
      `INSERT INTO role (role_name) VALUES ('   ')`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO role (role_id, role_name) VALUES (uuidv4(), 'BadRole')`, [], '23514');

    // user_account username unique/non-blank, password_hash length cap, UUID version.
    await expectSqlError(client,
      `INSERT INTO user_account (username) VALUES ('nimal.perera')`, [], '23505');
    await expectSqlError(client,
      `INSERT INTO user_account (username) VALUES ('   ')`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO user_account (username, password_hash)
       VALUES ('longhash', repeat('a', 65536))`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO user_account (user_id, username) VALUES (uuidv4(), 'BadUser')`, [], '23514');

    // officer: shared-key FK, branch/role FK, nic normalization + uniqueness.
    await expectSqlError(client,
      `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
       VALUES (uuidv7(), 'No Account', $1, $2)`,
      [branchId, roleId], '23503');
    await expectSqlError(client,
      `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
       VALUES ($1, 'Bad Branch', '00000000-0000-7000-8000-00000000000a', $2)`,
      [secondUserId, roleId], '23503');
    await expectSqlError(client,
      `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
       VALUES ($1, 'Bad Role', $2, '00000000-0000-7000-8000-00000000000b')`,
      [secondUserId, branchId], '23503');
    // non-normalized nic rejected (must be trimmed/uppercase).
    await expectSqlError(client,
      `INSERT INTO officer (officer_id, full_name, nic, branch_id, role_id)
       VALUES ($1, 'Bad Nic', ' 200012345678 ', $2, $3)`,
      [secondUserId, branchId, roleId], '23514');
    // duplicate non-null nic rejected.
    const thirdAccount = await client.query(
      `INSERT INTO user_account (username) VALUES ('third.staff') RETURNING user_id`,
    );
    await expectSqlError(client,
      `INSERT INTO officer (officer_id, full_name, nic, branch_id, role_id)
       VALUES ($1, 'Dup Nic', '200012345678', $2, $3)`,
      [thirdAccount.rows[0].user_id, branchId, roleId], '23505');

    // Deactivation (active=false) is allowed; hard deletion of referenced parents is restricted.
    await client.query('UPDATE user_account SET active = false WHERE user_id = $1', [userId]);
    const reactivated = await client.query(
      'SELECT active FROM user_account WHERE user_id = $1', [userId],
    );
    assert.equal(reactivated.rows[0].active, false);
    await expectSqlError(client,
      'DELETE FROM branch WHERE branch_id = $1', [branchId], '23001');
    await expectSqlError(client,
      'DELETE FROM role WHERE role_id = $1', [roleId], '23001');
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
