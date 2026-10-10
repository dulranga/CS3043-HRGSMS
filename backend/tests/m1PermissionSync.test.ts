import assert from 'node:assert/strict';
import test from 'node:test';
import { OPERATIONS, ROLE_GRANTS, STAFF_ROLES } from '../src/authorization';
import {
  OPERATIONS as FRONTEND_OPERATIONS,
  ROLE_GRANTS as FRONTEND_GRANTS,
} from '../../frontend/src/lib/rolePermissions.generated';

// M1-S09: the frontend navigation must never carry its own role logic. This
// asserts the checked-in generated copy is byte-for-byte derived from the
// backend matrix; if it fails, run `npm run gen:permissions`.
test('M1-S09 frontend role-grant map is generated from the backend matrix', () => {
  assert.deepEqual(
    [...FRONTEND_OPERATIONS].sort(),
    Object.keys(OPERATIONS).sort(),
    'operation registry drifted; run npm run gen:permissions',
  );
  assert.deepEqual(
    Object.keys(FRONTEND_GRANTS).sort(),
    [...STAFF_ROLES].sort(),
    'role set drifted; run npm run gen:permissions',
  );
  for (const role of STAFF_ROLES) {
    assert.deepEqual(FRONTEND_GRANTS[role], ROLE_GRANTS[role], `${role} grants drifted; run npm run gen:permissions`);
  }
});
