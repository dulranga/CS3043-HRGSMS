import { BadgeCheck, Ban, ShieldAlert, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatLkr } from "@/lib/money";
import {
  MAX_VOID_REASON_LENGTH,
  ServiceUsageRecord,
  UsageFailure,
  UsageLineOption,
  VoidCapabilities,
  VoidDraft,
  VoidDraftValidation,
  VoidResult,
  attributionLabel,
  describeVoidDenial,
  describeVoidFailure,
  voidRowState,
} from "@/lib/serviceUsageViewModel";

/**
 * Everything the usage table needs to offer M3-S11's void. It is passed as one
 * object so the optional wiring stays explicit: without it the table renders no
 * void control at all, and with it the panel cannot omit the confirmation step.
 */
export interface UsageVoidWiring {
  capabilities: VoidCapabilities;
  draft: VoidDraft;
  errors: VoidDraftValidation['errors'];
  isVoiding: boolean;
  failure: UsageFailure | null;
  result: VoidResult | null;
  onSelect: (usageId: string) => void;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function VoidPermissionBanner({ capabilities }: { capabilities: VoidCapabilities }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-xl border-2 border-border bg-card p-3 text-sm text-foreground"
    >
      <ShieldAlert className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      {capabilities.canVoid
        ? 'Void authority active. A void is an auditable reversal: the original charge stays on the record and stops being billed.'
        : describeVoidDenial(capabilities.role)}
    </p>
  );
}

export function VoidFailureNotice({ failure }: { failure: UsageFailure }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border-2 border-destructive bg-card p-3 text-sm text-destructive"
    >
      <Ban className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{describeVoidFailure(failure)}</span>
    </div>
  );
}

/**
 * FR-048/FR-058: the confirmation states exactly what a void does, so nobody
 * expects a deletion. It names the retained original row, the audit record, the
 * effect on the billable subtotal and the FINAL-invoice limit.
 */
export function VoidConfirmation({
  record,
  lines,
  wiring,
}: {
  record: ServiceUsageRecord;
  lines: UsageLineOption[];
  wiring: UsageVoidWiring;
}) {
  return (
    <Card className="border-2 border-destructive shadow-md">
      <CardHeader className="p-4 md:p-5">
        <CardTitle className="flex items-center gap-2 text-lg tracking-tight text-destructive">
          <Undo2 className="size-5" aria-hidden="true" />
          Confirm void of this charge
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 md:p-5 pt-0 space-y-3">
        <div className="rounded-xl border-2 border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium tracking-tight">{record.serviceName}</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground md:grid-cols-4">
            <div>
              <dt className="inline">Attribution: </dt>
              <dd className="inline">{attributionLabel(record, lines)}</dd>
            </div>
            <div>
              <dt className="inline">Quantity: </dt>
              <dd className="inline">{record.quantity}</dd>
            </div>
            <div>
              <dt className="inline">Snapshot: </dt>
              <dd className="inline">{formatLkr(record.unitPriceSnapshot)}</dd>
            </div>
            <div>
              <dt className="inline">Reversal: </dt>
              <dd className="inline font-medium text-foreground">{formatLkr(record.amount)}</dd>
            </div>
          </dl>
        </div>

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground tracking-tight">
          <li>The original row, its price snapshot, quantity and recording actor are retained, not deleted.</li>
          <li>
            The row is marked VOIDED, leaves the billable subtotal and is excluded from future charges.
          </li>
          <li>An audit record stores your name, the server time and the reason below.</li>
          <li>
            A FINAL invoice cannot be voided here; that correction is escalated to management, never reopened
            silently.
          </li>
          <li>A charge can only be voided once. A second attempt is refused.</li>
        </ul>

        <div className="space-y-1.5">
          <Label htmlFor="usage-void-reason">Reason (optional)</Label>
          <Input
            id="usage-void-reason"
            value={wiring.draft.reason}
            placeholder="e.g. Wrong room charged"
            aria-invalid={Boolean(wiring.errors.reason)}
            disabled={wiring.isVoiding}
            onChange={(event) => wiring.onReasonChange(event.target.value)}
          />
          {wiring.errors.reason ? (
            <p className="text-xs text-destructive">{wiring.errors.reason}</p>
          ) : (
            <p className="text-xs text-muted-foreground tracking-tight">
              Stored on the audit row for up to {MAX_VOID_REASON_LENGTH} characters.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={wiring.isVoiding}
            onClick={wiring.onConfirm}
          >
            {wiring.isVoiding ? 'Voiding…' : 'Confirm void'}
          </Button>
          <Button type="button" variant="outline" disabled={wiring.isVoiding} onClick={wiring.onCancel}>
            Keep the charge
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function VoidOutcome({ result }: { result: VoidResult }) {
  const billing = result.billing;

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border-2 border-border bg-card p-3 text-sm text-foreground"
    >
      <BadgeCheck className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>
          Void recorded. {formatLkr(result.voidedAmount)} was reversed and the original charge is retained as
          VOIDED.
        </p>
        {billing ? (
          <p className="text-xs text-muted-foreground tracking-tight">
            Booking total {formatLkr(billing.totalAmount)} · outstanding balance{' '}
            {formatLkr(billing.balance)}
            {billing.isCredit
              ? ` · ${formatLkr(billing.creditAmount)} credit to settle by refund`
              : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The per-row control. A voided row shows no action at all because FR-048 keeps
 * it as history, and a forbidden role sees a disabled control with the reason
 * rather than an unexplained dead button.
 */
export function VoidRowAction({
  record,
  wiring,
}: {
  record: ServiceUsageRecord;
  wiring: UsageVoidWiring;
}) {
  const state = voidRowState(record, wiring.capabilities);

  if (record.voided) {
    return <Badge variant="outline-destructive">REVERSED</Badge>;
  }

  if (!state.canVoid) {
    return (
      <span className="flex flex-col items-start gap-1">
        <Button type="button" size="sm" variant="outline" disabled>
          Void
        </Button>
        <span className="text-xs text-muted-foreground tracking-tight">{state.reason}</span>
      </span>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={wiring.isVoiding}
      onClick={() => wiring.onSelect(record.usageId)}
    >
      Void
    </Button>
  );
}