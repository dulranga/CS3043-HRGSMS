import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PaymentHistoryView,
  RawPaymentHistory,
  applyPaymentReceipt,
  blankPaymentDraft,
  buildPaymentHistoryView,
  describePaymentError,
  validatePaymentDraft,
} from '../src/lib/paymentViewModel.ts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function rawHistory(overrides: Partial<RawPaymentHistory> = {}): RawPaymentHistory {
  return {
    booking_id: '01930000-0000-7000-8000-000000000010',
    payments: [
      {
        payment_id: '01930000-0000-7000-8000-000000000201',
        booking_id: '01930000-0000-7000-8000-000000000010',
        recorded_by: '01930000-0000-7000-8000-000000000050',
        kind: 'PAYMENT',
        amount: '20000.00',
        method: 'CASH',
        status: 'SUCCESSFUL',
        reference: 'PAY-20261006-000001',
        paid_at: '2026-10-06T08:00:00.000Z',
        recorded_at: '2026-10-06T08:01:00.000Z',
      },
      {
        payment_id: '01930000-0000-7000-8000-000000000202',
        booking_id: '01930000-0000-7000-8000-000000000010',
        recorded_by: '01930000-0000-7000-8000-000000000050',
        kind: 'PAYMENT',
        amount: '5000.00',
        method: 'BANK_TRANSFER',
        status: 'FAILED',
        reference: 'PAY-20261006-000002',
        paid_at: '2026-10-06T09:00:00.000Z',
        recorded_at: '2026-10-06T09:01:00.000Z',
      },
    ],
    summary: {
      successful_payments_total: 20000.00,
      successful_refunds_total: 0.00,
      net_payments: 20000.00,
      invoice_total: 39793.60,
      outstanding_balance: 19793.60,
      credit_amount: 0.00,
      is_credit: false,
      is_settled: false,
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('buildPaymentHistoryView transforms payment rows with correct labels and flags', () => {
  const view = buildPaymentHistoryView(rawHistory());
  assert.equal(view.rows.length, 2);

  const [successRow, failedRow] = view.rows;

  // SUCCESSFUL PAYMENT
  assert.equal(successRow.kind, 'PAYMENT');
  assert.equal(successRow.status, 'SUCCESSFUL');
  assert.equal(successRow.isSuccessful, true);
  assert.equal(successRow.isFailed, false);
  assert.equal(successRow.isReversed, false);
  assert.equal(successRow.isRefund, false);
  assert.equal(successRow.canReverse, true, 'SUCCESSFUL PAYMENT should be reversible');
  assert.equal(successRow.amountFormatted, 'LKR 20,000.00');
  assert.equal(successRow.kindLabel, 'Payment');
  assert.equal(successRow.methodLabel, 'Cash');
  assert.equal(successRow.statusLabel, 'Successful');

  // FAILED PAYMENT
  assert.equal(failedRow.status, 'FAILED');
  assert.equal(failedRow.isFailed, true);
  assert.equal(failedRow.canReverse, false, 'FAILED payments cannot be reversed');
  assert.equal(failedRow.amountFormatted, 'LKR 5,000.00');
});

test('buildPaymentHistoryView formats balance summary correctly', () => {
  const view = buildPaymentHistoryView(rawHistory());
  const { summary } = view;

  assert.equal(summary.successfulPaymentsTotal, 20000.00);
  assert.equal(summary.successfulRefundsTotal, 0.00);
  assert.equal(summary.netPayments, 20000.00);
  assert.equal(summary.invoiceTotal, 39793.60);
  assert.equal(summary.outstandingBalance, 19793.60);
  assert.equal(summary.isCredit, false);
  assert.equal(summary.isSettled, false);
  assert.equal(summary.invoiceTotalFormatted, 'LKR 39,793.60');
  assert.equal(summary.netPaymentsFormatted, 'LKR 20,000.00');
  assert.equal(summary.outstandingBalanceFormatted, 'LKR 19,793.60');
});

test('credit state is represented correctly: negative balance = unrefunded credit', () => {
  const creditHistory = rawHistory({
    summary: {
      successful_payments_total: 45000.00,
      successful_refunds_total: 0.00,
      net_payments: 45000.00,
      invoice_total: 39793.60,
      outstanding_balance: -5206.40,
      credit_amount: 5206.40,
      is_credit: true,
      is_settled: false,
    },
  });

  const view = buildPaymentHistoryView(creditHistory);
  const { summary } = view;

  assert.equal(summary.isCredit, true);
  assert.equal(summary.creditAmount, 5206.40);
  assert.equal(summary.creditAmountFormatted, 'LKR 5,206.40');
  assert.equal(summary.outstandingBalanceFormatted, 'LKR 5,206.40');
  assert.equal(summary.isSettled, false);
});

test('REFUND row: isRefund=true, canReverse=false (refunds cannot be reversed)', () => {
  const historyWithRefund = rawHistory({
    payments: [
      {
        payment_id: '01930000-0000-7000-8000-000000000203',
        booking_id: '01930000-0000-7000-8000-000000000010',
        recorded_by: '01930000-0000-7000-8000-000000000050',
        kind: 'REFUND',
        amount: '5206.40',
        method: 'CASH',
        status: 'SUCCESSFUL',
        reference: 'REF-20261006-000001',
        paid_at: '2026-10-06T10:00:00.000Z',
        recorded_at: '2026-10-06T10:01:00.000Z',
      },
    ],
    summary: {
      successful_payments_total: 45000.00,
      successful_refunds_total: 5206.40,
      net_payments: 39793.60,
      invoice_total: 39793.60,
      outstanding_balance: 0.00,
      credit_amount: 0.00,
      is_credit: false,
      is_settled: true,
    },
  });

  const view = buildPaymentHistoryView(historyWithRefund);
  const [refundRow] = view.rows;

  assert.equal(refundRow.isRefund, true);
  assert.equal(refundRow.isSuccessful, true);
  assert.equal(refundRow.canReverse, false, 'Refunds cannot be reversed via this UI');
  assert.equal(refundRow.kindLabel, 'Refund');
  assert.equal(view.summary.isSettled, true);
});

test('REVERSED row: canReverse=false, isReversed=true', () => {
  const historyWithReversed = rawHistory({
    payments: [
      {
        payment_id: '01930000-0000-7000-8000-000000000204',
        booking_id: '01930000-0000-7000-8000-000000000010',
        recorded_by: '01930000-0000-7000-8000-000000000050',
        kind: 'PAYMENT',
        amount: '20000.00',
        method: 'CASH',
        status: 'REVERSED',
        reference: 'PAY-20261006-000001',
        paid_at: '2026-10-06T08:00:00.000Z',
        recorded_at: '2026-10-06T08:01:00.000Z',
      },
    ],
    summary: {
      successful_payments_total: 0,
      successful_refunds_total: 0,
      net_payments: 0,
      invoice_total: 39793.60,
      outstanding_balance: 39793.60,
      credit_amount: 0,
      is_credit: false,
      is_settled: false,
    },
  });

  const view = buildPaymentHistoryView(historyWithReversed);
  const [row] = view.rows;

  assert.equal(row.isReversed, true);
  assert.equal(row.canReverse, false, 'Already-reversed payment cannot be reversed again');
  assert.equal(row.statusLabel, 'Reversed');
});

test('validatePaymentDraft rejects empty, negative, and high-precision amounts', () => {
  // Empty
  const emptyResult = validatePaymentDraft({ ...blankPaymentDraft(), amount: '' });
  assert.equal(emptyResult.isValid, false);
  assert.ok(emptyResult.amountError?.includes('required'));

  // Zero
  const zeroResult = validatePaymentDraft({ ...blankPaymentDraft(), amount: '0' });
  assert.equal(zeroResult.isValid, false);
  assert.ok(zeroResult.amountError?.includes('positive'));

  // Negative
  const negResult = validatePaymentDraft({ ...blankPaymentDraft(), amount: '-100' });
  assert.equal(negResult.isValid, false);

  // Too many decimal places
  const precisionResult = validatePaymentDraft({ ...blankPaymentDraft(), amount: '100.123' });
  assert.equal(precisionResult.isValid, false);
  assert.ok(precisionResult.amountError?.includes('2 decimal'));

  // Valid
  const validResult = validatePaymentDraft({ ...blankPaymentDraft(), amount: '15000.50', method: 'BANK_TRANSFER' });
  assert.equal(validResult.isValid, true);
  assert.equal(validResult.amountError, null);
});

test('applyPaymentReceipt optimistically adds the new payment to history', () => {
  const view = buildPaymentHistoryView(rawHistory());

  const prevLen = view.rows.length;
  const prevBalance = view.summary.outstandingBalance;

  const receipt = {
    payment_id: '01930000-0000-7000-8000-000000000299',
    booking_id: '01930000-0000-7000-8000-000000000010',
    kind: 'PAYMENT' as const,
    amount: 10000,
    method: 'CASH' as const,
    status: 'SUCCESSFUL' as const,
    reference: 'PAY-20261006-000099',
    paid_at: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    new_balance: prevBalance - 10000,
    is_credit: false,
    credit_amount: 0,
  };

  const updated = applyPaymentReceipt(view, receipt);

  assert.equal(updated.rows.length, prevLen + 1, 'Should add one row');
  assert.equal(updated.rows[0].paymentId, receipt.payment_id, 'New payment prepended');
  assert.equal(updated.summary.netPayments, 30000, 'Net payments should increase by 10000');
  assert.equal(
    updated.summary.outstandingBalance.toFixed(2),
    '9793.60',
    'Balance should decrease by 10000'
  );
});

test('describePaymentError returns staff-readable messages for known codes', () => {
  const cases: Array<[string, string]> = [
    ['OVERPAYMENT_NOT_ALLOWED', 'exceeds the outstanding balance'],
    ['NO_CREDIT_TO_REFUND', 'no credit balance'],
    ['DUPLICATE_REFERENCE', 'already exists'],
    ['FORBIDDEN', 'Only staff'],
    ['AUTHENTICATION_REQUIRED', 'Authentication required'],
  ];
  for (const [code, fragment] of cases) {
    const msg = describePaymentError(code, '');
    assert.ok(
      msg.toLowerCase().includes(fragment.toLowerCase()),
      `Expected "${fragment}" in error message for ${code}, got: "${msg}"`
    );
  }

  // Unknown code falls back to message
  const fallback = describePaymentError('MYSTERY_CODE', 'Something went wrong');
  assert.equal(fallback, 'Something went wrong');
});

test('exact totals: three partial payments sum correctly with no float drift', () => {
  // 39793.60 / 3 = 13264.53... — use discrete amounts
  const payments = [
    { amount: '13264.53', status: 'SUCCESSFUL' as const, kind: 'PAYMENT' as const },
    { amount: '13264.53', status: 'SUCCESSFUL' as const, kind: 'PAYMENT' as const },
    { amount: '13264.54', status: 'SUCCESSFUL' as const, kind: 'PAYMENT' as const },
  ];

  const history = rawHistory({
    payments: payments.map((p, i) => ({
      payment_id: `01930000-0000-7000-8000-0000000002${i.toString().padStart(2, '0')}`,
      booking_id: '01930000-0000-7000-8000-000000000010',
      recorded_by: '01930000-0000-7000-8000-000000000050',
      kind: p.kind,
      amount: p.amount,
      method: 'CASH' as const,
      status: p.status,
      reference: `PAY-20261006-00000${i}`,
      paid_at: '2026-10-06T08:00:00.000Z',
      recorded_at: '2026-10-06T08:01:00.000Z',
    })),
    summary: {
      successful_payments_total: 39793.60,
      successful_refunds_total: 0,
      net_payments: 39793.60,
      invoice_total: 39793.60,
      outstanding_balance: 0.00,
      credit_amount: 0,
      is_credit: false,
      is_settled: true,
    },
  });

  const view = buildPaymentHistoryView(history);
  assert.equal(view.rows.length, 3);
  assert.equal(view.summary.isSettled, true);
  assert.equal(view.summary.netPaymentsFormatted, 'LKR 39,793.60');
  assert.equal(view.summary.outstandingBalanceFormatted, 'LKR 0.00');
});
