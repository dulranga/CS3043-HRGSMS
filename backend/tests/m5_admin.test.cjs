const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { isolatedDatabase } = require('./helpers/isolatedDatabase.cjs');

test('production app mounts feature routes and audits administration with session-derived identity', async () => {
  const fixture = await isolatedDatabase();
  const { client, db, schema } = fixture;
  const oldSchema = process.env.PG_SCHEMA;
  process.env.PG_SCHEMA = schema;
  const { pool } = require('../src/db');
  const oldQuery = pool.query;
  const oldConnect = pool.connect;
  pool.query = db.query.bind(db);
  pool.connect = db.connect.bind(db);
  let server;
  try {
    const branch = (await client.query('SELECT branch_id FROM branch ORDER BY branch_id LIMIT 1')).rows[0].branch_id;
    const password = 'test-only-correct-password';
    const hash = await bcrypt.hash(password, 4);
    const actors = {};
    for (const [username, role] of [['admin','SYSTEM_ADMINISTRATOR'],['frontdesk','FRONT_DESK'],['manager','BRANCH_MANAGER'],['chain','CHAIN_MANAGER'],['auditor','AUDITOR'],['service','SERVICE_STAFF']]) {
      const id = (await client.query('INSERT INTO user_account(username,password_hash) VALUES ($1,$2) RETURNING user_id', [username,hash])).rows[0].user_id;
      await client.query('INSERT INTO officer(officer_id,full_name,branch_id,role_id) SELECT $1,$2,$3,role_id FROM role WHERE role_name=$4', [id,username,branch,role]);
      actors[username] = id;
    }
    const { createApplication } = require('../src/app');
    const app = createApplication({ SESSION_SECRET: 'isolated-qa-secret-0123456789-abcdefghijklmnop', SESSION_COOKIE_SECURE: 'false' });
    server = await new Promise(resolve => { const listening = app.listen(0,'127.0.0.1', () => resolve(listening)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookies = {};
    async function request(as, path, method = 'GET', body) {
      const response = await fetch(base + path, { method, headers: { ...(cookies[as] ? { Cookie: cookies[as] } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const content = await response.text();
      return { status: response.status, content, json: response.headers.get('content-type')?.includes('json') ? JSON.parse(content) : null, response };
    }
    for (const username of Object.keys(actors)) {
      const login = await request(null,'/api/auth/login','POST',{username,password});
      assert.equal(login.status,200,username);
      cookies[username] = login.response.headers.get('set-cookie').split(';')[0];
    }
    assert.equal((await request(null,'/api/availability/options')).status,200,'public inventory stays public');
    for (const [method,path] of [['GET','/api/bookings'],['POST','/api/bookings/quote'],['POST','/api/guest/bookings/quote'],['GET','/api/services'],['GET','/api/stays/missing'],['POST','/api/bookings/missing/lines/invalid/checkin'],['PATCH','/api/rooms/invalid/condition']]) {
      assert.equal((await request(null,path,method,method==='GET'?undefined:{})).status,401,path);
    }
    assert.equal((await request('frontdesk','/api/bookings')).status,200);
    assert.equal((await request('frontdesk','/api/bookings/quote','POST',{})).status,400);
    assert.equal((await request('admin','/api/bookings/quote','POST',{})).status,403);
    assert.equal((await request('frontdesk','/api/guest/bookings')).status,403);
    assert.equal((await request('frontdesk','/api/services')).status,200);
    assert.equal((await request('frontdesk','/api/stays/missing')).status,404);
    assert.equal((await request('frontdesk','/api/bookings/missing/lines/invalid/checkin','POST',{})).status,400);
    assert.equal((await request('service','/api/rooms/invalid/condition','PATCH',{})).status,400);
    const created = await request('admin','/api/admin/branches','POST',{name:'QA, Branch',city:'QA City'});
    assert.equal(created.status,201,created.content);
    const branchId = created.json.data.branchId;
    assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_name='branch' AND entity_id=$1 AND action='CREATE' AND user_id=$2",[branchId,actors.admin])).rows[0].n,1);
    assert.equal((await request('admin',`/api/admin/users/${actors.admin}/status`,'PATCH',{active:false})).status,403);
    assert.equal((await request('admin',`/api/admin/users/${actors.frontdesk}/status`,'PATCH',{active:false})).status,200);
    const disabled = (await client.query('SELECT u.active AS account,o.active AS officer FROM user_account u JOIN officer o ON o.officer_id=u.user_id WHERE u.user_id=$1',[actors.frontdesk])).rows[0];
    assert.deepEqual(disabled,{account:false,officer:false});
    assert.equal((await request('frontdesk','/api/bookings')).status,401,'old cookie loses access after disable');
    assert.equal((await request('admin',`/api/admin/users/${actors.frontdesk}/status`,'PATCH',{active:true})).status,200);
    const registered = await request('admin','/api/admin/configs');
    assert.equal(registered.status,200);
    assert.equal(registered.json.find(entry => entry.config_key === 'session_idle_timeout_minutes').config_value,null,'the first approved setting can be initialized from the UI');
    const config = await request('admin','/api/admin/configs/session_idle_timeout_minutes','PUT',{config_value:'40'});
    assert.equal(config.status,200,config.content);
    assert.equal(config.json.updated_by,actors.admin);
    assert.equal((await request('admin','/api/admin/configs/session_idle_timeout_minutes','PUT',{config_value:'45',updated_by:actors.chain})).status,400);
    assert.equal((await request('admin','/api/admin/configs/tax_rate','PUT',{config_value:'9'})).status,400);
    assert.equal((await request('auditor',`/api/admin/users/${actors.frontdesk}/status`,'PATCH',{active:false})).status,403);
    const users = await request('admin','/api/admin/users?active=true');
    assert.equal(users.status,200);
    assert.ok(users.json.every(user => user.username !== 'system' && !('password_hash' in user)));
    for (const path of ['/api/reports/billing','/api/reports/billing/export','/api/reports/occupancy/export']) assert.equal((await request('manager',path)).status,200,path);
    for (const path of ['/api/reports/preference/trends','/api/reports/trends/export','/api/reports/service-usage/export']) assert.equal((await request('chain',path)).status,200,path);
    assert.equal((await request('auditor','/api/reports/audit-logs/export')).status,200);
    assert.equal((await request('chain','/api/reports/revenue?year=bad')).status,400);
    assert.equal((await request('chain','/api/reports/guest-history?limit=-1')).status,400);
    const missing = '00000000-0000-7000-8000-000000000000';
    assert.equal((await request('manager',`/api/reports/billing?branch_id=${missing}`)).status,403);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = oldQuery;
    pool.connect = oldConnect;
    await pool.end();
    if (oldSchema === undefined) delete process.env.PG_SCHEMA; else process.env.PG_SCHEMA = oldSchema;
    await fixture.close();
  }
});
