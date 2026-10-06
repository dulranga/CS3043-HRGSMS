import { useCallback, useState } from 'react';
import { AlertCircle, User } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { BoundedContainer } from '@/components/layout/BoundedContainer';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  RawCancellationQuote,
  fetchLineCancellationQuote,
  fetchWholeBookingCancellationQuote,
  postCancelLine,
  postCancelWholeBooking,
  describeCancellationError,
} from '@/lib/cancellationViewModel';

const API_BASE = 'http://localhost:4000/api';

/**
 * M4-S18: Guest online own-booking cancellation UI.
 *
 * Simulates Member 2's "My Bookings" UI to provide the required per-line/whole
 * cancellation controls. Allows the tester to impersonate a guest by UUID.
 */
export default function GuestBookingsPage() {
  const [guestId, setGuestId] = useState('GUEST-UUID-HERE');
  const [bookingId, setBookingId] = useState('');
  
  const [bookingLines, setBookingLines] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [processingLineId, setProcessingLineId] = useState<string | 'WHOLE_BOOKING' | null>(null);
  const [quote, setQuote] = useState<RawCancellationQuote | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<string | 'WHOLE_BOOKING' | null>(null);
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

  const handleGetQuote = useCallback(async (lineId: string | 'WHOLE_BOOKING') => {
    setQuote(null);
    setQuoteTarget(null);
    setActionError(null);
    setSuccessMsg(null);
    
    const headers = { 'x-user-id': guestId.trim() };
    
    if (lineId === 'WHOLE_BOOKING') {
      const res = await fetchWholeBookingCancellationQuote(bookingId, { apiBase: API_BASE, headers });
      if (res.ok) {
        setQuote(res.data);
        setQuoteTarget('WHOLE_BOOKING');
      } else {
        setActionError(describeCancellationError(res.code, res.message));
      }
    } else {
      const res = await fetchLineCancellationQuote(bookingId, lineId, { apiBase: API_BASE, headers });
      if (res.ok) {
        setQuote(res.data);
        setQuoteTarget(lineId);
      } else {
        setActionError(describeCancellationError(res.code, res.message));
      }
    }
  }, [bookingId, guestId]);

  const handleConfirmCancel = useCallback(async () => {
    if (!quoteTarget) return;
    setProcessingLineId(quoteTarget);
    setActionError(null);
    setSuccessMsg(null);

    const headers = { 'x-user-id': guestId.trim() };
    const reason = 'Online guest cancellation via My Bookings';

    if (quoteTarget === 'WHOLE_BOOKING') {
      const res = await postCancelWholeBooking(bookingId, reason, { apiBase: API_BASE, headers });
      if (res.ok) {
        setSuccessMsg(`Whole booking cancelled. Fee: ${res.data.total_cancellation_fees}`);
      } else {
        setActionError(describeCancellationError(res.code, res.message));
      }
    } else {
      const res = await postCancelLine(bookingId, quoteTarget, reason, { apiBase: API_BASE, headers });
      if (res.ok) {
        setSuccessMsg(`Room cancelled. Fee: ${res.data.cancellation_fee}`);
      } else {
        setActionError(describeCancellationError(res.code, res.message));
      }
    }
    
    setProcessingLineId(null);
    setQuote(null);
    setQuoteTarget(null);
    await loadBooking();
  }, [bookingId, quoteTarget, guestId, loadBooking]);

  const allBooked = bookingLines?.length ? bookingLines.every(l => l.status === 'BOOKED') : false;

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">My Bookings (Guest View)</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Simulated guest "My Bookings" UI for online per-line and whole-booking cancellations.
                Allows verifying M4-S11 cross-account denial and policy messages.
              </p>
            </header>

            <Card className="shadow-md">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight flex items-center gap-2">
                  <User className="size-4" /> Guest Session Simulator
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Guest Account UUID (x-user-id)</Label>
                    <Input
                      value={guestId}
                      onChange={(e) => setGuestId(e.target.value)}
                      placeholder="e.g. guest-123"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Booking UUID</Label>
                    <Input
                      value={bookingId}
                      onChange={(e) => setBookingId(e.target.value)}
                      placeholder="Enter a booking ID to load"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') loadBooking();
                      }}
                    />
                  </div>
                </div>
                <Button onClick={loadBooking} disabled={loading} className="w-full md:w-auto mt-2">
                  {loading ? 'Loading...' : 'Simulate Guest Login & Load'}
                </Button>
              </CardContent>
            </Card>

            {error && (
              <Card className="shadow-md border-destructive">
                <CardContent className="p-4 text-sm text-destructive font-medium">
                  {error}
                </CardContent>
              </Card>
            )}

            {successMsg && (
              <div className="bg-secondary text-foreground p-3 rounded-lg border border-border shadow-sm text-sm">
                <span className="font-semibold text-primary">Success:</span> {successMsg}
              </div>
            )}
            
            {actionError && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-lg border border-destructive/20 text-sm">
                <span className="font-semibold">Error:</span> {actionError}
              </div>
            )}

            {bookingLines && (
              <div className="space-y-4">
                <Card className="shadow-md border-destructive/20">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base tracking-tight text-destructive">Whole Booking Cancellation</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    {!allBooked ? (
                      <p className="text-sm text-muted-foreground">Not all rooms are eligible (must be BOOKED) to cancel the entire reservation.</p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">Cancel all rooms together.</p>
                        <Button 
                          variant="secondary" 
                          onClick={() => handleGetQuote('WHOLE_BOOKING')}
                          disabled={processingLineId === 'WHOLE_BOOKING'}
                        >
                          Check Cancellation Policy & Fees
                        </Button>
                        
                        {quoteTarget === 'WHOLE_BOOKING' && quote && (
                          <div className="mt-3 bg-muted p-3 rounded-lg border border-border text-sm">
                            {quote.is_eligible ? (
                              <div className="space-y-2">
                                <p className="font-semibold text-amber-600 flex items-center gap-2"><AlertCircle className="size-4"/> Eligible for Cancellation</p>
                                <p>A cancellation fee of LKR {quote.cancellation_fee} will apply.</p>
                                <div className="flex gap-2 pt-2">
                                  <Button variant="destructive" size="sm" onClick={handleConfirmCancel}>Confirm Cancellation</Button>
                                  <Button variant="outline" size="sm" onClick={() => setQuoteTarget(null)}>Back</Button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <p className="font-semibold text-destructive">Cancellation Denied</p>
                                <p>{quote.rejection_reason || 'Not eligible.'}</p>
                                <Button variant="outline" size="sm" onClick={() => setQuoteTarget(null)}>Dismiss</Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-md">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base tracking-tight">Per-Room Cancellation</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    {bookingLines.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No room lines found.</p>
                    ) : (
                      <div className="space-y-3">
                        {bookingLines.map(line => (
                          <div key={line.lineId} className="border border-border p-3 rounded-lg text-sm">
                            <div className="flex justify-between items-center">
                              <div>
                                <span className="font-semibold">Line ID:</span> {line.lineId}<br/>
                                <span className="font-semibold">Status:</span> {line.status}
                              </div>
                              <Button 
                                variant="secondary" 
                                size="sm" 
                                onClick={() => handleGetQuote(line.lineId)}
                                disabled={line.status !== 'BOOKED'}
                              >
                                {line.status === 'BOOKED' ? 'Cancel Room' : 'Unavailable'}
                              </Button>
                            </div>
                            
                            {quoteTarget === line.lineId && quote && (
                              <div className="mt-3 bg-muted p-3 rounded-lg border border-border text-sm">
                                {quote.is_eligible ? (
                                  <div className="space-y-2">
                                    <p className="font-semibold text-amber-600 flex items-center gap-2"><AlertCircle className="size-4"/> Eligible for Cancellation</p>
                                    <p>A cancellation fee of LKR {quote.cancellation_fee} will apply.</p>
                                    <div className="flex gap-2 pt-2">
                                      <Button variant="destructive" size="sm" onClick={handleConfirmCancel}>Confirm Cancellation</Button>
                                      <Button variant="outline" size="sm" onClick={() => setQuoteTarget(null)}>Back</Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="font-semibold text-destructive">Cancellation Denied</p>
                                    <p>{quote.rejection_reason || 'Not eligible.'}</p>
                                    <Button variant="outline" size="sm" onClick={() => setQuoteTarget(null)}>Dismiss</Button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
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
