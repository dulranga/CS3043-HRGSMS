import { useCallback, useState } from 'react';
import { AlertCircle, Ban, Clock, Info, ShieldAlert } from 'lucide-react';

import { StayBookingGroup, StayLineView } from '@/lib/activeStayViewModel';
import {
  RawCancellationQuote,
  fetchLineCancellationQuote,
  fetchWholeBookingCancellationQuote,
} from '@/lib/cancellationViewModel';
import { formatLkr, toMoneyString } from '@/lib/money';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface CancellationPanelProps {
  group: StayBookingGroup;
  apiBase: string;
  onCancelLine: (lineId: string, reason: string) => Promise<void>;
  onCancelWholeBooking: (reason: string) => Promise<void>;
  processingLineId: string | 'WHOLE_BOOKING' | null;
  errorId: string | 'WHOLE_BOOKING' | null;
  errorMsg: string | null;
}

export function CancellationPanel({
  group,
  apiBase,
  onCancelLine,
  onCancelWholeBooking,
  processingLineId,
  errorId,
  errorMsg,
}: CancellationPanelProps) {
  // Only BOOKED lines are eligible for standard cancellation
  const eligibleLines = group.lines.filter((l) => l.status === 'BOOKED');
  const isWholeBookingEligible =
    group.lines.length > 0 && group.lines.every((l) => l.status === 'BOOKED');

  const [wholeBookingQuote, setWholeBookingQuote] = useState<RawCancellationQuote | null>(null);
  const [loadingWholeQuote, setLoadingWholeQuote] = useState(false);
  const [wholeQuoteError, setWholeQuoteError] = useState<string | null>(null);

  const handleFetchWholeQuote = useCallback(async () => {
    setLoadingWholeQuote(true);
    setWholeQuoteError(null);
    const result = await fetchWholeBookingCancellationQuote(group.bookingId, { apiBase });
    setLoadingWholeQuote(false);
    if (!result.ok) {
      setWholeQuoteError(result.message);
      return;
    }
    setWholeBookingQuote(result.data);
  }, [group.bookingId, apiBase]);

  return (
    <div className="space-y-4" id="cancellation-panel">
      {/* Whole Booking Cancellation */}
      <Card className="shadow-md border-destructive/20" id="whole-booking-cancel-card">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base tracking-tight flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-4" aria-hidden="true" />
            Whole Booking Cancellation
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {!isWholeBookingEligible ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted p-3 rounded-lg">
              <Info className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <span className="font-semibold text-foreground">Whole booking cancellation unavailable.</span>{' '}
                Not all room lines are eligible (some may be checked in, checked out, or already cancelled).
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                All rooms are currently in BOOKED status and are eligible to be cancelled together.
              </p>
              {!wholeBookingQuote && !loadingWholeQuote && (
                <Button variant="secondary" onClick={handleFetchWholeQuote}>
                  Get Cancellation Quote
                </Button>
              )}
              {loadingWholeQuote && (
                <div className="text-sm flex items-center text-muted-foreground">
                  <Clock className="size-4 mr-2 animate-pulse" /> Fetching policy quote...
                </div>
              )}
              {wholeQuoteError && (
                <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                  {wholeQuoteError}
                </div>
              )}
              {wholeBookingQuote && (
                <CancellationQuoteBox
                  quote={wholeBookingQuote}
                  isProcessing={processingLineId === 'WHOLE_BOOKING'}
                  hasError={errorId === 'WHOLE_BOOKING'}
                  errorMsg={errorMsg}
                  onConfirm={() => onCancelWholeBooking('Guest requested whole-booking cancellation')}
                  onCancel={() => setWholeBookingQuote(null)}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-Line Cancellation */}
      <Card className="shadow-md" id="per-line-cancel-card">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base tracking-tight flex items-center gap-2">
            <Ban className="size-4" aria-hidden="true" />
            Per-Room Cancellation
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {eligibleLines.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground bg-muted/50 rounded-lg">
              <Info className="size-5 mx-auto mb-2 opacity-50" />
              No rooms are currently BOOKED for this reservation.
            </div>
          ) : (
            <div className="space-y-3">
              {eligibleLines.map((line) => (
                <CancelLineItem
                  key={line.lineId}
                  line={line}
                  bookingId={group.bookingId}
                  apiBase={apiBase}
                  isProcessing={processingLineId === line.lineId}
                  hasError={errorId === line.lineId}
                  errorMsg={errorMsg}
                  onConfirm={(reason) => onCancelLine(line.lineId, reason)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CancelLineItem({
  line,
  bookingId,
  apiBase,
  isProcessing,
  hasError,
  errorMsg,
  onConfirm,
}: {
  line: StayLineView;
  bookingId: string;
  apiBase: string;
  isProcessing: boolean;
  hasError: boolean;
  errorMsg: string | null;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [quote, setQuote] = useState<RawCancellationQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuote = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchLineCancellationQuote(bookingId, line.lineId, { apiBase });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setQuote(result.data);
  }, [bookingId, line.lineId, apiBase]);

  return (
    <div className="p-3 border border-border rounded-lg space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              Room {line.roomNumber || 'Unassigned'}
            </span>
            <Badge variant="outline" className="text-[10px] tracking-widest">
              {line.status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Check-in: {new Date(line.stayStart).toLocaleDateString()}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {line.lineId}
          </div>
        </div>

        {!quote && !loading && (
          <Button variant="secondary" size="sm" onClick={fetchQuote}>
            Get Quote
          </Button>
        )}
        {loading && (
          <span className="text-xs flex items-center text-muted-foreground">
            <Clock className="size-3 mr-1 animate-pulse" /> Loading...
          </span>
        )}
      </div>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
          {error}
        </div>
      )}

      {quote && (
        <CancellationQuoteBox
          quote={quote}
          isProcessing={isProcessing}
          hasError={hasError}
          errorMsg={errorMsg}
          onConfirm={() => onConfirm('Guest requested per-line cancellation')}
          onCancel={() => setQuote(null)}
        />
      )}
    </div>
  );
}

function CancellationQuoteBox({
  quote,
  isProcessing,
  hasError,
  errorMsg,
  onConfirm,
  onCancel,
}: {
  quote: RawCancellationQuote;
  isProcessing: boolean;
  hasError: boolean;
  errorMsg: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!quote.is_eligible) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 p-3 rounded-lg space-y-2 mt-2 text-sm">
        <div className="flex items-center gap-2 text-destructive font-semibold">
          <Ban className="size-4" /> Cancellation Denied
        </div>
        <p className="text-muted-foreground">
          {quote.rejection_reason || 'This line is not eligible for cancellation.'}
        </p>
        <div className="pt-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  const feeFormatted = formatLkr(toMoneyString(quote.cancellation_fee));

  return (
    <div className="bg-muted border border-border p-3 rounded-lg space-y-3 mt-2 text-sm">
      <div className="flex items-start gap-2 text-foreground">
        <AlertCircle className="size-4 mt-0.5 shrink-0" />
        <div>
          <span className="font-semibold">Cancellation Eligible</span>
          <p className="text-muted-foreground mt-0.5">
            Cancelling this will apply a flat cancellation fee of <strong>{feeFormatted}</strong> to the invoice.
            Provisional room charges for these nights will be removed.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Cutoff deadline: {quote.cutoff_deadline ? new Date(quote.cutoff_deadline).toLocaleString() : 'N/A'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={onConfirm}
          disabled={isProcessing}
        >
          {isProcessing ? 'Processing...' : 'Confirm Cancellation'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isProcessing}
        >
          Close
        </Button>
      </div>

      {hasError && errorMsg && (
        <div className="mt-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
