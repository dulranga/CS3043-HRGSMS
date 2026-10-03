const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

test('M5 Reports - Views load, match schema contracts, and calculate metrics safely', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must be defined');
  const client = new Client({ connectionString: process.env.PG_URL });
  await client.connect();

  try {
    // 1. Verify all 5 views exist and can be queried without SQL errors
    const views = [
      'view_current_occupancy',
      'view_monthly_branch_revenue',
      'view_guest_history',
      'view_staff_activity_audit',
      'view_service_usage',
    ];

    for (const viewName of views) {
      const res = await client.query(`SELECT * FROM ${viewName} LIMIT 5`);
      assert.ok(Array.isArray(res.rows), `${viewName} must return an array of rows`);
    }

    // 2. Test view_current_occupancy structure and occupancy rate constraints
    const occupancyRes = await client.query(`SELECT * FROM view_current_occupancy`);
    for (const row of occupancyRes.rows) {
      assert.ok('branch_id' in row, 'Occupancy row must contain branch_id');
      assert.ok('branch_name' in row, 'Occupancy row must contain branch_name');
      assert.ok('total_rooms' in row, 'Occupancy row must contain total_rooms');
      assert.ok('occupied_rooms' in row, 'Occupancy row must contain occupied_rooms');
      assert.ok('occupancy_rate_percentage' in row, 'Occupancy row must contain occupancy_rate_percentage');

      const total = Number(row.total_rooms);
      const occupied = Number(row.occupied_rooms);
      assert.ok(occupied <= total, 'Occupied rooms cannot exceed total rooms');

      if (row.occupancy_rate_percentage !== null) {
        const rate = Number(row.occupancy_rate_percentage);
        assert.ok(!isNaN(rate), 'Occupancy rate must be a valid number when present');
        assert.ok(rate >= 0 && rate <= 100, 'Occupancy rate percentage must be between 0 and 100');
      }
    }

    // 3. Test view_monthly_branch_revenue structure and calculations
    const revenueRes = await client.query(`SELECT * FROM view_monthly_branch_revenue`);
    for (const row of revenueRes.rows) {
      assert.ok('branch_id' in row, 'Revenue row must contain branch_id');
      assert.ok('branch_name' in row, 'Revenue row must contain branch_name');
      assert.ok('revenue_month' in row, 'Revenue row must contain revenue_month');
      assert.ok('total_revenue_lkr' in row, 'Revenue row must contain total_revenue_lkr');
      assert.ok(!isNaN(Number(row.total_revenue_lkr)), 'Revenue must be a valid numeric value');
    }

    // 4. Test view_service_usage columns against updated schema
    const serviceRes = await client.query(`SELECT * FROM view_service_usage`);
    for (const row of serviceRes.rows) {
      assert.ok('service_id' in row, 'Service row must contain service_id');
      assert.ok('service_name' in row, 'Service row must contain service_name');
      assert.ok('category' in row, 'Service row must contain category');
      assert.ok('total_orders' in row, 'Service row must contain total_orders');
      assert.ok('total_quantity_consumed' in row, 'Service row must contain total_quantity_consumed');
      assert.ok('total_revenue_generated' in row, 'Service row must contain total_revenue_generated');

      assert.ok(!isNaN(Number(row.total_orders)), 'total_orders must be numeric');
      assert.ok(!isNaN(Number(row.total_quantity_consumed)), 'total_quantity_consumed must be numeric');
      assert.ok(!isNaN(Number(row.total_revenue_generated)), 'total_revenue_generated must be numeric');
    }

    // 5. Test view_guest_history structure
    const guestRes = await client.query(`SELECT * FROM view_guest_history LIMIT 10`);
    for (const row of guestRes.rows) {
      assert.ok('guest_id' in row, 'Guest row must contain guest_id');
      assert.ok('full_name' in row, 'Guest row must contain full_name');
      assert.ok('total_stays' in row, 'Guest row must contain total_stays');
      assert.ok('lifetime_expenditure' in row, 'Guest row must contain lifetime_expenditure');
      assert.ok(!isNaN(Number(row.lifetime_expenditure)), 'lifetime_expenditure must be numeric');
    }

    // 6. Test view_staff_activity_audit structure
    const auditRes = await client.query(`SELECT * FROM view_staff_activity_audit LIMIT 10`);
    for (const row of auditRes.rows) {
      assert.ok('audit_id' in row, 'Audit row must contain audit_id');
      assert.ok('changed_at' in row, 'Audit row must contain changed_at');
      assert.ok('action' in row, 'Audit row must contain action');
      assert.ok('entity_name' in row, 'Audit row must contain entity_name');
      assert.ok('entity_id' in row, 'Audit row must contain entity_id');
    }
  } finally {
    await client.end();
  }
});