import { useCallback, useState } from 'react';

import { CheckoutPanel } from '@/components/billing/CheckoutPanel';
import { AppShell } from '@/components/layout/AppShell';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BookingStaySummary,
  StayBookingGroup,
  buildStayGroup,
  mergeStayLines,
  parseActiveStays,
  stayRequestPath,
} from '@/lib/activeStayViewModel';
import { describeCheckoutError, postCheckout } from '@/lib/checkoutViewModel';
import {
  InvoiceDetailView,
  buildInvoiceDetailView,
  describeInvoiceError,
  fetchInvoiceDetail,
} from '@/lib/invoiceViewModel';

const API_BASE = '/api';

/**
 * M4-S15: Staff per-line checkout UI.
 *
 * Staff look up a booking by UUID. The page fetches both the active stay
 * (to find CHECKED_IN lines) and the invoice (to enforce the exact-zero
 * balance guard). Displays DRAFT/FINAL statement status and allows checking
 * out individual lines if the balance is exactly zero.
 */
export default function CheckoutPage() {
  const [bookingId, setBookingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [group, setGroup] = useState<StayBookingGroup | null>(null);
  const [invoice, setInvoice] = useState<InvoiceDetailView | null>(null);

  const [processingLineId, setProcessingLineId] = useState<string | null>(null);
  const [checkoutErrorId, setCheckoutErrorId] = useState<string | null>(null);
  const [checkoutErrorMsg, setCheckoutErrorMsg] = useState<string | null>(null);
  const [successReceipt, setSuccessReceipt] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const trimmed = bookingId.trim();
    if (!trimmed) {
      setError('Enter a booking UUID to load checkout data.');
      setGroup(null);
      setInvoice(null);
      return;
    }

    setLoading(true);
    setError(null);
    setGroup(null);
    setInvoice(null);
    setSuccessReceipt(null);
    setCheckoutErrorMsg(null);
    setCheckoutErrorId(null);

    try {
      // Fetch invoice for balance guard
      const invoiceResult = await fetchInvoiceDetail({ bookingId: trimmed, apiBase: API_BASE });
      if (!invoiceResult.ok) {
        setError(`Invoice Error: ${describeInvoiceError(invoiceResult)}`);
        setLoading(false);
        return;
      }

      // Fetch booking base to get lines
      const bookingRes = await fetch(`${API_BASE}/bookings/${encodeURIComponent(trimmed)}`);
      const bookingPayload = await bookingRes.json().catch(() => null);
      if (!bookingRes.ok) {
        setError(`Booking Error: ${bookingPayload?.error?.message ?? 'Not found'}`);
        setLoading(false);
        return;
      }

      // Fetch active stays
      const staysRes = await fetch(`${API_BASE}${stayRequestPath(trimmed)}`);
      const staysPayload = await staysRes.json().catch(() => null);
      if (!staysRes.ok) {
        setError(`Active Stay Error: ${staysPayload?.error?.message ?? 'Not found'}`);
        setLoading(false);
        return;
      }

      const activeStays = parseActiveStays(staysPayload);
      const summary = bookingPayload.data as BookingStaySummary;

      const mergedLines = mergeStayLines(summary.lines ?? [], activeStays);
      const builtGroup = buildStayGroup(
        {
          bookingId: summary.bookingId,
          bookingRef: summary.bookingRef,
          guestName: summary.guest?.fullName ?? null,
        },
        mergedLines,
      );

      setInvoice(buildInvoiceDetailView(invoiceResult.data));
      setGroup(builtGroup);
    } catch {
      setError('Unable to reach the services.');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  const handleCheckout = useCallback(
    async (lineId: string) => {
      if (!group || !invoice) return;
      setProcessingLineId(lineId);
      setCheckoutErrorId(null);
      setCheckoutErrorMsg(null);
      setSuccessReceipt(null);

      const result = await postCheckout(group.bookingId, lineId, 'Staff requested checkout', {
        apiBase: API_BASE,
      });

      if (!result.ok) {
        setCheckoutErrorId(lineId);
        setCheckoutErrorMsg(describeCheckoutError(result.code, result.message));
        setProcessingLineId(null);
        return;
      }

      setSuccessReceipt(result.data.provisional_statement_ref || 'OK');
      setProcessingLineId(null);

      // Reload to update status and invoice statement (DRAFT -> FINAL if terminal)
      await loadData();
    },
    [group, invoice, loadData],
  );

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Process departures per room line. Requires a settled consolidated balance (exact
                zero, no outstanding payments or unrefunded credits). Generates a statement
                receipt upon success.
              </p>
            </header>

            {/* Booking lookup */}
            <Card className="shadow-md" id="checkout-lookup-card">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Find booking</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="checkout-booking-id">Booking UUID</Label>
                    <Input
                      id="checkout-booking-id"
                      value={bookingId}
                      placeholder="e.g. 01930000-0000-0000-0000-000000000001"
                      onChange={(e) => setBookingId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') loadData();
                      }}
                    />
                  </div>
                  <Button
                    id="checkout-load-btn"
                    onClick={loadData}
                    disabled={loading}
                  >
                    {loading ? 'Loading…' : 'Load checkout data'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Success message from last action */}
            {successReceipt && (
              <div className="flex items-center gap-2 text-sm bg-secondary text-foreground p-3 rounded-lg border border-border shadow-sm">
                <span className="font-semibold text-primary">Success:</span> Room checked out.
                Statement reference:{' '}
                <span className="font-mono text-xs">{successReceipt}</span>
              </div>
            )}

            {/* Error state */}
            {error && (
              <Card className="shadow-md border-destructive">
                <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
              </Card>
            )}

            {/* Checkout panel */}
            {group && invoice && (
              <CheckoutPanel
                group={group}
                invoice={invoice}
                onCheckout={handleCheckout}
                processingLineId={processingLineId}
                errorLineId={checkoutErrorId}
                errorMsg={checkoutErrorMsg}
              />
            )}
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
