import assert from 'node:assert/strict';
import test from 'node:test';
import { guestFeatureSession, roomFeatureSession, staffFeatureSession } from '../src/lib/featureSessions';
import type { SessionUser } from '../src/lib/auth';

test('verified guest session cannot acquire staff authority from role/branch fields', () => {
  const guest: SessionUser = { userId: 'guest-user', username: 'guest', kind: 'GUEST', guestId: 'guest-id', role: 'SYSTEM_ADMINISTRATOR', branchId: 'branch-id' };
  assert.equal(staffFeatureSession(guest), null);
  assert.equal(roomFeatureSession(guest), null);
  assert.equal(guestFeatureSession(guest)?.accountKind, 'guest');
});
test('verified staff keeps its role and branch without guest authority or actor headers', async () => {
  const staff: SessionUser = { userId: 'staff-user', username: 'staff', kind: 'STAFF', role: 'CHAIN_MANAGER', branchId: 'branch-id' };
  assert.equal(guestFeatureSession(staff), null);
  assert.deepEqual(roomFeatureSession(staff), { role: 'CHAIN_MANAGER', branchId: 'branch-id' });
  assert.deepEqual(await staffFeatureSession(staff)!.mutationHeaders(), {});
  assert.equal(staffFeatureSession({ ...staff, role: 'UNKNOWN' }), null);
  assert.equal(staffFeatureSession({ ...staff, branchId: undefined }), null);
  assert.equal(staffFeatureSession(null), null);
  assert.equal(guestFeatureSession({ ...staff, kind: 'GUEST' }), null);
});
