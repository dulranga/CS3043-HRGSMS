import assert from 'node:assert/strict';
import test from 'node:test';
import { canViewStaffPage } from '../src/lib/staffNavigation';
test('navigation separates staff operations, account administration, and chain finance', () => {
  assert.equal(canViewStaffPage(null, '/admin/branches'), false);
  assert.equal(canViewStaffPage(null, '/admin/users'), false);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/admin/branches'), true);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/admin/users'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/admin/branches'), false);
  assert.equal(canViewStaffPage('AUDITOR', '/admin/users'), true);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/bookings/new'), false);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/admin/reports'), false);
  assert.equal(canViewStaffPage('FRONT_DESK', '/bookings/new'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/admin/branches'), false);
  assert.equal(canViewStaffPage('FRONT_DESK', '/admin/users'), false);
  assert.equal(canViewStaffPage('CHAIN_MANAGER', '/admin/reports'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/admin/audit'), true);
  assert.equal(canViewStaffPage('SERVICE_STAFF', '/admin/config'), false);
  // Room administration is opened by branch roles (room.read) and the chain
  // manager who maintains the shared room-type/amenity catalogue.
  assert.equal(canViewStaffPage('CHAIN_MANAGER', '/admin/rooms'), true);
  assert.equal(canViewStaffPage('BRANCH_MANAGER', '/admin/rooms'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/admin/rooms'), false);
  // Billing operation pages are exposed to the roles the backend authorizes.
  assert.equal(canViewStaffPage('FRONT_DESK', '/checkout'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/cancellation'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/no-show'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/billing/invoice'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/billing/payments'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/checkout'), false);
  assert.equal(canViewStaffPage('AUDITOR', '/billing/invoice'), true);
  assert.equal(canViewStaffPage('CHAIN_MANAGER', '/billing/payments'), false);
});
