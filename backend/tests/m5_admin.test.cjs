const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

test('M5 Admin & Policy - Schema constraints, CRUD integrity, and audit queries', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must be defined');
  const client = new Client({ connectionString: process.env.PG_URL });
  await client.connect();

  try {

    // 1. Verify system_config default keys exist
    
    const configRes = await client.query('SELECT config_key, config_value FROM system_config');
    const configKeys = configRes.rows.map((r) => r.config_key);

    const requiredKeys = [
      'cancellation_fee_rate',
      'tax_rate',
      'service_charge_rate',
      'late_checkout_amount',
      'discount_rate',
    ];

    for (const key of requiredKeys) {
      assert.ok(
        configKeys.includes(key),
        `system_config must contain default key: ${key}`
      );
    }


    // 2. Test branch insertion and updates
    
    const branchName = `Test Branch ${Date.now()}`;
    const insertBranch = await client.query(
      `INSERT INTO branch (name, city, address, active)
       VALUES ($1, $2, $3, $4)
       RETURNING branch_id, name, city, active`,
      [branchName, 'Test City', '123 Test St', true]
    );

    assert.equal(insertBranch.rows.length, 1);
    const createdBranch = insertBranch.rows[0];
    assert.equal(createdBranch.name, branchName);
    assert.equal(createdBranch.active, true);

    // Update branch active flag
    const updateBranch = await client.query(
      `UPDATE branch SET active = false, updated_at = NOW()
       WHERE branch_id = $1
       RETURNING branch_id, active`,
      [createdBranch.branch_id]
    );
    assert.equal(updateBranch.rows[0].active, false);

    // Clean up test branch
    await client.query('DELETE FROM branch WHERE branch_id = $1', [createdBranch.branch_id]);


    // 3. Test user_account query does not leak password hashes

    const userRes = await client.query(
      'SELECT user_id, username, active, created_at, updated_at, last_login_at FROM user_account LIMIT 5'
    );
    assert.ok(Array.isArray(userRes.rows));
    for (const user of userRes.rows) {
      assert.ok(!('password_hash' in user), 'Safe user projection must not include password_hash');
      assert.ok('username' in user);
      assert.ok('active' in user);
    }

    // 4. Test audit_log query structure and joins
    
    const auditRes = await client.query(`
      SELECT 
        a.audit_id,
        a.user_id,
        u.username,
        a.entity_name,
        a.entity_id,
        a.action,
        a.changed_at
      FROM audit_log a
      LEFT JOIN user_account u ON a.user_id = u.user_id
      ORDER BY a.changed_at DESC
      LIMIT 5
    `);
    assert.ok(Array.isArray(auditRes.rows));


    // 5. Test system_config update and rollback
    const originalRateRow = await client.query(
      "SELECT config_value FROM system_config WHERE config_key = 'tax_rate'"
    );
    const originalRate = originalRateRow.rows[0]?.config_value;

    if (originalRate) {
      // Update tax rate
      await client.query(
        "UPDATE system_config SET config_value = '9.5', updated_at = NOW() WHERE config_key = 'tax_rate'"
      );
      const updatedRow = await client.query(
        "SELECT config_value FROM system_config WHERE config_key = 'tax_rate'"
      );
      assert.equal(updatedRow.rows[0].config_value, '9.5');

      // Revert back
      await client.query(
        "UPDATE system_config SET config_value = $1, updated_at = NOW() WHERE config_key = 'tax_rate'",
        [originalRate]
      );
    }
  } finally {
    await client.end();
  }
});