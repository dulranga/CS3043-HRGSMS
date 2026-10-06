import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ServiceUsagePanel } from '../src/components/usage/ServiceUsagePanel.tsx';
import { UsageVoidWiring } from '../src/components/usage/ServiceUsageVoidPanel.tsx';
import {
  emptyUsageDraft,
  emptyVoidDraft,
  parseUsageList,
  resolveUsageCapabilities,
  resolveVoidCapabilities,
} from '../src/lib/serviceUsageViewModel.ts';

const LINES = [{ lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01', roomNumber: '101' }];
const USAGE_ID = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e01';
const VOIDED_USAGE_ID = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e02';
const MANAGER_ID = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a09';

function usageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    usage_id: USAGE_ID,
    service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    service_name: 'Room Service',
    category: 'DINING',
    booking_room_line_id: LINES[0].lineId,
    used_at: '2026-10-05T04:15:00.000Z',
    quantity: '2.00',
    unit_price_snapshot: '1250.50',
    amount: '2501.00',
    voided: false,
    voided_at: null,
    voided_by: null,
    ...overrides,
  };
}

function wiring(overrides: Partial<UsageVoidWiring> = {}): UsageVoidWiring {
  return {
    capabilities: resolveVoidCapabilities('BRANCH_MANAGER'),
    draft: emptyVoidDraft(),
    errors: {},
    isVoiding: false,
    failure: null,
    result: null,
    onSelect: () => {},
    onReasonChange: () => {},
    onCancel: () => {},
    onConfirm: () => {},
    ...overrides,
  };
}

function render(
  role: Parameters<typeof resolveVoidCapabilities>[0],
  voidOverrides: Partial<UsageVoidWiring> = {},
  rows: Array<Record<string, unknown>> = [usageRow()],
): string {
  return renderToStaticMarkup(
    <ServiceUsagePanel
      records={parseUsageList({ usage: rows })}
      lines={LINES}
      capabilities={resolveUsageCapabilities('FRONT_DESK')}
      services={[]}
      draft={emptyUsageDraft()}
      errors={{}}
      isSaving={false}
      writeFailure={null}
      voidWiring={wiring({ capabilities: resolveVoidCapabilities(role), ...voidOverrides })}
      onDraftChange={() => {}}
      onSubmit={() => {}}
    />,
  );
}

test('a void authority gets the void column and the retained-row warning', () => {
  const markup = render('BRANCH_MANAGER');

  assert.match(markup, /Void authority active/);
  assert.match(markup, /auditable reversal/);
  assert.match(markup, />Void</);
  assert.doesNotMatch(markup, /disabled=""[^>]*>Void</);
  assert.match(markup, /<th class="py-2 px-3 font-semibold tracking-tight">Void<\/th>/);
});

test('FR-048 the selected charge must be confirmed before anything is voided', () => {
  const idle = render('BRANCH_MANAGER');
  assert.doesNotMatch(idle, /Confirm void of this charge/);

  const confirming = render('BRANCH_MANAGER', { draft: { usageId: USAGE_ID, reason: '' } });
  assert.match(confirming, /Confirm void of this charge/);
  assert.match(confirming, /Room Service/);
  assert.match(confirming, /Room 101/);
  assert.match(confirming, /LKR 1,250\.50/);
  assert.match(confirming, /LKR 2,501\.00/);
  assert.match(confirming, /original row, its price snapshot, quantity and recording actor are retained, not deleted/);
  assert.match(confirming, /marked VOIDED, leaves the billable subtotal/);
  assert.match(confirming, /An audit record stores your name, the server time and the reason/);
  assert.match(confirming, /A FINAL invoice cannot be voided here/);
  assert.match(confirming, /A charge can only be voided once/);
  assert.match(confirming, /Confirm void/);
  assert.match(confirming, /Keep the charge/);
  assert.match(confirming, /id="usage-void-reason"/);
});

test('the optional reason is echoed with its audit-column limit and error', () => {
  const typed = render('BRANCH_MANAGER', { draft: { usageId: USAGE_ID, reason: 'Wrong room charged' } });
  assert.match(typed, /value="Wrong room charged"/);
  assert.match(typed, /Stored on the audit row for up to 255 characters\./);

  const invalid = render('BRANCH_MANAGER', {
    draft: { usageId: USAGE_ID, reason: '' },
    errors: { reason: 'Keep the reason under 255 characters.' },
  });
  assert.match(invalid, /Keep the reason under 255 characters\./);
  assert.match(invalid, /aria-invalid="true"/);
});

test('a forbidden role sees disabled void controls with the reason, not a silent no-op', () => {
  for (const role of ['FRONT_DESK', 'SERVICE_STAFF', 'AUDITOR', null] as const) {
    const markup = render(role);

    assert.doesNotMatch(markup, /Void authority active/);
    assert.match(markup, /disabled=""[^>]*>Void</);
    assert.match(markup, /may void service usage/);
  }

  assert.match(render('FRONT_DESK'), /Signed in as FRONT_DESK\./);
  assert.match(render(null), /not a service-usage void authority/);
});

test('a repeat void is impossible: an already voided row is shown as history', () => {
  const markup = render(
    'BRANCH_MANAGER',
    {},
    [
      usageRow(),
      usageRow({
        usage_id: VOIDED_USAGE_ID,
        service_name: 'Laundry Pressing',
        amount: '700.00',
        voided: true,
        voided_at: '2026-10-05T07:00:00.000Z',
        voided_by: MANAGER_ID,
      }),
    ],
  );

  assert.match(markup, /VOIDED/);
  assert.match(markup, /REVERSED/);
  assert.match(markup, /Reversed 2026-10-05T07:00:00\.000Z by 0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a09/);
  assert.match(markup, /LKR 700\.00/, 'the reversed amount stays visible');
  assert.match(markup, /2 recorded · 1 voided and excluded/);
  assert.equal((markup.match(/>Void<\/button>/g) ?? []).length, 1, 'only the billable row offers a void');
  assert.equal((markup.match(/disabled=""[^>]*>Void</g) ?? []).length, 0, 'a manager still gets no control on a voided row');
});

test('a refused void explains the refusal as an alert', () => {
  const denied = render('BRANCH_MANAGER', {
    failure: { status: 403, code: 'VOID_ACCESS_DENIED', message: '' },
  });
  assert.match(denied, /role="alert"/);
  assert.match(denied, /Branch Manager of this branch, Chain Manager or System Administrator/);

  const repeat = render('BRANCH_MANAGER', {
    failure: { status: 409, code: 'USAGE_ALREADY_VOIDED', message: 'Service usage is already voided.' },
  });
  assert.match(repeat, /cannot be voided again/);
  assert.match(repeat, /Service usage is already voided\./);

  const finalInvoice = render('BRANCH_MANAGER', {
    failure: { status: 409, code: 'INVOICE_FINAL', message: 'Invoice is FINAL. Service usage cannot be voided.' },
  });
  assert.match(finalInvoice, /invoice is FINAL, so the charge cannot be voided here/);
});

test('a completed void reports the reversal and any resulting credit', () => {
  const markup = render('BRANCH_MANAGER', {
    result: {
      usageId: USAGE_ID,
      voidedAmount: '2501.00',
      voidedAt: '2026-10-05T07:00:00.000Z',
      voidedBy: MANAGER_ID,
      invoiceId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5f01',
      billing: { totalAmount: '0', netPaid: '1000', balance: '-1000', isCredit: true, creditAmount: '1000' },
    },
  });

  assert.match(markup, /Void recorded\./);
  assert.match(markup, /LKR 2,501\.00 was reversed/);
  assert.match(markup, /Booking total LKR 0\.00 · outstanding balance LKR -1,000\.00 · LKR 1,000\.00 credit to settle by refund/);

  const noCredit = render('BRANCH_MANAGER', {
    result: {
      usageId: USAGE_ID,
      voidedAmount: '350.00',
      voidedAt: '2026-10-05T07:00:00.000Z',
      voidedBy: MANAGER_ID,
      invoiceId: null,
      billing: { totalAmount: '100', netPaid: '0', balance: '100', isCredit: false, creditAmount: '0' },
    },
  });
  assert.doesNotMatch(noCredit, /credit to settle/);
});

test('an in-flight void blocks a second confirmation', () => {
  const markup = render('BRANCH_MANAGER', { draft: { usageId: USAGE_ID, reason: '' }, isVoiding: true });

  assert.match(markup, /disabled=""[^>]*>Voiding…/);
  assert.match(markup, /disabled=""[^>]*>Keep the charge/);
  assert.match(markup, /id="usage-void-reason"[^>]*disabled=""/);
});

test('without void wiring the table keeps its original six columns', () => {
  const markup = renderToStaticMarkup(
    <ServiceUsagePanel
      records={parseUsageList({ usage: [usageRow()] })}
      lines={LINES}
      capabilities={resolveUsageCapabilities('FRONT_DESK')}
      services={[]}
      draft={emptyUsageDraft()}
      errors={{}}
      isSaving={false}
      writeFailure={null}
      onDraftChange={() => {}}
      onSubmit={() => {}}
    />,
  );

  assert.doesNotMatch(markup, /Void authority active/);
  assert.doesNotMatch(markup, />Void</);
  assert.doesNotMatch(markup, /Confirm void of this charge/);
});

test('an empty usage list still renders a confirmation-free void column', () => {
  const markup = render('BRANCH_MANAGER', {}, []);

  assert.match(markup, /No service usage has been recorded for this booking\./);
  assert.match(markup, /colSpan="7"/);
  assert.doesNotMatch(markup, /Confirm void of this charge/);
});