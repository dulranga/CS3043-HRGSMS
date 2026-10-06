import { AlertCircle, CheckCircle, Clock, FileText, Info } from 'lucide-react';

import { StayBookingGroup, StayLineView } from '@/lib/activeStayViewModel';
import { InvoiceDetailView } from '@/lib/invoiceViewModel';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface CheckoutPanelProps {
  group: StayBookingGroup;
  invoice: InvoiceDetailView;
  onCheckout: (lineId: string) => Promise<void>;
  processingLineId: string | null;
  errorLineId: string | null;
  errorMsg: string | null;
}

export function CheckoutPanel({
  group,
  invoice,
  onCheckout,
  processingLineId,
  errorLineId,
  errorMsg,
}: CheckoutPanelProps) {
  const summary = invoice.summary;
  const isZeroBalance = summary.isSettled;
  const isFinal = invoice.status === 'FINAL';

  // Filter lines eligible for checkout (only CHECKED_IN)
  const eligibleLines = group.lines.filter((l) => l.status === 'CHECKED_IN');

  return (
    <div className="space-y-4" id="checkout-panel">
      {/* Pre-checkout Guards: Balance & Statement State */}
      <Card className="shadow-md border-2">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base tracking-tight flex items-center gap-2">
            <FileText className="size-4" aria-hidden="true" />
            Checkout Statement Guard
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-muted rounded-lg">
            <div className="space-y-1">
              <p className="text-sm font-semibold tracking-tight">Consolidated Balance</p>
              <p className="text-xs text-muted-foreground">
                {summary.isCredit ? 'Unrefunded credit balance' : 'Outstanding balance due'}
              </p>
            </div>
            <div className="text-right">
              <span
                className={`text-lg font-bold tabular-nums tracking-tight ${
                  isZeroBalance ? 'text-foreground' : 'text-destructive'
                }`}
              >
                {summary.isCredit
                  ? summary.creditAmountFormatted
                  : summary.outstandingBalanceFormatted}
              </span>
            </div>
          </div>

          {!isZeroBalance && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
              <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <span className="font-semibold">Checkout blocked.</span>{' '}
                The booking must have an exact zero balance before rooms can be checked out.
                Please process {summary.isCredit ? 'refunds' : 'payments'} in the billing section.
              </div>
            </div>
          )}

          {isZeroBalance && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-secondary rounded-lg p-3">
              <CheckCircle className="size-4 mt-0.5 text-foreground shrink-0" aria-hidden="true" />
              <div>
                <span className="font-semibold text-foreground">Balance settled.</span>{' '}
                Invoice statement is currently{' '}
                <Badge variant={isFinal ? 'default' : 'secondary'} className="ml-1 text-[10px]">
                  {invoice.status}
                </Badge>
                . <br />
                {isFinal
                  ? 'All room lines are terminal. Invoice is finalized.'
                  : 'Invoice is DRAFT/provisional. It will become FINAL once all lines are checked out or cancelled.'}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Eligible Lines */}
      <Card className="shadow-md">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base tracking-tight flex items-center gap-2">
            <CheckCircle className="size-4" aria-hidden="true" />
            Active Rooms Eligible for Checkout
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {eligibleLines.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground bg-muted/50 rounded-lg">
              <Info className="size-5 mx-auto mb-2 opacity-50" />
              No rooms are currently checked in for this booking.
            </div>
          ) : (
            <div className="space-y-3">
              {eligibleLines.map((line) => (
                <CheckoutLineItem
                  key={line.lineId}
                  line={line}
                  isZeroBalance={isZeroBalance}
                  isProcessing={processingLineId === line.lineId}
                  hasError={errorLineId === line.lineId}
                  errorMsg={errorMsg}
                  onCheckout={() => onCheckout(line.lineId)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CheckoutLineItem({
  line,
  isZeroBalance,
  isProcessing,
  hasError,
  errorMsg,
  onCheckout,
}: {
  line: StayLineView;
  isZeroBalance: boolean;
  isProcessing: boolean;
  hasError: boolean;
  errorMsg: string | null;
  onCheckout: () => void;
}) {
  return (
    <div className="p-3 border border-border rounded-lg space-y-2">
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
            Check-in: {new Date(line.stayStart).toLocaleDateString()} · Checkout:{' '}
            {new Date(line.stayEnd).toLocaleDateString()}
          </div>
          <div className="text-xs text-muted-foreground">
            Line ID: <span className="font-mono">{line.lineId}</span>
          </div>
        </div>

        <Button
          id={`checkout-btn-${line.lineId.slice(0, 8)}`}
          onClick={onCheckout}
          disabled={!isZeroBalance || isProcessing}
          variant="default"
          size="sm"
        >
          {isProcessing ? (
            <>
              <Clock className="size-3.5 mr-1.5 animate-pulse" />
              Processing…
            </>
          ) : (
            <>Check out room</>
          )}
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
