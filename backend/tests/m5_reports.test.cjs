const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

test('M5 Reports - Views load and calculate metrics without row inflation', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must be defined');
  const client = new Client({ connectionString: process.env.PG_URL });
  await client.connect();

  try {
    // 1. Verify all 5 views exist and can be queried without SQL syntax/column errors
    const views = [
      'view_current_occupancy',
      'view_monthly_branch_revenue',
      'view_guest_history',
      'view_staff_activity_audit',
     'view_service_usage'
    ];

    for (const viewName of views) {
      const res = await client.query(`SELECT * FROM ${viewName} LIMIT 5`);
      assert.ok(Array.isArray(res.rows), `${viewName} should return an array of rows`);
    }

    // 2. Test occupancy rate calculation logic
    const occupancyRes = await client.query(`SELECT * FROM view_current_occupancy`);
    for (const row of occupancyRes.rows) {
      assert.ok('branch_id' in row, 'Occupancy row must contain branch_id');
      assert.ok('branch_name' in row, 'Occupancy row must contain branch_name');
      assert.ok('total_rooms' in row, 'Occupancy row must contain total_rooms');
      assert.ok('occupied_rooms' in row, 'Occupancy row must contain occupied_rooms');

      const total = Number(row.total_rooms);
      const occupied = Number(row.occupied_rooms);
      assert.ok(occupied <= total, 'Occupied rooms cannot exceed total rooms');
    }

    // 3. Test revenue calculations are numeric
    const revenueRes = await client.query(`SELECT * FROM view_monthly_branch_revenue`);
    for (const row of revenueRes.rows) {
      assert.ok('branch_name' in row);
      assert.ok('revenue_month' in row);
      assert.ok('total_revenue_lkr' in row);
      assert.ok(!isNaN(Number(row.total_revenue_lkr)), 'Revenue must be a valid numeric value');
    }
  } finally {
    await client.end();
  }
});