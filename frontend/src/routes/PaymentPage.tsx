import { useCallback, useEffect, useState } from 'react';

import { BookingFinder } from '@/components/bookings/BookingFinder';
import { BillingFlowNav } from '@/components/billing/BillingFlowNav';
import { NextStepCard } from '@/components/billing/NextStepCard';
import { BalanceSummaryCard, PaymentEntryForm, PaymentHistoryPanel } from '@/components/billing/PaymentPanel';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBillingBooking } from '@/lib/billingFlow';
import {
  PaymentFormDraft,
  PaymentHistoryView,
  applyPaymentReceipt,
  buildPaymentHistoryView,
  describePaymentError,
  fetchPaymentHistory,
  postPayment,
  reversePaymentRequest,
} from '@/lib/paymentViewModel';

const API_BASE = '/api';
const FLOW_PATH = '/dashboard/billing/payments' as const;

/**
 * M4-S14: Payment entry and history page.
 *
 * Staff look up a booking (carried through the billing flow as URL state) and can:
 *   - View the signed balance / credit summary
 *   - Post partial or full payments (CASH or BANK_TRANSFER)
 *   - Post a staff-approved manual refund (only when a credit exists)
 *   - Record a failed payment attempt (balance unaffected)
 *   - Reverse a SUCCESSFUL payment (reopens the balance)
 *
 * Once the balance settles, the page surfaces the next step (checkout) instead
 * of leaving staff to guess where to go.
 *
 * Authorization (staff-only) is enforced by the backend (M4-S08);
 * online guests receive 403 from every payment-write endpoint.
 * The same-origin HTTP-only session cookie supplies staff identity.
 */
export default function PaymentPage() {
  const { booking, label, select } = useBillingBooking(FLOW_PATH);
  const [history, setHistory] = useState<PaymentHistoryView | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [lastReceiptRef, setLastReceiptRef] = useState<string | null>(null);

  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  const loadHistory = useCallback(async (identifier: string) => {
    const trimmed = identifier.trim();
    if (!trimmed) {
      setHistoryError('Select or enter a booking to load its payment history.');
      setHistory(null);
      return;
    }
    setLoadingHistory(true);
    setHistoryError(null);
    setHistory(null);
    setPostError(null);
    setReverseError(null);
    setLastReceiptRef(null);

    const result = await fetchPaymentHistory(trimmed, { apiBase: API_BASE });
    setLoadingHistory(false);

    if (!result.ok) {
      if (result.status === 401) {
        setHistoryError('Authentication required. Please log in before viewing payment history.');
      } else if (result.status === 403) {
        setHistoryError('Access denied. Only staff may view payment records.');
      } else if (result.status === 404) {
        setHistoryError('No booking found with that reference.');
      } else {
        setHistoryError(result.message || 'Failed to load payment history.');
      }
      return;
    }
    setHistory(buildPaymentHistoryView(result.data));
  }, []);

  useEffect(() => {
    if (booking) void loadHistory(booking);
  }, [booking, loadHistory]);

  const handleSelect = useCallback(
    (identifier: string, nextLabel: string) => {
      select(identifier, nextLabel);
    },
    [select],
  );

  const handlePost = useCallback(
    async (draft: PaymentFormDraft) => {
      if (!history) return;
      setPosting(true);
      setPostError(null);
      setLastReceiptRef(null);
      setReverseError(null);

      const result = await postPayment(
        history.bookingId,
        {
          amount: parseFloat(draft.amount.trim()),
          method: draft.method,
          kind: draft.mode,
          status: draft.recordAsFailed ? 'FAILED' : 'SUCCESSFUL',
          reference: draft.reference.trim() || undefined,
        },
        { apiBase: API_BASE },
      );

      setPosting(false);

      if (!result.ok) {
        setPostError(describePaymentError(result.code, result.message));
        return;
      }

      const d = result.data as {
        payment_id: string;
        booking_id: string;
        kind: 'PAYMENT' | 'REFUND';
        amount: number;
        method: 'CASH' | 'BANK_TRANSFER';
        status: 'SUCCESSFUL' | 'FAILED' | 'REVERSED';
        reference: string;
        paid_at: string;
        recorded_at: string;
        new_balance: number;
        is_credit: boolean;
        credit_amount: number;
        receipt?: { receipt_reference?: string };
      };

      const receiptRef =
        d.receipt?.receipt_reference ?? d.reference ?? 'POSTED';
      setLastReceiptRef(receiptRef);

      // Optimistic update instead of full re-fetch
      setHistory((prev) => (prev ? applyPaymentReceipt(prev, d) : prev));
    },
    [history],
  );

  const handleReverse = useCallback(
    async (paymentId: string) => {
      if (!history) return;
      setReversing(true);
      setReverseError(null);

      const result = await reversePaymentRequest(paymentId, { apiBase: API_BASE });
      setReversing(false);

      if (!result.ok) {
        setReverseError(describePaymentError(result.code, result.message));
        return;
      }

      // Full re-fetch to get accurate server-side balance
      const refresh = await fetchPaymentHistory(history.bookingId, { apiBase: API_BASE });
      if (refresh.ok) {
        setHistory(buildPaymentHistoryView(refresh.data));
      }
    },
    [history],
  );

  return (
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            {/* Page header */}
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Record partial or full payments, staff-approved refunds, and failed
                attempts for a booking. Only branch-scoped staff may post or reverse
                payments; online guests are denied by the API.
              </p>
            </header>

            <BillingFlowNav current={FLOW_PATH} booking={booking} label={label} />

            {/* Booking lookup */}
            <Card className="shadow-md" id="payment-lookup-card">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Find a booking</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <BookingFinder
                  onSelect={handleSelect}
                  selectedLabel={label ?? null}
                  busy={loadingHistory}
                  searchLabel="Search bookings by reference or guest name"
                />
                <p className="text-xs text-muted-foreground tracking-tight">
                  The backend enforces branch-scoped access. Front desk and branch managers
                  may only post payments for their own branch.
                </p>
              </CardContent>
            </Card>

            {/* History error */}
            {historyError && (
              <Card className="shadow-md border-destructive" id="payment-history-error-card">
                <CardContent className="p-4 text-sm text-destructive">{historyError}</CardContent>
              </Card>
            )}

            {/* Main payment UI */}
            {history && (
              <div className="space-y-4">
                {/* Guided next step from the current balance */}
                {history.summary.isCredit ? (
                  <NextStepCard
                    tone="warning"
                    title={`Credit ${history.summary.creditAmountFormatted} awaiting refund`}
                    description="Refund the credit below so the booking can be checked out."
                    actions={[
                      { label: 'View invoice', to: '/dashboard/billing/invoice' },
                      { label: 'Go to checkout', to: '/dashboard/billing/checkout', variant: 'outline' },
                    ]}
                    booking={booking}
                    label={label}
                  />
                ) : history.summary.isSettled ? (
                  <NextStepCard
                    tone="success"
                    title="Balance settled — ready to check out"
                    description="There is no outstanding balance. You can release the rooms now."
                    actions={[
                      { label: 'Go to checkout', to: '/dashboard/billing/checkout' },
                      { label: 'View invoice', to: '/dashboard/billing/invoice', variant: 'outline' },
                    ]}
                    booking={booking}
                    label={label}
                  />
                ) : (
                  <NextStepCard
                    tone="info"
                    title={`Outstanding balance ${history.summary.outstandingBalanceFormatted}`}
                    description="Record a payment below to clear the balance before the rooms can be checked out."
                    actions={[
                      { label: 'View invoice', to: '/dashboard/billing/invoice' },
                      { label: 'Go to checkout', to: '/dashboard/billing/checkout', variant: 'outline' },
                    ]}
                    booking={booking}
                    label={label}
                  />
                )}

                {/* Balance summary */}
                <BalanceSummaryCard summary={history.summary} />

                {/* Payment / refund entry */}
                <PaymentEntryForm
                  summary={history.summary}
                  onPost={handlePost}
                  loading={posting}
                  error={postError}
                  lastReceiptRef={lastReceiptRef}
                />

                {/* History list */}
                <PaymentHistoryPanel
                  history={history}
                  onReverse={handleReverse}
                  reversing={reversing}
                  reverseError={reverseError}
                />
              </div>
            )}
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}
