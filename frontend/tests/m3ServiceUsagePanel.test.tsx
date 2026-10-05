import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ServiceUsagePanel } from '../src/components/usage/ServiceUsagePanel.tsx';
import { emptyUsageDraft, parseUsageList, resolveUsageCapabilities } from '../src/lib/serviceUsageViewModel.ts';

const LINES = [
  { lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01', roomNumber: '101' },
  { lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02', roomNumber: '102' },
];

const SERVICES = [
  {
    serviceId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    name: 'Room Service',
    category: 'DINING',
    currentPrice: '1250.50',
  },
  {
    serviceId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d02',
    name: 'Laundry Pressing',
    category: 'LAUNDRY',
    currentPrice: '350.00',
  },
];

function records(overrides: Array<Record<string, unknown>> = []): ReturnType<typeof parseUsageList> {
  return parseUsageList({
    usage: [
      {
        usage_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e01',
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
        recorded_by: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a01',
      },
      ...overrides,
    ],
  });
}

function render(
  role: Parameters<typeof resolveUsageCapabilities>[0],
  overrides: Partial<React.ComponentProps<typeof ServiceUsagePanel>> = {},
): string {
  return renderToStaticMarkup(
    <ServiceUsagePanel
      records={records()}
      lines={LINES}
      capabilities={resolveUsageCapabilities(role)}
      services={SERVICES}
      draft={emptyUsageDraft()}
      errors={{}}
      isSaving={false}
      writeFailure={null}
      onDraftChange={() => {}}
      onSubmit={() => {}}
      {...overrides}
    />,
  );
}

test('FRONT_DESK and SERVICE_STAFF get an enabled recording form', () => {
  for (const role of ['FRONT_DESK', 'SERVICE_STAFF'] as const) {
    const markup = render(role);

    assert.match(markup, /Recording access: 2 checked-in rooms available for attribution/);
    assert.match(markup, /Room 101/);
    assert.match(markup, /Room 102/);
    assert.match(markup, /Unallocated \(booking-wide\)/);
    assert.match(markup, /Room Service · LKR 1,250\.50/);
    assert.doesNotMatch(markup, /only be recorded while at least one room line/);
    assert.doesNotMatch(markup, /disabled=""[^>]*>Record usage</);
  }
});

test('a non-recording role sees a disabled form and the read-only denial', () => {
  for (const role of ['BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR', null] as const) {
    const markup = render(role);

    assert.match(markup, /role="status"/);
    assert.match(markup, /disabled=""[^>]*>Record usage</);
    assert.doesNotMatch(markup, /Recording access/);
    assert.doesNotMatch(markup, /checked-in room line is checked in/);
  }

  assert.match(render('AUDITOR'), /Only active Front Desk or Service Staff of this branch may record service usage\./);
  assert.match(render('AUDITOR'), /Signed in as AUDITOR/);
  assert.match(render(null), /not a service-usage recording role/);
});

test('a booking with no checked-in line blocks recording with the FR-044 reason', () => {
  const markup = render('FRONT_DESK', { lines: [] });

  assert.match(markup, /Service usage can only be recorded while at least one room line is checked in\./);
  assert.match(markup, /disabled=""[^>]*>Record usage</);
  assert.doesNotMatch(markup, /Recording access/);
});

test('the list shows the stored unit-price snapshot and the resulting amount', () => {
  const markup = render('FRONT_DESK');

  assert.match(markup, /Unit price snapshot/);
  assert.match(markup, /LKR 1,250\.50/);
  assert.match(markup, /LKR 2,501\.00/);
  assert.match(markup, /A later catalogue price change never alters a charge that already exists\./);
  assert.match(markup, /taken from the catalogue by the server, so it cannot be overridden/);
  assert.match(markup, /overflow-x-auto/);
  assert.match(markup, /md:grid-cols-2/);
});

test('FR-044 booking-wide rows are labelled unallocated and room rows name the room', () => {
  const markup = render('FRONT_DESK', {
    records: records([
      {
        usage_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e02',
        service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d02',
        service_name: 'Laundry Pressing',
        category: 'LAUNDRY',
        booking_room_line_id: null,
        used_at: '2026-10-05T05:00:00.000Z',
        quantity: '2.00',
        unit_price_snapshot: '350.00',
        amount: '700.00',
        voided: false,
      },
    ]),
  });

  assert.match(markup, /Laundry Pressing/);
  assert.match(markup, /Unallocated \(booking-wide\)/);
  assert.match(markup, />Room 101</);
  assert.match(markup, /LKR 700\.00/);
});

test('a row whose line is unknown falls back to the line id rather than a blank room', () => {
  const markup = render('FRONT_DESK', { lines: [] });

  assert.match(markup, /Room line 0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01/);
});

test('FR-050 the subtotal excludes voided rows and counts unallocated ones', () => {
  const markup = render('FRONT_DESK', {
    records: records([
      {
        usage_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e03',
        service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d02',
        service_name: 'Laundry Pressing',
        booking_room_line_id: null,
        used_at: '2026-10-05T06:00:00.000Z',
        quantity: '1.00',
        unit_price_snapshot: '350.00',
        amount: '350.00',
        voided: true,
        voided_at: '2026-10-05T07:00:00.000Z',
      },
    ]),
  });

  assert.match(markup, /Billable subtotal/);
  assert.match(markup, /LKR 2,501\.00/);
  assert.match(markup, /2 recorded · 1 voided and excluded · 0 unallocated/);
  assert.match(markup, /VOIDED/);
  assert.doesNotMatch(markup, /LKR 2,851\.00/);
});

test('a failed write renders the mapped server message as an alert', () => {
  const markup = render('FRONT_DESK', {
    writeFailure: { status: 409, code: 'USAGE_CONFLICT', message: 'Booking has no CHECKED_IN line.' },
  });

  assert.match(markup, /role="alert"/);
  assert.match(markup, /no checked-in room line/);
  assert.match(markup, /Booking has no CHECKED_IN line\./);
});

test('a FINAL invoice rejection and a cross-branch denial read differently', () => {
  const finalInvoice = render('FRONT_DESK', {
    writeFailure: { status: 409, code: 'INVOICE_FINAL', message: 'Invoice is FINAL. Service usage cannot be void.' },
  });
  assert.match(finalInvoice, /invoice is FINAL, so service usage can no longer be recorded/);

  const denied = render('FRONT_DESK', {
    writeFailure: { status: 403, code: 'USAGE_ACCESS_DENIED', message: '' },
  });
  assert.match(denied, /limited to active Front Desk or Service Staff of this booking/);
});

test('draft errors surface under the quantity, service and attribution fields', () => {
  const markup = render('FRONT_DESK', {
    errors: {
      serviceId: 'Choose a service from the catalogue.',
      quantity: 'Enter a positive quantity with at most two decimal places.',
      lineId: 'Service usage can only be attributed to a checked-in room line.',
    },
  });

  assert.match(markup, /Choose a service from the catalogue\./);
  assert.match(markup, /at most two decimal places/);
  assert.match(markup, /only be attributed to a checked-in room line/);
  assert.match(markup, /aria-invalid="true"/);
});

test('an empty catalogue or an empty usage list renders explicit states', () => {
  assert.match(render('FRONT_DESK', { services: [] }), /No active services are available in the catalogue\./);
  assert.match(render('FRONT_DESK', { records: [] }), /No service usage has been recorded for this booking\./);
});

test('the form explains that booking-wide usage is never spread across rooms', () => {
  const markup = render('FRONT_DESK');

  assert.match(markup, /carries no room line and is always reported as unallocated/);
  assert.match(markup, /never spread across the rooms of a multi-room booking/);
  assert.match(markup, /Leave blank to record the moment of entry/);
});