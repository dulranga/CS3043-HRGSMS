import { useCallback, useState } from 'react';

import { BalanceSummaryCard, PaymentEntryForm, PaymentHistoryPanel } from '@/components/billing/PaymentPanel';
import { AppShell } from '@/components/layout/AppShell';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

/**
 * M4-S14: Payment entry and history page.
 *
 * Staff look up a booking by UUID and can:
 *   - View the signed balance / credit summary
 *   - Post partial or full payments (CASH or BANK_TRANSFER)
 *   - Post a staff-approved manual refund (only when a credit exists)
 *   - Record a failed payment attempt (balance unaffected)
 *   - Reverse a SUCCESSFUL payment (reopens the balance)
 *
 * Authorization (staff-only) is enforced by the backend (M4-S08);
 * online guests receive 403 from every payment-write endpoint.
 * The same-origin HTTP-only session cookie supplies staff identity.
 */
export default function PaymentPage() {
  const [bookingId, setBookingId] = useState('');
  const [history, setHistory] = useState<PaymentHistoryView | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [lastReceiptRef, setLastReceiptRef] = useState<string | null>(null);

  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const trimmed = bookingId.trim();
    if (!trimmed) {
      setHistoryError('Enter a booking UUID to load payment history.');
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
        setHistoryError('No booking found with that UUID.');
      } else {
        setHistoryError(result.message || 'Failed to load payment history.');
      }
      return;
    }
    setHistory(buildPaymentHistoryView(result.data));
  }, [bookingId]);

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
    <AppShell>
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

            {/* Booking lookup */}
            <Card className="shadow-md" id="payment-lookup-card">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Look up booking</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="payment-booking-id">Booking UUID</Label>
                    <Input
                      id="payment-booking-id"
                      value={bookingId}
                      placeholder="e.g. 01930000-0000-0000-0000-000000000001"
                      onChange={(e) => setBookingId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') loadHistory();
                      }}
                    />
                  </div>
                  <Button
                    id="payment-load-btn"
                    onClick={loadHistory}
                    disabled={loadingHistory}
                  >
                    {loadingHistory ? 'Loading…' : 'Load payments'}
                  </Button>
                </div>
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
    </AppShell>
  );
}
