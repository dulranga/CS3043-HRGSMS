import assert from 'node:assert/strict';
import test from 'node:test';

import { describeCancellationError } from '../src/lib/cancellationViewModel.ts';

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
