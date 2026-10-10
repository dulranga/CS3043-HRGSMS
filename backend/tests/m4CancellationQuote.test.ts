import assert from 'node:assert/strict';
import test from 'node:test';
import { getCancellationQuote, type DbClient } from '../src/services/cancellationService.js';

const bookingId = '01930000-0000-7000-8000-000000000010';
function row(overrides: Record<string, unknown> = {}) {
  return {
    line_id: 'line-one', status: 'BOOKED', stay_start_date: '2026-10-20',
    cancellation_fee: '5000.00', no_show_grace_days: 1, invoice_status: 'DRAFT',
    cutoff_deadline: '2026-10-21T00:00:00+05:30', now_time: '2026-10-10T12:00:00Z', ...overrides,
  };
}
function db(rows: ReturnType<typeof row>[]): DbClient {
  return { async query<T>(sql: string, params?: unknown[]) {
    assert.doesNotMatch(sql, /LIMIT\s+1/i, 'Whole quotes must not discard later lines');
    assert.equal(params?.[0], bookingId);
    return { rows: rows as T[] };
  } };
}
test('whole quote sums all line fees and reports the earliest cutoff with no single-line attribution', async () => {
  const result = await getCancellationQuote(db([row({ cutoff_deadline: '2026-10-22T00:00:00+05:30' }), row({ line_id: 'line-two' })]), bookingId);
  assert.equal(result.is_eligible, true);
  assert.equal(result.cancellation_fee, 10000);
  assert.equal(result.line_id, undefined);
  assert.equal(result.cutoff_deadline, '2026-10-21T00:00:00+05:30');
});
test('a later non-BOOKED line denies the whole quote', async () => {
  const result = await getCancellationQuote(db([row(), row({ line_id: 'line-two', status: 'CHECKED_IN' })]), bookingId);
  assert.equal(result.is_eligible, false);
  assert.match(result.rejection_reason!, /CHECKED_IN.*line-two/);
});
test('a later line at its cutoff denies the whole quote; just before it stays eligible', async () => {
  const atCutoff = row({ line_id: 'line-two', now_time: '2026-10-20T18:30:00Z' });
  assert.equal((await getCancellationQuote(db([row(), atCutoff]), bookingId)).is_eligible, false);
  assert.equal((await getCancellationQuote(db([row(), { ...atCutoff, now_time: '2026-10-20T18:29:59.999Z' }]), bookingId)).is_eligible, true);
});
test('FINAL invoices and missing lines remain denied', async () => {
  assert.equal((await getCancellationQuote(db([row({ invoice_status: 'FINAL' })]), bookingId)).is_eligible, false);
  assert.equal((await getCancellationQuote(db([]), bookingId)).is_eligible, false);
});
test('per-line quote preserves its one fee and line attribution; fractional fees sum in cents', async () => {
  const single = await getCancellationQuote(db([row()]), bookingId, 'line-one');
  assert.equal(single.line_id, 'line-one');
  assert.equal(single.cancellation_fee, 5000);
  const whole = await getCancellationQuote(db([row({ cancellation_fee: '0.10' }), row({ line_id: 'line-two', cancellation_fee: '0.10' }), row({ line_id: 'line-three', cancellation_fee: '0.10' })]), bookingId);
  assert.equal(whole.cancellation_fee, 0.3);
});
