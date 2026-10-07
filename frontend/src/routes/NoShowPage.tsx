import { useCallback, useState } from 'react';

import { NoShowPanel } from '@/components/billing/NoShowPanel';
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
import {
  describeNoShowError,
  postMarkBookingNoShow,
  postMarkLineNoShow,
} from '@/lib/noShowViewModel';

const API_BASE = 'http://localhost:4000/api';

/**
 * M4-S17: Staff per-line no-show UI.
 *
 * Looks up a booking by UUID, lists eligible lines for no-show transition,
 * checks cutoff times, displays policy quotes, and confirms no-show actions.
 */
export default function NoShowPage() {
  const [bookingId, setBookingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [group, setGroup] = useState<StayBookingGroup | null>(null);

  const [processingId, setProcessingId] = useState<string | 'WHOLE_BOOKING' | null>(null);
  const [noShowErrorId, setNoShowErrorId] = useState<string | 'WHOLE_BOOKING' | null>(null);
  const [noShowErrorMsg, setNoShowErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const trimmed = bookingId.trim();
    if (!trimmed) {
      setError('Enter a booking UUID.');
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
  }, [bookingId]);

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

      setSuccessMsg(`Room line marked as no-show successfully. Fee applied: LKR ${result.data.no_show_fee}`);
      setProcessingId(null);
      await loadData();
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

      setSuccessMsg(`Whole booking marked as no-show successfully. Total fees: LKR ${result.data.total_no_show_fees}`);
      setProcessingId(null);
      await loadData();
    },
    [group, loadData],
  );

  return (
    <AppShell>
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

            <Card className="shadow-md" id="no-show-lookup-card">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Find booking</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="no-show-booking-id">Booking UUID</Label>
                    <Input
                      id="no-show-booking-id"
                      value={bookingId}
                      placeholder="e.g. 01930000-0000-0000-0000-000000000001"
                      onChange={(e) => setBookingId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') loadData();
                      }}
                    />
                  </div>
                  <Button onClick={loadData} disabled={loading}>
                    {loading ? 'Loading…' : 'Load booking data'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {successMsg && (
              <div className="flex items-center gap-2 text-sm bg-secondary text-foreground p-3 rounded-lg border border-border shadow-sm">
                <span className="font-semibold text-primary">Success:</span> {successMsg}
              </div>
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
    </AppShell>
  );
}
