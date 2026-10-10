import { useCallback, useEffect, useState } from 'react';

import { BookingFinder } from '@/components/bookings/BookingFinder';
import { BillingFlowNav } from '@/components/billing/BillingFlowNav';
import { NextStepCard } from '@/components/billing/NextStepCard';
import { NoShowPanel } from '@/components/billing/NoShowPanel';
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
import { formatLkr } from '@/lib/money';
import {
  describeNoShowError,
  postMarkBookingNoShow,
  postMarkLineNoShow,
} from '@/lib/noShowViewModel';

const API_BASE = '/api';
const FLOW_PATH = '/dashboard/billing/no-show' as const;

/**
 * M4-S17: Staff per-line no-show UI.
 *
 * Looks up a booking (carried through the billing flow as URL state), lists
 * eligible lines for no-show transition, checks cutoff times, displays policy
 * quotes, and confirms no-show actions. After a no-show the page points at the
 * updated invoice and payments instead of ending the journey.
 */
export default function NoShowPage() {
  const { booking, label, select } = useBillingBooking(FLOW_PATH);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [group, setGroup] = useState<StayBookingGroup | null>(null);

  const [processingId, setProcessingId] = useState<string | 'WHOLE_BOOKING' | null>(null);
  const [noShowErrorId, setNoShowErrorId] = useState<string | 'WHOLE_BOOKING' | null>(null);
  const [noShowErrorMsg, setNoShowErrorMsg] = useState<string | null>(null);
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
    setNoShowErrorMsg(null);
    setNoShowErrorId(null);

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

  const handleMarkLineNoShow = useCallback(
    async (lineId: string, reason: string) => {
      if (!group) return;
      setProcessingId(lineId);
      setNoShowErrorId(null);
      setNoShowErrorMsg(null);
      setSuccessMsg(null);

      const result = await postMarkLineNoShow(group.bookingId, lineId, reason, { apiBase: API_BASE });

      if (!result.ok) {
        setNoShowErrorId(lineId);
        setNoShowErrorMsg(describeNoShowError(result.code, result.message));
        setProcessingId(null);
        return;
      }

      setSuccessMsg(`Room line marked as no-show. Fee applied: ${formatLkr(result.data.no_show_fee)}`);
      setProcessingId(null);
      await loadData(group.bookingId);
    },
    [group, loadData],
  );

  const handleMarkWholeBookingNoShow = useCallback(
    async (reason: string) => {
      if (!group) return;
      setProcessingId('WHOLE_BOOKING');
      setNoShowErrorId(null);
      setNoShowErrorMsg(null);
      setSuccessMsg(null);

      const result = await postMarkBookingNoShow(group.bookingId, reason, { apiBase: API_BASE });

      if (!result.ok) {
        setNoShowErrorId('WHOLE_BOOKING');
        setNoShowErrorMsg(describeNoShowError(result.code, result.message));
        setProcessingId(null);
        return;
      }

      setSuccessMsg(
        `Whole booking marked as no-show. Total fees: ${formatLkr(result.data.total_no_show_fees)}`,
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
              <h1 className="text-2xl font-bold tracking-tight">No-Shows</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Process per-room or whole-booking no-shows after the local cutoff deadline has passed.
                Affected assignments will be closed, inventory released, and provisional
                charges replaced by the policy no-show flat fee.
              </p>
            </header>

            <BillingFlowNav current={FLOW_PATH} booking={booking} label={label} />

            <Card className="shadow-md" id="no-show-lookup-card">
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
                title="No-show recorded"
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
              <NoShowPanel
                group={group}
                apiBase={API_BASE}
                onMarkLineNoShow={handleMarkLineNoShow}
                onMarkWholeBookingNoShow={handleMarkWholeBookingNoShow}
                processingLineId={processingId}
                errorId={noShowErrorId}
                errorMsg={noShowErrorMsg}
              />
            )}
          </div>
        </BoundedContainer>
      </PageContainer>
  );
}
