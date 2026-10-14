import { useCallback, useState } from 'react';
import {
  AlertCircle,
  Ban,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  Hotel,
  Info,
  LoaderCircle,
  Search,
  ShieldAlert,
  User,
} from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { PageContainer } from '@/components/layout/PageContainer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatLkr } from '@/lib/money';

import {
  RawCancellationQuote,
  describeCancellationError,
  fetchLineCancellationQuote,
  fetchWholeBookingCancellationQuote,
  postCancelLine,
  postCancelWholeBooking,
} from '@/lib/cancellationViewModel';

const API_BASE = '/api';

/**
 * M4-S18: Guest online own-booking cancellation UI.
 *
 * Simulates Member 2's "My Bookings" UI to provide the required per-line/whole
 * cancellation controls. Allows the tester to impersonate a guest by UUID so
 * the M4-S11 ownership guards (cross-account denial) and policy messages can
 * be verified from the guest perspective.
 */

/** Loose view of a `booking_room_line` as returned by GET /api/bookings/:bookingId. */
interface GuestBookingLineView {
  lineId: string;
  status: string;
  checkIn?: string;
  checkOut?: string;
  guestCount?: number;
  assignments?: Array<{
    roomNumber?: string | null;
    current?: boolean;
    unassignedAt?: string | null;
  }>;
}

type QuoteTarget = string | 'WHOLE_BOOKING';

type LineBadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'muted'
  | 'destructive'
  | 'outline-destructive';

const LINE_STATUS_META: Record<string, { label: string; badge: LineBadgeVariant }> = {
  BOOKED: { label: 'Reserved', badge: 'default' },
  CHECKED_IN: { label: 'Checked in', badge: 'outline' },
  CHECKED_OUT: { label: 'Checked out', badge: 'muted' },
  CANCELLED: { label: 'Cancelled', badge: 'destructive' },
  NO_SHOW: { label: 'No-show', badge: 'outline-destructive' },
};

function lineStatusMeta(status: string): { label: string; badge: LineBadgeVariant } {
  return LINE_STATUS_META[status] ?? { label: status, badge: 'muted' };
}

function currentRoomNumber(line: GuestBookingLineView): string | null {
  const assignment = line.assignments?.find((candidate) => candidate.current && !candidate.unassignedAt);
  return assignment?.roomNumber ?? null;
}

function formatDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

/** Policy quote result box shared by per-room and whole-booking cancellation flows. */
function CancellationQuoteBox({
  quote,
  processing,
  onConfirm,
  onDismiss,
}: {
  quote: RawCancellationQuote;
  processing: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!quote.is_eligible) {
    return (
      <div className="mt-3 space-y-2 rounded-lg border-2 border-destructive/20 bg-destructive/10 p-3 text-sm">
        <p className="flex items-center gap-2 font-semibold text-destructive">
          <Ban className="size-4" aria-hidden="true" /> Cancellation denied
        </p>
        <p className="text-muted-foreground">
          {quote.rejection_reason || 'This reservation is not eligible for cancellation.'}
        </p>
        <Button variant="secondary" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border-2 border-border bg-muted p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold tracking-tight">Cancellation eligible</p>
          <p className="text-muted-foreground">
            A flat cancellation fee of{' '}
            <strong className="text-foreground">{formatLkr(quote.cancellation_fee)}</strong> will apply
            to the invoice. Provisional room charges for these nights will be removed.
          </p>
          {quote.cutoff_deadline && (
            <p className="text-xs text-muted-foreground">
              Cutoff deadline: {new Date(quote.cutoff_deadline).toLocaleString()}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="destructive" size="sm" onClick={onConfirm} disabled={processing}>
          {processing ? 'Processing...' : 'Confirm Cancellation'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={processing}>
          Back
        </Button>
      </div>
    </div>
  );
}

/** One room line with its status, stay details and per-room cancellation controls. */
function GuestRoomLineCard({
  line,
  quote,
  isQuoteOpen,
  isQuoteLoading,
  isProcessing,
  onGetQuote,
  onConfirm,
  onDismissQuote,
}: {
  line: GuestBookingLineView;
  quote: RawCancellationQuote | null;
  isQuoteOpen: boolean;
  isQuoteLoading: boolean;
  isProcessing: boolean;
  onGetQuote: () => void;
  onConfirm: () => void;
  onDismissQuote: () => void;
}) {
  const meta = lineStatusMeta(line.status);
  const roomNumber = currentRoomNumber(line);
  const checkInText = formatDate(line.checkIn);
  const checkOutText = formatDate(line.checkOut);

  return (
    <div className="space-y-3 rounded-lg border-2 border-border bg-card p-4 transition-colors duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <BedDouble className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight">
              Room {roomNumber ?? 'Unassigned'}
            </span>
            <Badge variant={meta.badge}>{meta.label}</Badge>
          </div>
          {(checkInText || checkOutText) && (
            <p className="text-xs text-muted-foreground">
              {checkInText ?? '—'} → {checkOutText ?? '—'}
              {typeof line.guestCount === 'number' &&
                ` · ${line.guestCount} ${line.guestCount === 1 ? 'guest' : 'guests'}`}
            </p>
          )}
          <p className="break-all font-mono text-[10px] tracking-wide text-muted-foreground">
            {line.lineId}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isQuoteLoading ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Checking policy…
            </span>
          ) : isQuoteOpen ? null : line.status === 'BOOKED' ? (
            <Button variant="secondary" size="sm" onClick={onGetQuote}>
              Cancel Room
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Unavailable
            </Button>
          )}
        </div>
      </div>

      {isQuoteOpen && quote && (
        <CancellationQuoteBox
          quote={quote}
          processing={isProcessing}
          onConfirm={onConfirm}
          onDismiss={onDismissQuote}
        />
      )}
    </div>
  );
}

export default function GuestBookingsPage() {
  const [guestId, setGuestId] = useState('GUEST-UUID-HERE');
  const [bookingId, setBookingId] = useState('');

  const [bookingLines, setBookingLines] = useState<GuestBookingLineView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [processingLineId, setProcessingLineId] = useState<QuoteTarget | null>(null);
  const [quote, setQuote] = useState<RawCancellationQuote | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<QuoteTarget | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<QuoteTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Since M2-S21 is incomplete, we bypass the guest index and directly fetch the booking
  // but we enforce the X-User-Id header to hit the M4-S11 ownership guards.
  const loadBooking = useCallback(async () => {
    const trimmedBooking = bookingId.trim();
    if (!trimmedBooking) {
      setError('Enter a booking UUID.');
      setBookingLines(null);
      return;
    }

    setLoading(true);
    setError(null);
    setBookingLines(null);
    setQuote(null);
    setQuoteTarget(null);
    setQuoteLoading(null);
    setSuccessMsg(null);
    setActionError(null);

    try {
      // Using the generic staff route but passing x-user-id as if it was a guest
      const res = await fetch(`${API_BASE}/bookings/${encodeURIComponent(trimmedBooking)}`, {
        headers: { 'x-user-id': guestId.trim() },
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        setError(payload?.error?.message || 'Failed to load booking. Cross-account denial?');
        return;
      }

      // We expect data.lines array
      if (payload.data && payload.data.lines) {
        setBookingLines(payload.data.lines);
      } else {
        setError('Booking data did not contain lines.');
      }
    } catch {
      setError('Network error reaching the server.');
    } finally {
      setLoading(false);
    }
  }, [bookingId, guestId]);

  const handleGetQuote = useCallback(async (target: QuoteTarget) => {
    setQuote(null);
    setQuoteTarget(null);
    setQuoteLoading(target);
    setActionError(null);
    setSuccessMsg(null);

    const headers = { 'x-user-id': guestId.trim() };

    const result =
      target === 'WHOLE_BOOKING'
        ? await fetchWholeBookingCancellationQuote(bookingId, { apiBase: API_BASE, headers })
        : await fetchLineCancellationQuote(bookingId, target, { apiBase: API_BASE, headers });

    setQuoteLoading(null);
    if (result.ok) {
      setQuote(result.data);
      setQuoteTarget(target);
    } else {
      setActionError(describeCancellationError(result.code, result.message));
    }
  }, [bookingId, guestId]);

  const handleConfirmCancel = useCallback(async () => {
    if (!quoteTarget) return;
    const target = quoteTarget;
    setProcessingLineId(target);
    setActionError(null);
    setSuccessMsg(null);

    const headers = { 'x-user-id': guestId.trim() };
    const reason = 'Online guest cancellation via My Bookings';

    let outcomeMessage: string;
    let outcomeIsError = false;

    if (target === 'WHOLE_BOOKING') {
      const res = await postCancelWholeBooking(bookingId, reason, { apiBase: API_BASE, headers });
      if (res.ok) {
        outcomeMessage = `Whole booking cancelled. Fee applied: ${formatLkr(res.data.total_cancellation_fees)}`;
      } else {
        outcomeIsError = true;
        outcomeMessage = describeCancellationError(res.code, res.message);
      }
    } else {
      const res = await postCancelLine(bookingId, target, reason, { apiBase: API_BASE, headers });
      if (res.ok) {
        outcomeMessage = `Room cancelled. Fee applied: ${formatLkr(res.data.cancellation_fee)}`;
      } else {
        outcomeIsError = true;
        outcomeMessage = describeCancellationError(res.code, res.message);
      }
    }

    setProcessingLineId(null);
    setQuote(null);
    setQuoteTarget(null);
    // Reload first so the outcome message survives the refresh and stays visible.
    await loadBooking();

    if (outcomeIsError) setActionError(outcomeMessage);
    else setSuccessMsg(outcomeMessage);
  }, [bookingId, quoteTarget, guestId, loadBooking]);

  const allBooked = bookingLines?.length
    ? bookingLines.every((line) => line.status === 'BOOKED')
    : false;
  const reservedCount = bookingLines?.filter((line) => line.status === 'BOOKED').length ?? 0;

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-secondary shadow-sm">
                <CalendarDays className="size-6" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">My Bookings</h1>
                <p className="text-sm text-muted-foreground">
                  Simulated guest view for online per-room and whole-booking cancellations.
                  Verify M4-S11 cross-account denial and policy messages by impersonating a guest
                  account.
                </p>
              </div>
            </header>

            <Card className="shadow-md" id="guest-session-card">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="flex items-center gap-2 text-lg tracking-tight">
                  <User className="size-4 text-muted-foreground" aria-hidden="true" />
                  Guest Session Simulator
                </CardTitle>
                <CardDescription>
                  Requests carry the guest account UUID in the x-user-id header, so only bookings
                  linked to that guest account will load.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-0 md:p-5 md:pt-0">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="guest-id">Guest Account UUID (x-user-id)</Label>
                    <Input
                      id="guest-id"
                      value={guestId}
                      onChange={(e) => setGuestId(e.target.value)}
                      placeholder="e.g. guest-123"
                    />
                    <p className="text-xs text-muted-foreground">
                      Identifies the guest whose own records may be accessed.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="booking-id">Booking UUID</Label>
                    <Input
                      id="booking-id"
                      value={bookingId}
                      onChange={(e) => setBookingId(e.target.value)}
                      placeholder="Enter a booking ID to load"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') loadBooking();
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Press Enter to load. Bookings owned by another guest are denied.
                    </p>
                  </div>
                </div>
                <Button onClick={loadBooking} disabled={loading} className="w-full md:w-auto">
                  {loading ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Search aria-hidden="true" />
                  )}
                  {loading ? 'Loading...' : 'Simulate Guest Login & Load'}
                </Button>
              </CardContent>
            </Card>

            {error && (
              <Alert variant="destructive" id="load-error">
                <AlertCircle />
                <AlertTitle>Could not load booking</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {successMsg && (
              <Alert id="cancel-success">
                <CheckCircle2 />
                <AlertTitle>Cancellation complete</AlertTitle>
                <AlertDescription>{successMsg}</AlertDescription>
              </Alert>
            )}

            {actionError && (
              <Alert variant="destructive" id="cancel-error">
                <AlertCircle />
                <AlertTitle>Cancellation action failed</AlertTitle>
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}

            {!bookingLines && !loading && !error && (
              <Card className="shadow-sm" id="empty-state-card">
                <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="flex size-14 items-center justify-center rounded-full bg-secondary">
                    <Hotel className="size-6 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <div className="max-w-md space-y-1">
                    <p className="font-semibold tracking-tight">No booking loaded yet</p>
                    <p className="text-sm text-muted-foreground">
                      Enter a guest account UUID and one of its booking UUIDs above, then load the
                      reservation to review per-room and whole-booking cancellation options.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {bookingLines && (
              <div className="space-y-4" id="loaded-booking">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold tracking-tight">Manage cancellation</h2>
                  <p className="text-sm text-muted-foreground">
                    {bookingLines.length} room {bookingLines.length === 1 ? 'line' : 'lines'} in this
                    reservation · {reservedCount} currently reserved and cancellable.
                  </p>
                </div>

                <Card className="shadow-md border-destructive/20" id="whole-booking-cancel-card">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 text-base tracking-tight text-destructive">
                      <ShieldAlert className="size-4" aria-hidden="true" />
                      Whole Booking Cancellation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    {!allBooked ? (
                      <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>
                          <span className="font-semibold text-foreground">
                            Whole booking cancellation unavailable.
                          </span>{' '}
                          Every room line must be in BOOKED status; checked-in, checked-out,
                          cancelled or no-show rooms cannot be cancelled together.
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          All rooms are currently reserved and can be cancelled together in a
                          single action.
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            variant="secondary"
                            onClick={() => handleGetQuote('WHOLE_BOOKING')}
                            disabled={
                              quoteLoading === 'WHOLE_BOOKING' ||
                              quoteTarget === 'WHOLE_BOOKING' ||
                              processingLineId === 'WHOLE_BOOKING'
                            }
                          >
                            Check Cancellation Policy & Fees
                          </Button>
                          {quoteLoading === 'WHOLE_BOOKING' && (
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                              Checking policy…
                            </span>
                          )}
                        </div>
                        {quoteTarget === 'WHOLE_BOOKING' && quote && (
                          <CancellationQuoteBox
                            quote={quote}
                            processing={processingLineId === 'WHOLE_BOOKING'}
                            onConfirm={handleConfirmCancel}
                            onDismiss={() => setQuoteTarget(null)}
                          />
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-md" id="per-room-cancel-card">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 text-base tracking-tight">
                      <Ban className="size-4" aria-hidden="true" />
                      Per-Room Cancellation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    {bookingLines.length === 0 ? (
                      <div className="rounded-lg bg-muted/50 py-6 text-center text-sm text-muted-foreground">
                        <Info className="mx-auto mb-2 size-5 opacity-50" aria-hidden="true" />
                        No room lines found.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {bookingLines.map((line) => (
                          <GuestRoomLineCard
                            key={line.lineId}
                            line={line}
                            quote={quote}
                            isQuoteOpen={quoteTarget === line.lineId}
                            isQuoteLoading={quoteLoading === line.lineId}
                            isProcessing={processingLineId === line.lineId}
                            onGetQuote={() => handleGetQuote(line.lineId)}
                            onConfirm={handleConfirmCancel}
                            onDismissQuote={() => setQuoteTarget(null)}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}
