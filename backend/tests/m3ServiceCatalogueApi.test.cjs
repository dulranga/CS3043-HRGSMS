const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
const db = require('../src/db');
const roleSql = require('node:fs').readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_001_create_branch_and_role.sql'),
  'utf8',
);
const userSql = require('node:fs').readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_002_create_user_account_and_officer.sql'),
  'utf8',
);
const serviceSql = require('node:fs').readFileSync(
  path.join(__dirname, '..', 'migrations', 'm3_004_service_catalogue.sql'),
  'utf8',
);

async function withScratchSchema(testFn) {
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_service_api_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await client.connect();
  const previousQuery = db.pool.query.bind(db.pool);

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(roleSql);
    await client.query(userSql);
    await client.query(serviceSql);

    const roleRows = await client.query('SELECT role_id, role_name FROM role');
    const chainRole = roleRows.rows.find((row) => row.role_name === 'CHAIN_MANAGER');
    const frontDeskRole = roleRows.rows.find((row) => row.role_name === 'FRONT_DESK');

    const managerUserId = '11111111-1111-7111-8111-111111111111';
    const frontDeskUserId = '22222222-2222-7222-8222-222222222222';
    await client.query(
      `INSERT INTO user_account (user_id, username, password_hash, active)
       VALUES ($1, 'chain.manager', 'hash', true), ($2, 'frontdesk.staff', 'hash', true)
       ON CONFLICT DO NOTHING`,
      [managerUserId, frontDeskUserId],
    );

    const branchRows = await client.query('SELECT branch_id FROM branch LIMIT 1');
    await client.query(
      `INSERT INTO officer (officer_id, full_name, email, phone, nic, active, branch_id, role_id)
       VALUES ($1, 'Chain Manager', 'chain@example.com', '000', 'DCHAIN01', true, $2, $3),
              ($4, 'Front Desk', 'desk@example.com', '111', 'DFRONT01', true, $2, $5)
       ON CONFLICT DO NOTHING`,
      [managerUserId, branchRows.rows[0].branch_id, chainRole.role_id, frontDeskUserId, frontDeskRole.role_id],
    );

    db.pool.query = client.query.bind(client);
    await testFn({ managerUserId, frontDeskUserId, schema, client });
  } finally {
    db.pool.query = previousQuery;
    await client.query('ROLLBACK');
    await client.end();
  }
}

test('M3-S05 service catalogue API allows CHAIN_MANAGER writes and blocks staff edits', async () => {
  await withScratchSchema(async ({ managerUserId, frontDeskUserId }) => {
    const serviceController = await import('../src/controllers/serviceController.ts');
    const { listServices, createService, updateService } = serviceController;

    const listResponse = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await listServices({ query: { active: 'true' }, user: { userId: managerUserId } }, listResponse);
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(listResponse.body, []);

    const created = {
      statusCode: 201,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await createService({
      body: { name: 'Room Service', category: 'Food & Beverage', current_price: 1250.5, active: true },
      user: { userId: managerUserId },
    }, created);
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.service.name, 'Room Service');
    assert.equal(created.body.service.current_price, '1250.50');

    const forbidden = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await createService({
      body: { name: 'Laundry', category: 'Housekeeping', current_price: 900 },
      user: { userId: frontDeskUserId },
    }, forbidden);
    assert.equal(forbidden.statusCode, 403);

    const updated = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    const serviceId = created.body.service.service_id;
    await updateService({
      params: { serviceId },
      body: { current_price: 1400, active: false },
      user: { userId: managerUserId },
    }, updated);
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.service.current_price, '1400.00');
    assert.equal(updated.body.service.active, false);

    const listAll = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await listServices({ user: { userId: frontDeskUserId } }, listAll);
    assert.equal(listAll.statusCode, 200);
    assert.ok(Array.isArray(listAll.body));
    assert.equal(listAll.body[0].name, 'Room Service');
  });
});
