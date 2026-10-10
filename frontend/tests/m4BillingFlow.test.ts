import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BILLING_FLOW_STEPS,
  billingFlowSearch,
  validateBillingFlowSearch,
  visibleBillingSteps,
} from '../src/lib/billingFlow.ts';

test('validateBillingFlowSearch trims and drops empty values', () => {
  assert.deepEqual(validateBillingFlowSearch({ booking: '  b-1 ', label: ' Alice ' }), {
    booking: 'b-1',
    label: 'Alice',
  });
  assert.deepEqual(validateBillingFlowSearch({ booking: '', label: '   ' }), {
    booking: undefined,
    label: undefined,
  });
  assert.deepEqual(validateBillingFlowSearch({ booking: 42, label: null }), {
    booking: undefined,
    label: undefined,
  });
  assert.deepEqual(validateBillingFlowSearch({}), { booking: undefined, label: undefined });
});

test('billingFlowSearch omits empty fields so URLs stay clean', () => {
  assert.deepEqual(billingFlowSearch('b-1', 'Alice'), { booking: 'b-1', label: 'Alice' });
  assert.deepEqual(billingFlowSearch(null, null), {});
  assert.deepEqual(billingFlowSearch('b-1', ''), { booking: 'b-1' });
  assert.deepEqual(billingFlowSearch(undefined, 'Alice'), { label: 'Alice' });
});

test('flow steps are unique and cover the billing journey', () => {
  const paths = BILLING_FLOW_STEPS.map((step) => step.path);
  assert.equal(new Set(paths).size, paths.length);
  for (const required of [
    '/dashboard/check-in',
    '/dashboard/billing/invoice',
    '/dashboard/billing/payments',
    '/dashboard/billing/checkout',
    '/dashboard/billing/cancellation',
    '/dashboard/billing/no-show',
  ]) {
    assert.ok(paths.includes(required as (typeof paths)[number]), `missing ${required}`);
  }
});

test('visibleBillingSteps follows each role permission set', () => {
  assert.deepEqual(
    visibleBillingSteps('FRONT_DESK').map((step) => step.path),
    [
      '/dashboard/check-in',
      '/dashboard/billing/invoice',
      '/dashboard/billing/payments',
      '/dashboard/billing/checkout',
      '/dashboard/billing/cancellation',
      '/dashboard/billing/no-show',
    ],
  );

  const branchManager = visibleBillingSteps('BRANCH_MANAGER').map((step) => step.path);
  assert.ok(branchManager.includes('/dashboard/billing/checkout'));
  assert.ok(branchManager.includes('/dashboard/billing/cancellation'));
  assert.ok(!branchManager.includes('/dashboard/billing/payments'));

  // Auditors can only read invoices, so the guided bar collapses to one step
  // and BillingFlowNav hides itself.
  assert.deepEqual(
    visibleBillingSteps('AUDITOR').map((step) => step.path),
    ['/dashboard/billing/invoice'],
  );
  assert.deepEqual(visibleBillingSteps(null), []);
  assert.deepEqual(visibleBillingSteps(undefined), []);
});
