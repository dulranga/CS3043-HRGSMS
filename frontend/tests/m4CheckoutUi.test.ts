import assert from 'node:assert/strict';
import test from 'node:test';

import { describeCheckoutError } from '../src/lib/checkoutViewModel.ts';

test('describeCheckoutError returns user-friendly messages for known API error codes', () => {
  const codeToSubstrings: Array<[string, string]> = [
    ['AUTHENTICATION_REQUIRED', 'log in'],
    ['FORBIDDEN', 'staff may process checkouts'],
    ['BOOKING_NOT_FOUND', 'not found'],
    ['ROOM_LINE_NOT_FOUND', 'Room line not found'],
    ['INVALID_LINE_ID', 'Invalid room line ID'],
    ['LINE_ALREADY_CHECKED_OUT', 'already checked out'],
    ['INVOICE_ALREADY_FINAL', 'already final'],
    ['OUTSTANDING_BALANCE_DUE', 'outstanding balance'],
    ['UNREFUNDED_CREDIT_REMAINING', 'unrefunded credit'],
    ['INVALID_LINE_STATUS', 'must be CHECKED_IN'],
    ['LINE_BOOKING_MISMATCH', 'does not belong to this booking'],
    ['NO_OPEN_ASSIGNMENT', 'No active room assignment'],
    ['NOT_CHECKED_OUT', 'not currently checked out'],
  ];

  for (const [code, expected] of codeToSubstrings) {
    const msg = describeCheckoutError(code, '');
    assert.ok(
      msg.toLowerCase().includes(expected.toLowerCase()),
      `Expected ${code} message to include "${expected}", but got: "${msg}"`
    );
  }
});

test('describeCheckoutError falls back to provided message for unknown codes', () => {
  const fallback = describeCheckoutError('SOME_NEW_ERROR', 'The database exploded');
  assert.equal(fallback, 'The database exploded');
});
