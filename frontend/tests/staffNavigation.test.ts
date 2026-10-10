import assert from 'node:assert/strict';
import test from 'node:test';
import { canViewStaffPage } from '../src/lib/staffNavigation';
test('navigation separates staff operations, account administration, and chain finance', () => {
  assert.equal(canViewStaffPage(null, '/dashboard/admin/branches'), false);
  assert.equal(canViewStaffPage(null, '/dashboard/admin/users'), false);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/dashboard/admin/branches'), true);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/dashboard/admin/users'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/dashboard/admin/branches'), false);
  assert.equal(canViewStaffPage('AUDITOR', '/dashboard/admin/users'), true);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/dashboard/bookings/new'), false);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/dashboard/admin/reports'), false);
  assert.equal(canViewStaffPage('FRONT_DESK', '/dashboard/bookings/new'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/dashboard/admin/branches'), false);
  assert.equal(canViewStaffPage('FRONT_DESK', '/dashboard/admin/users'), false);
  assert.equal(canViewStaffPage('CHAIN_MANAGER', '/dashboard/admin/reports'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/dashboard/admin/audit'), true);
  assert.equal(canViewStaffPage('SERVICE_STAFF', '/dashboard/admin/config'), false);
  // Room administration is opened by branch roles (room.read) and the chain
  // manager who maintains the shared room-type/amenity catalogue.
  assert.equal(canViewStaffPage('CHAIN_MANAGER', '/dashboard/admin/rooms'), true);
  assert.equal(canViewStaffPage('BRANCH_MANAGER', '/dashboard/admin/rooms'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/dashboard/admin/rooms'), false);
  // Billing operation pages are exposed to the roles the backend authorizes.
  assert.equal(canViewStaffPage('FRONT_DESK', '/dashboard/checkout'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/dashboard/cancellation'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/dashboard/no-show'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/dashboard/billing/invoice'), true);
  assert.equal(canViewStaffPage('FRONT_DESK', '/dashboard/billing/payments'), true);
  assert.equal(canViewStaffPage('AUDITOR', '/dashboard/checkout'), false);
  assert.equal(canViewStaffPage('AUDITOR', '/dashboard/billing/invoice'), true);
  assert.equal(canViewStaffPage('CHAIN_MANAGER', '/dashboard/billing/payments'), false);
  // Invoice detail is readable across branch and chain finance roles (dev #42),
  // exposed to every role the backend authorizes for invoice.read.*.
  assert.equal(canViewStaffPage(null, '/dashboard/billing/invoice'), false);
  assert.equal(canViewStaffPage('SERVICE_STAFF', '/dashboard/billing/invoice'), true);
  assert.equal(canViewStaffPage('BRANCH_MANAGER', '/dashboard/billing/invoice'), true);
  assert.equal(canViewStaffPage('CHAIN_MANAGER', '/dashboard/billing/invoice'), true);
  assert.equal(canViewStaffPage('SYSTEM_ADMINISTRATOR', '/dashboard/billing/invoice'), false);
});
