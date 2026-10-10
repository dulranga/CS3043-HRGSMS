import { useCallback, useEffect, useState } from 'react';

import { BookingFinder } from '@/components/bookings/BookingFinder';
import { BillingFlowNav } from '@/components/billing/BillingFlowNav';
import { CancellationPanel } from '@/components/billing/CancellationPanel';
import { NextStepCard } from '@/components/billing/NextStepCard';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BookingStaySummary,
  StayBookingGroup,
  buildStayGroup,
  mergeStayLines,
  parseActiveStays,
  stayRequestPath,
} from '@/lib/activeStayViewModel';
import { useBillingBooking } from '@/lib/billingFlow';
import {
  describeCancellationError,
  postCancelLine,
  postCancelWholeBooking,
} from '@/lib/cancellationViewModel';
import { formatLkr } from '@/lib/money';

const API_BASE = '/api';
const FLOW_PATH = '/dashboard/billing/cancellation' as const;

/**
 * M4-S16: Staff per-line or whole-booking cancellation UI.
 *
 * Looks up a booking (carried through the billing flow as URL state), lists
 * eligible lines for cancellation, displays policy quotes, and confirms
 * cancellation operations. After a cancellation the page points at the
 * updated invoice and payments instead of ending the journey.
 */
export default function CancellationPage() {
  const { booking, label, select } = useBillingBooking(FLOW_PATH);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [group, setGroup] = useState<StayBookingGroup | null>(null);

  const [processingId, setProcessingId] = useState<string | 'WHOLE_BOOKING' | null>(null);
  const [cancelErrorId, setCancelErrorId] = useState<string | 'WHOLE_BOOKING' | null>(null);
  const [cancelErrorMsg, setCancelErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = useCallback(async (identifier: string) => {
    const trimmed = identifier.trim();
    if (!trimmed) {
      setError('Select or enter a booking.');
      setGroup(null);
      return;
    }

    setLoading(true);
    setError(null);
    setGroup(null);
    setSuccessMsg(null);
    setCancelErrorMsg(null);
    setCancelErrorId(null);

    try {
      const bookingRes = await fetch(`${API_BASE}/bookings/${encodeURIComponent(trimmed)}`);
      const bookingPayload = await bookingRes.json().catch(() => null);
      if (!bookingRes.ok) {
        setError(`Booking Error: ${bookingPayload?.error?.message ?? 'Not found'}`);
        setLoading(false);
        return;
      }

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

      setGroup(builtGroup);
    } catch {
      setError('Unable to reach the services.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (booking) void loadData(booking);
  }, [booking, loadData]);

  const handleSelect = useCallback(
    (identifier: string, nextLabel: string) => {
      select(identifier, nextLabel);
    },
    [select],
  );

  const handleCancelLine = useCallback(
    async (lineId: string, reason: string) => {
      if (!group) return;
      setProcessingId(lineId);
      setCancelErrorId(null);
      setCancelErrorMsg(null);
      setSuccessMsg(null);

      const result = await postCancelLine(group.bookingId, lineId, reason, { apiBase: API_BASE });

      if (!result.ok) {
        setCancelErrorId(lineId);
        setCancelErrorMsg(describeCancellationError(result.code, result.message));
        setProcessingId(null);
        return;
      }

      setSuccessMsg(`Room line cancelled. Fee applied: ${formatLkr(result.data.cancellation_fee)}`);
      setProcessingId(null);
      await loadData(group.bookingId);
    },
    [group, loadData],
  );

  const handleCancelWholeBooking = useCallback(
    async (reason: string) => {
      if (!group) return;
      setProcessingId('WHOLE_BOOKING');
      setCancelErrorId(null);
      setCancelErrorMsg(null);
      setSuccessMsg(null);

      const result = await postCancelWholeBooking(group.bookingId, reason, { apiBase: API_BASE });

      if (!result.ok) {
        setCancelErrorId('WHOLE_BOOKING');
        setCancelErrorMsg(describeCancellationError(result.code, result.message));
        setProcessingId(null);
        return;
      }

      setSuccessMsg(
        `Whole booking cancelled. Total fees: ${formatLkr(result.data.total_cancellation_fees)}`,
      );
      setProcessingId(null);
      await loadData(group.bookingId);
    },
    [group, loadData],
  );

  return (
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Cancellations</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Process per-room or whole-booking cancellations prior to the no-show cutoff.
                Affected assignments will be closed, inventory released, and provisional
                charges replaced by the policy flat fee.
              </p>
            </header>

            <BillingFlowNav current={FLOW_PATH} booking={booking} label={label} />

            <Card className="shadow-md" id="cancel-lookup-card">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Find booking</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <BookingFinder
                  onSelect={handleSelect}
                  selectedLabel={label ?? null}
                  busy={loading}
                  searchLabel="Search bookings by reference or guest name"
                  allowReference={false}
                />
              </CardContent>
            </Card>

            {successMsg && (
              <NextStepCard
                tone="success"
                title="Cancellation complete"
                description={
                  <>
                    {successMsg} The updated invoice and any outstanding balance are ready to review.
                  </>
                }
                actions={[
                  { label: 'View updated invoice', to: '/dashboard/billing/invoice' },
                  { label: 'View payments', to: '/dashboard/billing/payments', variant: 'outline' },
                ]}
                booking={booking}
                label={label}
              />
            )}

            {error && (
              <Card className="shadow-md border-destructive">
                <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
              </Card>
            )}

            {group && (
              <CancellationPanel
                group={group}
                apiBase={API_BASE}
                onCancelLine={handleCancelLine}
                onCancelWholeBooking={handleCancelWholeBooking}
                processingLineId={processingId}
                errorId={cancelErrorId}
                errorMsg={cancelErrorMsg}
              />
            )}
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}
