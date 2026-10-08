import assert from 'node:assert/strict';
import test from 'node:test';
import { canViewStaffPage } from '../src/lib/staffNavigation';
test('navigation separates staff operations, account administration, and chain finance', () => {
  assert.equal(canViewStaffPage(null, '/admin/operations'), false);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/admin/operations'), true);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/bookings/new'), false);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/admin/reports'), false);
  assert.equal(canViewStaffPage('FRONT_DESK', '/bookings/new'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/admin/operations'), false);
  assert.equal(canViewStaffPage('CHAIN_MANAGER', '/admin/reports'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/admin/audit'), true);
  assert.equal(canViewStaffPage('SERVICE_STAFF', '/admin/config'), false);
});
