
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

test('M5 Reports - Reconciliation checks (optional evidence)', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must be defined');
  const client = new Client({ connectionString: process.env.PG_URL });
  await client.connect();
  try {
    // 1. view_current_occupancy
    const occ = await client.query('SELECT * FROM view_current_occupancy');
    for (const r of occ.rows) {
      const total = Number(r.total_rooms);
      const occupied = Number(r.occupied_rooms);
      assert.ok(occupied <= total, 'occupied <= total_rooms');
      if (r.occupancy_rate_percentage !== null) {
        const rate = Number(r.occupancy_rate_percentage);
        assert.ok(rate >= 0 && rate <= 100, 'occupancy_rate 0-100');
      }
    }

    // 2. view_monthly_branch_revenue
    const rev = await client.query('SELECT * FROM view_monthly_branch_revenue LIMIT 20');
    for (const r of rev.rows) {
      assert.ok('branch_id' in r);
      assert.ok('branch_name' in r);
      assert.ok('revenue_month' in r);
      assert.ok('total_revenue_lkr' in r);
      assert.ok(!isNaN(Number(r.total_revenue_lkr)), 'total_revenue_lkr numeric');
    }

    // 3. view_service_usage
    const su = await client.query('SELECT * FROM view_service_usage LIMIT 20');
    for (const r of su.rows) {
      assert.ok('service_id' in r);
      assert.ok('service_name' in r);
      assert.ok('category' in r);
      assert.ok(!isNaN(Number(r.total_orders)));
      assert.ok(!isNaN(Number(r.total_quantity_consumed)));
      assert.ok(!isNaN(Number(r.total_revenue_generated)));
    }

    // 4. view_guest_history
    const gh = await client.query('SELECT * FROM view_guest_history LIMIT 20');
    for (const r of gh.rows) {
      assert.ok('guest_id' in r);
      assert.ok('full_name' in r);
      assert.ok('total_stays' in r);
      assert.ok('lifetime_expenditure' in r);
      assert.ok(!isNaN(Number(r.total_stays)));
      assert.ok(!isNaN(Number(r.lifetime_expenditure)));
    }

    // 5. view_staff_activity_audit
    const av = await client.query('SELECT * FROM view_staff_activity_audit LIMIT 20');
    for (const r of av.rows) {
      assert.ok('audit_id' in r);
      assert.ok('changed_at' in r);
      assert.ok('action' in r);
      assert.ok('entity_name' in r);
      assert.ok('entity_id' in r);
    }
  } finally {
    await client.end();
  }
});