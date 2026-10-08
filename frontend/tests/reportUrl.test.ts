import assert from 'node:assert/strict';
import test from 'node:test';
import { reportUrl, hasReportAccess, type ReportType } from '../src/lib/reportUrl';
test('all report exports retain the exact screen filters on the current origin', () => {
  const filters = { branch_id: 'branch', booking_ref: 'BK-123', invoice_status: 'FINAL', year: '2026', search: 'Tea', min_stays: '2', category: 'Food', by: 'quantity', limit: '10', offset: '0', entity_name: 'booking', action: 'CREATE', staff_id: 'staff', page: '3' };
  const reports: ReportType[] = ['occupancy', 'billing', 'revenue', 'guest-history', 'service-usage', 'preference-trends', 'audit-logs'];
  for (const report of reports) {
    const screen = reportUrl('http://127.0.0.1:5173', report, filters);
    const csv = reportUrl('http://127.0.0.1:5173', report, filters, true);
    assert.equal(csv.search, screen.search, report);
    assert.equal(csv.origin, screen.origin);
    assert.ok(csv.pathname.endsWith('/export'));
  }
});
test('report discovery follows branch, chain, and audit permissions', () => {
  assert.equal(hasReportAccess('BRANCH_MANAGER', 'billing'), true);
  assert.equal(hasReportAccess('BRANCH_MANAGER', 'service-usage'), false);
  assert.equal(hasReportAccess('CHAIN_MANAGER', 'audit-logs'), false);
  assert.equal(hasReportAccess('SYSTEM_ADMINISTRATOR', 'audit-logs'), true);
  assert.equal(hasReportAccess('SYSTEM_ADMINISTRATOR', 'revenue'), false);
  assert.equal(hasReportAccess('AUDITOR', 'revenue'), true);
  assert.equal(hasReportAccess(null, 'occupancy'), false);
});
