import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle,
  ChevronRight,
  Clock,
  CreditCard,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  PaymentBalanceSummary,
  PaymentFormDraft,
  PaymentHistoryView,
  PaymentRowView,
  blankPaymentDraft,
  validatePaymentDraft,
} from '@/lib/paymentViewModel';

// ─── Balance summary card ─────────────────────────────────────────────────────

export function BalanceSummaryCard({ summary }: { summary: PaymentBalanceSummary }) {
  return (
    <Card className="shadow-md border-2" id="payment-balance-summary-card">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base tracking-tight flex items-center gap-2">
          <CreditCard className="size-4" aria-hidden="true" />
          Payment Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-2">
        {/* Invoice total */}
        <div className="flex justify-between items-center py-1.5 border-b border-border">
          <span className="text-sm text-muted-foreground">Invoice total</span>
          <span className="text-sm font-semibold tabular-nums">{summary.invoiceTotalFormatted}</span>
        </div>

        {/* Successful payments */}
        <div className="flex justify-between items-center py-1.5 border-b border-border">
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
            Total payments
          </span>
          <span className="text-sm font-semibold tabular-nums">{summary.successfulPaymentsTotalFormatted}</span>
        </div>

        {/* Refunds (if any) */}
        {summary.successfulRefundsTotal > 0 && (
          <div className="flex justify-between items-center py-1.5 border-b border-border">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <ArrowDownLeft className="size-3.5" aria-hidden="true" />
              Total refunds
            </span>
            <span className="text-sm font-semibold tabular-nums text-destructive">
              −{summary.successfulRefundsTotalFormatted}
            </span>
          </div>
        )}

        {/* Net payments */}
        <div className="flex justify-between items-center py-1.5 border-b border-border">
          <span className="text-sm text-muted-foreground">Net payments applied</span>
          <span className="text-sm font-semibold tabular-nums">{summary.netPaymentsFormatted}</span>
        </div>

        {/* Balance / credit / settled */}
        <div className="flex justify-between items-center py-2">
          {summary.isCredit ? (
            <>
              <span className="text-sm font-semibold text-destructive flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Unrefunded credit
              </span>
              <span className="text-base font-bold tabular-nums text-destructive">
                {summary.creditAmountFormatted}
              </span>
            </>
          ) : summary.isSettled ? (
            <>
              <span className="text-sm font-semibold flex items-center gap-1.5">
                <CheckCircle className="size-3.5" aria-hidden="true" />
                Settled — balance due
              </span>
              <span className="text-base font-bold tabular-nums">LKR 0.00</span>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">Outstanding balance</span>
              <span className="text-base font-bold tabular-nums">
                {summary.outstandingBalanceFormatted}
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Payment / refund entry form ──────────────────────────────────────────────

export interface PaymentEntryFormProps {
  summary: PaymentBalanceSummary;
  onPost: (draft: PaymentFormDraft) => Promise<void>;
  loading: boolean;
  error: string | null;
  lastReceiptRef?: string | null;
}

export function PaymentEntryForm({
  summary,
  onPost,
  loading,
  error,
  lastReceiptRef,
}: PaymentEntryFormProps) {
  const [draft, setDraft] = useState<PaymentFormDraft>(blankPaymentDraft('PAYMENT'));
  const [showRefund, setShowRefund] = useState(false);

  const validation = validatePaymentDraft(draft);

  function setMode(mode: 'PAYMENT' | 'REFUND') {
    setShowRefund(mode === 'REFUND');
    setDraft(blankPaymentDraft(mode));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validation.isValid) return;
    onPost(draft);
  }

  const isRefund = draft.mode === 'REFUND';
  const canRefund = summary.isCredit;

  return (
    <Card className="shadow-md" id="payment-entry-form-card">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base tracking-tight flex items-center gap-2">
          <ArrowUpRight className="size-4" aria-hidden="true" />
          {isRefund ? 'Record Staff Refund' : 'Record Payment'}
        </CardTitle>
        {/* Mode switcher */}
        <div className="flex gap-2 mt-2 flex-wrap">
          <Button
            id="payment-mode-payment"
            type="button"
            size="sm"
            variant={!showRefund ? 'default' : 'secondary'}
            onClick={() => setMode('PAYMENT')}
            disabled={loading}
          >
            <ArrowUpRight className="size-3.5 mr-1" aria-hidden="true" />
            Payment
          </Button>
          <Button
            id="payment-mode-refund"
            type="button"
            size="sm"
            variant={showRefund ? 'default' : 'secondary'}
            onClick={() => setMode('REFUND')}
            disabled={loading || !canRefund}
            title={!canRefund ? 'Refunds are only available when there is an unrefunded credit.' : undefined}
          >
            <ArrowDownLeft className="size-3.5 mr-1" aria-hidden="true" />
            Refund
            {!canRefund && (
              <span className="ml-1 text-xs opacity-60">(no credit)</span>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0">
        {isRefund && !canRefund && (
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg p-3">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            A refund can only be posted when there is an unrefunded credit balance.
          </div>
        )}

        <form id="payment-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="payment-amount">Amount (LKR)</Label>
            <Input
              id="payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder={
                isRefund
                  ? `max ${summary.creditAmountFormatted}`
                  : `max ${summary.outstandingBalanceFormatted}`
              }
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              className={validation.amountError ? 'border-destructive' : ''}
              disabled={loading}
            />
            {validation.amountError && (
              <p className="text-xs text-destructive" id="payment-amount-error">
                {validation.amountError}
              </p>
            )}
          </div>

          {/* Method */}
          <div className="space-y-1.5">
            <Label htmlFor="payment-method">Payment Method</Label>
            <div className="flex gap-2 flex-wrap">
              {(['CASH', 'BANK_TRANSFER'] as const).map((m) => (
                <Button
                  key={m}
                  id={`payment-method-${m.toLowerCase()}`}
                  type="button"
                  size="sm"
                  variant={draft.method === m ? 'default' : 'secondary'}
                  onClick={() => setDraft({ ...draft, method: m })}
                  disabled={loading}
                >
                  {m === 'CASH' ? 'Cash' : 'Bank Transfer'}
                </Button>
              ))}
            </div>
          </div>

          {/* Reference (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="payment-reference">
              Reference{' '}
              <span className="text-xs text-muted-foreground font-normal">(optional — auto-generated if blank)</span>
            </Label>
            <Input
              id="payment-reference"
              placeholder={isRefund ? 'REF-YYYYMMDD-XXXXXX' : 'PAY-YYYYMMDD-XXXXXX'}
              value={draft.reference}
              onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
              disabled={loading}
            />
          </div>

          {/* Record as FAILED toggle — staff may log a failed attempt */}
          {!isRefund && (
            <div className="flex items-center gap-3">
              <Button
                id="payment-mark-failed"
                type="button"
                size="sm"
                variant={draft.recordAsFailed ? 'default' : 'secondary'}
                onClick={() => setDraft({ ...draft, recordAsFailed: !draft.recordAsFailed })}
                disabled={loading}
              >
                <Ban className="size-3.5 mr-1" aria-hidden="true" />
                Record as Failed
              </Button>
              {draft.recordAsFailed && (
                <span className="text-xs text-muted-foreground">
                  Status: FAILED — balance will not be affected.
                </span>
              )}
            </div>
          )}

          {/* API error */}
          {error && (
            <div
              id="payment-form-error"
              className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3"
            >
              <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Success receipt reference */}
          {lastReceiptRef && !error && (
            <div
              id="payment-receipt-banner"
              className="flex items-center gap-2 text-sm bg-card border border-border rounded-lg p-3"
            >
              <CheckCircle className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <span className="text-muted-foreground">Posted —</span>
              <span className="font-mono text-xs font-semibold">{lastReceiptRef}</span>
            </div>
          )}
        </form>
      </CardContent>

      <CardFooter className="p-4 pt-0">
        <Button
          id="payment-submit-btn"
          type="submit"
          form="payment-form"
          disabled={loading || !validation.isValid || (isRefund && !canRefund)}
          className="w-full"
        >
          {loading ? (
            <>
              <Clock className="size-4 mr-2 animate-pulse" aria-hidden="true" />
              Posting…
            </>
          ) : isRefund ? (
            <>
              <ArrowDownLeft className="size-4 mr-2" aria-hidden="true" />
              Post Refund
            </>
          ) : draft.recordAsFailed ? (
            <>
              <Ban className="size-4 mr-2" aria-hidden="true" />
              Record Failed Attempt
            </>
          ) : (
            <>
              <ChevronRight className="size-4 mr-2" aria-hidden="true" />
              Post Payment
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Single payment row ───────────────────────────────────────────────────────

function PaymentStatusBadge({ row }: { row: PaymentRowView }) {
  if (row.isReversed) {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <RotateCcw className="size-2.5" aria-hidden="true" />
        Reversed
      </Badge>
    );
  }
  if (row.isFailed) {
    return (
      <Badge variant="secondary" className="gap-1 text-xs text-destructive">
        <Ban className="size-2.5" aria-hidden="true" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="gap-1 text-xs">
      <CheckCircle className="size-2.5" aria-hidden="true" />
      Successful
    </Badge>
  );
}

interface PaymentRowProps {
  row: PaymentRowView;
  onReverse: (paymentId: string) => void;
  reversing: boolean;
}

function PaymentRow({ row, onReverse, reversing }: PaymentRowProps) {
  const isCredit = row.isRefund;
  const isNeutral = row.isFailed || row.isReversed;

  return (
    <div className="flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2 py-3 border-b border-border last:border-0">
      {/* Left: icon + description */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="mt-0.5 shrink-0">
          {isCredit ? (
            <ArrowDownLeft
              className={`size-4 ${isNeutral ? 'text-muted-foreground' : 'text-destructive'}`}
              aria-hidden="true"
            />
          ) : (
            <ArrowUpRight
              className={`size-4 ${isNeutral ? 'text-muted-foreground' : 'text-foreground'}`}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-tight">
            {row.kindLabel}
            {' · '}
            {row.methodLabel}
          </p>
          <p className="text-xs text-muted-foreground font-mono truncate max-w-[16rem]">
            {row.reference}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {row.paidAt.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      </div>

      {/* Right: amount + badge + reverse */}
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span
          className={[
            'text-sm font-semibold tabular-nums tracking-tight',
            isNeutral
              ? 'text-muted-foreground line-through'
              : isCredit
              ? 'text-destructive'
              : 'text-foreground',
          ].join(' ')}
        >
          {isCredit ? '−' : '+'}{row.amountFormatted}
        </span>
        <PaymentStatusBadge row={row} />
        {row.canReverse && (
          <Button
            id={`payment-reverse-${row.paymentId.slice(0, 8)}`}
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onReverse(row.paymentId)}
            disabled={reversing}
            className="text-xs h-6 px-2"
          >
            <RotateCcw className="size-3 mr-1" aria-hidden="true" />
            Reverse
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Payment history list ─────────────────────────────────────────────────────

export interface PaymentHistoryPanelProps {
  history: PaymentHistoryView;
  onReverse: (paymentId: string) => Promise<void>;
  reversing: boolean;
  reverseError: string | null;
}

export function PaymentHistoryPanel({
  history,
  onReverse,
  reversing,
  reverseError,
}: PaymentHistoryPanelProps) {
  return (
    <Card className="shadow-md" id="payment-history-panel">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base tracking-tight flex items-center gap-2">
          <CreditCard className="size-4" aria-hidden="true" />
          Payment History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {history.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No payments recorded yet.
          </p>
        ) : (
          <div>
            {reverseError && (
              <div
                id="payment-reverse-error"
                className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3 mb-3"
              >
                <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{reverseError}</span>
              </div>
            )}
            {history.rows.map((row) => (
              <PaymentRow
                key={row.paymentId}
                row={row}
                onReverse={onReverse}
                reversing={reversing}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
