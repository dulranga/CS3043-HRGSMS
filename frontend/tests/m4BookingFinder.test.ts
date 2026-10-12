import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bookingOptionLabel,
  canSearchBookings,
  fetchBookingOptions,
  filterBookingOptions,
  parseBookingOptions,
} from '../src/lib/bookingLookup.ts';

const BOOKING_UUID = '01930000-0000-7000-8000-000000000010';

function listPayload(): unknown {
  return {
    data: {
      items: [
        {
          bookingId: BOOKING_UUID,
          bookingRef: 'BK-2026-0001',
          bookingChannel: 'FRONT_DESK',
          createdAt: '2026-10-01T08:00:00.000Z',
          updatedAt: '2026-10-01T08:00:00.000Z',
          createdBy: '01930000-0000-7000-8000-000000000050',
          guest: { guestId: '01930000-0000-7000-8000-000000000020', fullName: 'Alice Perera' },
          lineSummary: {
            total: 2,
            booked: 1,
            checkedIn: 1,
            checkedOut: 0,
            cancelled: 0,
            noShow: 0,
            firstStayDate: '2026-10-05',
            lastStayDate: '2026-10-08',
          },
        },
        {
          bookingId: '01930000-0000-7000-8000-000000000011',
          bookingRef: 'BK-2026-0002',
          bookingChannel: 'DIRECT_ONLINE',
          guest: { guestId: '01930000-0000-7000-8000-000000000021', fullName: 'Bob Silva' },
          lineSummary: { total: 1, booked: 1, firstStayDate: '2026-11-01', lastStayDate: '2026-11-02' },
        },
      ],
      pagination: { limit: 100, offset: 0, returned: 2 },
    },
  };
}

test('only FRONT_DESK holds the booking list permission', () => {
  assert.equal(canSearchBookings('FRONT_DESK'), true);
  for (const role of ['SERVICE_STAFF', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'] as const) {
    assert.equal(canSearchBookings(role), false, `${role} cannot list bookings`);
  }
  assert.equal(canSearchBookings(null), false);
  assert.equal(canSearchBookings(undefined), false);
});

test('parseBookingOptions maps list rows to picker options', () => {
  const options = parseBookingOptions(listPayload());
  assert.equal(options.length, 2);

  const [first, second] = options;
  assert.equal(first.bookingId, BOOKING_UUID);
  assert.equal(first.bookingRef, 'BK-2026-0001');
  assert.equal(first.guestName, 'Alice Perera');
  assert.equal(first.firstStayDate, '2026-10-05');
  assert.equal(first.lastStayDate, '2026-10-08');
  assert.equal(first.statusLabel, '1 BOOKED · 1 CHECKED_IN');
  assert.equal(second.statusLabel, '1 BOOKED');

  // Malformed payloads never throw and never yield phantom rows.
  assert.deepEqual(parseBookingOptions(null), []);
  assert.deepEqual(parseBookingOptions({ data: {} }), []);
});

test('filterBookingOptions matches reference or guest name, case-insensitively', () => {
  const options = parseBookingOptions(listPayload());

  assert.equal(filterBookingOptions(options, '').length, 2);
  assert.deepEqual(filterBookingOptions(options, 'bk-2026-0002').map((o) => o.bookingId), ['01930000-0000-7000-8000-000000000011']);
  assert.deepEqual(filterBookingOptions(options, 'alice').map((o) => o.bookingId), [BOOKING_UUID]);
  assert.deepEqual(filterBookingOptions(options, 'SILVA').map((o) => o.bookingRef), ['BK-2026-0002']);
  assert.equal(filterBookingOptions(options, 'nobody').length, 0);
});

test('bookingOptionLabel joins reference and guest name', () => {
  const [first] = parseBookingOptions(listPayload());
  assert.equal(bookingOptionLabel(first), 'BK-2026-0001 · Alice Perera');
});

test('fetchBookingOptions returns options on success and a safe failure on error', async () => {
  const ok = await fetchBookingOptions(async () => Response.json(listPayload()));
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.items.length, 2);

  const forbidden = await fetchBookingOptions(
    async () => new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 }),
  );
  assert.equal(forbidden.ok, false);
  assert.equal(!forbidden.ok && forbidden.status, 403);
  assert.equal(!forbidden.ok && forbidden.message, 'Forbidden');

  const offline = await fetchBookingOptions(async () => {
    throw new Error('offline');
  });
  assert.equal(offline.ok, false);
  assert.equal(!offline.ok && offline.status, 0);
});
