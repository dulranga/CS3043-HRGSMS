import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeCancellationError, fetchLineCancellationQuote, fetchWholeBookingCancellationQuote,
  postCancelLine, postCancelWholeBooking,
} from '../src/lib/cancellationViewModel.ts';

test('describeCancellationError returns user-friendly messages for known API error codes', () => {
  const codeToSubstrings: Array<[string, string]> = [
    ['AUTHENTICATION_REQUIRED', 'log in'],
    ['FORBIDDEN', 'authorized staff'],
    ['BOOKING_NOT_FOUND', 'not found'],
    ['ROOM_LINE_NOT_FOUND', 'Room line not found'],
    ['INVALID_LINE_ID', 'Invalid room line ID'],
    ['CANCELLATION_DEADLINE_PASSED', 'cutoff deadline has passed'],
    ['LINE_ALREADY_CANCELLED', 'already cancelled'],
    ['NOT_ALL_LINES_ELIGIBLE', 'not all lines are eligible'],
    ['INVALID_LINE_STATUS', 'must be BOOKED'],
    ['LINE_BOOKING_MISMATCH', 'does not belong to this booking'],
  ];

  for (const [code, expected] of codeToSubstrings) {
    const msg = describeCancellationError(code, '');
    assert.ok(
      msg.toLowerCase().includes(expected.toLowerCase()),
      `Expected ${code} message to include "${expected}", but got: "${msg}"`
    );
  }
});

test('describeCancellationError falls back to provided message for unknown codes', () => {
  const fallback = describeCancellationError('SOME_NEW_ERROR', 'Database exploded');
  assert.equal(fallback, 'Database exploded');
});

const bookingId = '01930000-0000-7000-8000-000000000010';
const lineId = '01930000-0000-7000-8000-000000000011';
const opts = { apiBase: '/api' };

test('both quote clients read the real controller envelope and preserve eligibility, fee and denial reason', async (t) => {
  let quote = { booking_id: bookingId, is_eligible: true, cancellation_fee: 10000, cutoff_deadline: '2026-10-21T00:00:00+05:30', rejection_reason: '' };
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    requests.push(String(url));
    return Response.json({ success: true, quote });
  });
  for (const response of [await fetchWholeBookingCancellationQuote(bookingId, opts), await fetchLineCancellationQuote(bookingId, lineId, opts)]) {
    assert.equal(response.ok, true);
    if (response.ok) assert.deepEqual(response.data, quote);
  }
  quote = { ...quote, is_eligible: false, rejection_reason: 'Cancellation deadline (no-show cutoff) has passed' };
  const denied = await fetchLineCancellationQuote(bookingId, lineId, opts);
  assert.equal(denied.ok, true);
  if (denied.ok) {
    assert.equal(denied.data.is_eligible, false);
    assert.match(denied.data.rejection_reason!, /deadline/);
  }
  assert.deepEqual(requests, [`/api/bookings/${bookingId}/cancellation-quote`, `/api/bookings/${bookingId}/lines/${lineId}/cancellation-quote`, `/api/bookings/${bookingId}/lines/${lineId}/cancellation-quote`]);
});

test('both confirmation clients unwrap cancellation receipts and send the supplied reason', async (t) => {
  const reason = 'QA accidental test booking cleanup';
  const lineReceipt = { booking_id: bookingId, line_id: lineId, status: 'CANCELLED', cancellation_fee: 5000, outstanding_balance: 42046 };
  const wholeReceipt = { booking_id: bookingId, cancelled_lines_count: 2, total_cancellation_fees: 10000, outstanding_balance: 10000 };
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init: RequestInit) => {
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body as string), { reason });
    return Response.json({ success: true, cancellation: String(url).endsWith('/cancel-all') ? wholeReceipt : lineReceipt });
  });
  const single = await postCancelLine(bookingId, lineId, reason, opts);
  const whole = await postCancelWholeBooking(bookingId, reason, opts);
  assert.equal(single.ok, true);
  assert.equal(whole.ok, true);
  if (single.ok) assert.deepEqual(single.data, lineReceipt);
  if (whole.ok) assert.deepEqual(whole.data, wholeReceipt);
});

test('malformed quote envelopes cannot expose a valid confirmation; malformed receipts require reload', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true }));
  const results = [
    await fetchLineCancellationQuote(bookingId, lineId, opts),
    await fetchWholeBookingCancellationQuote(bookingId, opts),
    await postCancelLine(bookingId, lineId, 'QA', opts),
    await postCancelWholeBooking(bookingId, 'QA', opts),
  ];
  for (const result of results) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'INVALID_RESPONSE');
  }
});

test('controller errors and transport failures remain explicit errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'FORBIDDEN', message: 'Wrong branch' } }, { status: 403 }));
  assert.deepEqual(await fetchWholeBookingCancellationQuote(bookingId, opts), { ok: false, status: 403, code: 'FORBIDDEN', message: 'Wrong branch' });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const result = await fetchLineCancellationQuote(bookingId, lineId, opts);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'NETWORK_ERROR');
});
