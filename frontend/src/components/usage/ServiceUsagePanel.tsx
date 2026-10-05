import { Ban, ConciergeBell, Receipt, TriangleAlert, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatLkr } from "@/lib/money";
import {
  UNALLOCATED_LABEL,
  UsageCapabilities,
  UsageDraft,
  UsageDraftValidation,
  UsageFailure,
  UsageLineOption,
  ServiceUsageRecord,
  attributionLabel,
  describeUsageDenial,
  describeUsageFailure,
  usageAvailability,
  usageTotals,
} from "@/lib/serviceUsageViewModel";
import {
  UsageVoidWiring,
  VoidConfirmation,
  VoidFailureNotice,
  VoidOutcome,
  VoidPermissionBanner,
  VoidRowAction,
} from "@/components/usage/ServiceUsageVoidPanel";

const USAGE_TABLE_WRAPPER_CLASS = "w-full overflow-x-auto";
const USAGE_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 gap-4";

interface ServiceOption {
  serviceId: string;
  name: string;
  category: string;
  currentPrice: string;
}

export function UsagePermissionBanner({
  capabilities,
  checkedInLines,
}: {
  capabilities: UsageCapabilities;
  checkedInLines: UsageLineOption[];
}) {
  const availability = usageAvailability(checkedInLines);

  if (!capabilities.canRecord) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-xl border-2 border-border bg-card p-3 text-sm text-foreground"
      >
        <Ban className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
        {capabilities.denial}
      </p>
    );
  }

  if (!availability.canRecord) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-xl border-2 border-destructive bg-card p-3 text-sm text-destructive"
      >
        <TriangleAlert className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
        {availability.reason}
      </p>
    );
  }

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-xl border-2 border-border bg-card p-3 text-sm text-foreground"
    >
      <ConciergeBell className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      Recording access: {checkedInLines.length} checked-in room
      {checkedInLines.length === 1 ? '' : 's'} available for attribution.
    </p>
  );
}

export function UsageWriteFailure({ failure }: { failure: UsageFailure }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border-2 border-destructive bg-card p-3 text-sm text-destructive"
    >
      <TriangleAlert className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{describeUsageFailure(failure)}</span>
    </div>
  );
}

interface RecordUsageFormProps {
  capabilities: UsageCapabilities;
  checkedInLines: UsageLineOption[];
  services: ServiceOption[];
  draft: UsageDraft;
  errors: UsageDraftValidation['errors'];
  isSaving: boolean;
  onChange: (draft: UsageDraft) => void;
  onSubmit: () => void;
}

function RecordUsageForm({
  capabilities,
  checkedInLines,
  services,
  draft,
  errors,
  isSaving,
  onChange,
  onSubmit,
}: RecordUsageFormProps) {
  const availability = usageAvailability(checkedInLines);
  const disabled = !capabilities.canRecord || !availability.canRecord || isSaving;

  return (
    <Card className="shadow-md">
      <CardHeader className="p-4 md:p-5">
        <CardTitle className="text-lg tracking-tight">Record service usage</CardTitle>
      </CardHeader>
      <CardContent className="p-4 md:p-5 pt-0 space-y-4">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="usage-service">Service</Label>
              <div className="flex flex-col gap-1.5" role="group" aria-labelledby="usage-service">
                {services.length === 0 ? (
                  <p className="text-xs text-muted-foreground tracking-tight">
                    No active services are available in the catalogue.
                  </p>
                ) : (
                  services.map((service) => (
                    <Button
                      key={service.serviceId}
                      type="button"
                      size="sm"
                      variant={draft.serviceId === service.serviceId ? "default" : "outline"}
                      aria-pressed={draft.serviceId === service.serviceId}
                      disabled={disabled}
                      onClick={() => onChange({ ...draft, serviceId: service.serviceId })}
                    >
                      {service.name} · {formatLkr(service.currentPrice)}
                    </Button>
                  ))
                )}
              </div>
              {errors.serviceId ? <p className="text-xs text-destructive">{errors.serviceId}</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="usage-quantity">Quantity</Label>
              <Input
                id="usage-quantity"
                value={draft.quantity}
                disabled={disabled}
                onChange={(event) => onChange({ ...draft, quantity: event.target.value })}
                aria-invalid={Boolean(errors.quantity)}
              />
              {errors.quantity ? <p className="text-xs text-destructive">{errors.quantity}</p> : null}
              <p className="text-xs text-muted-foreground tracking-tight">
                The unit price is taken from the catalogue by the server, so it cannot be overridden
                here.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="usage-used-at">Used at (optional)</Label>
              <Input
                id="usage-used-at"
                type="datetime-local"
                value={draft.usedAt}
                disabled={disabled}
                onChange={(event) => onChange({ ...draft, usedAt: event.target.value })}
                aria-invalid={Boolean(errors.usedAt)}
              />
              {errors.usedAt ? <p className="text-xs text-destructive">{errors.usedAt}</p> : null}
              <p className="text-xs text-muted-foreground tracking-tight">
                Leave blank to record the moment of entry. A back-dated time must fall inside the
                occupied assignment period for the line.
              </p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none tracking-tight text-foreground">
              Attribution
            </legend>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={draft.attribution === 'BOOKING_WIDE' ? "default" : "outline"}
                aria-pressed={draft.attribution === 'BOOKING_WIDE'}
                disabled={disabled}
                onClick={() => onChange({ ...draft, attribution: 'BOOKING_WIDE' })}
              >
                {UNALLOCATED_LABEL}
              </Button>
              {checkedInLines.map((line) => (
                <Button
                  key={line.lineId}
                  type="button"
                  size="sm"
                  variant={
                    draft.attribution === 'ROOM_LINE' && draft.lineId === line.lineId ? "default" : "outline"
                  }
                  aria-pressed={draft.attribution === 'ROOM_LINE' && draft.lineId === line.lineId}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ ...draft, attribution: 'ROOM_LINE', lineId: line.lineId })
                  }
                >
                  Room {line.roomNumber ?? line.lineId}
                </Button>
              ))}
            </div>
            {errors.lineId ? <p className="text-xs text-destructive">{errors.lineId}</p> : null}
            <p className="text-xs text-muted-foreground tracking-tight">
              Booking-wide usage carries no room line and is always reported as unallocated, so it is
              never spread across the rooms of a multi-room booking.
            </p>
          </fieldset>

          <Button type="submit" disabled={disabled}>
            {isSaving ? 'Recording…' : 'Record usage'}
          </Button>
        </form>

        {capabilities.canRecord ? null : (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground tracking-tight">
            <Ban className="size-4 shrink-0" aria-hidden="true" />
            {describeUsageDenial(capabilities.role)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface UsageRowProps {
  record: ServiceUsageRecord;
  lines: UsageLineOption[];
  voidWiring?: UsageVoidWiring;
}

function UsageRow({ record, lines, voidWiring }: UsageRowProps) {
  const unallocated = !record.bookingRoomLineId;

  return (
    <tr
      className={
        record.voided
          ? "border-b border-border last:border-0 opacity-60"
          : "border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
      }
    >
      <td className="py-2 px-3 font-medium whitespace-nowrap">
        <span className="flex items-center gap-1.5">
          <Receipt className="size-4" aria-hidden="true" />
          {record.serviceName}
        </span>
      </td>
      <td className="py-2 px-3 whitespace-nowrap">
        {unallocated ? (
          <Badge variant="outline">{UNALLOCATED_LABEL}</Badge>
        ) : (
          <Badge>
            <UserRound className="size-3" aria-hidden="true" />
            {attributionLabel(record, lines)}
          </Badge>
        )}
      </td>
      <td className="py-2 px-3 text-right whitespace-nowrap">{record.quantity}</td>
      <td className="py-2 px-3 text-right whitespace-nowrap">{formatLkr(record.unitPriceSnapshot)}</td>
      <td className="py-2 px-3 text-right whitespace-nowrap font-medium">
        {formatLkr(record.amount)}
      </td>
      <td className="py-2 px-3 whitespace-nowrap">
        {record.voided ? (
          <Badge variant="outline-destructive">VOIDED</Badge>
        ) : (
          <Badge variant="secondary">BILLABLE</Badge>
        )}
        {record.voided && record.voidedAt ? (
          <p className="mt-1 text-xs text-muted-foreground tracking-tight">
            Reversed {record.voidedAt}
            {record.voidedBy ? ` by ${record.voidedBy}` : ''}
          </p>
        ) : null}
      </td>
      {voidWiring ? (
        <td className="py-2 px-3 whitespace-nowrap">
          <VoidRowAction record={record} wiring={voidWiring} />
        </td>
      ) : null}
    </tr>
  );
}

interface ServiceUsagePanelProps {
  records: ServiceUsageRecord[];
  lines: UsageLineOption[];
  capabilities: UsageCapabilities;
  services: ServiceOption[];
  draft: UsageDraft;
  errors: UsageDraftValidation['errors'];
  isSaving: boolean;
  writeFailure: UsageFailure | null;
  /**
   * M3-S16's void workflow. Omitted when voiding is not offered, in which case
   * no void control, column or confirmation appears at all.
   */
  voidWiring?: UsageVoidWiring;
  onDraftChange: (draft: UsageDraft) => void;
  onSubmit: () => void;
}

export function ServiceUsagePanel({
  records,
  lines,
  capabilities,
  services,
  draft,
  errors,
  isSaving,
  writeFailure,
  voidWiring,
  onDraftChange,
  onSubmit,
}: ServiceUsagePanelProps) {
  const totals = usageTotals(records);
  const voidTarget = voidWiring
    ? records.find((record) => record.usageId === voidWiring.draft.usageId) ?? null
    : null;

  return (
    <div className="space-y-6">
      <UsagePermissionBanner capabilities={capabilities} checkedInLines={lines} />
      {writeFailure ? <UsageWriteFailure failure={writeFailure} /> : null}
      {voidWiring ? <VoidPermissionBanner capabilities={voidWiring.capabilities} /> : null}
      {voidWiring?.result ? <VoidOutcome result={voidWiring.result} /> : null}
      {voidWiring?.failure ? <VoidFailureNotice failure={voidWiring.failure} /> : null}

      <RecordUsageForm
        capabilities={capabilities}
        checkedInLines={lines}
        services={services}
        draft={draft}
        errors={errors}
        isSaving={isSaving}
        onChange={onDraftChange}
        onSubmit={onSubmit}
      />

      <div className={USAGE_GRID_CLASS}>
        <Card className="shadow-md">
          <CardHeader className="p-4">
            <CardTitle className="text-base tracking-tight">Billable subtotal</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1">
            <p className="text-2xl font-bold tracking-tight">{formatLkr(totals.subtotal)}</p>
            <p className="text-xs text-muted-foreground tracking-tight">
              {totals.count} recorded · {totals.voidedCount} voided and excluded ·{' '}
              {totals.unallocatedCount} unallocated
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-md">
          <CardHeader className="p-4">
            <CardTitle className="text-base tracking-tight">Price snapshots</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1">
            <p className="text-sm text-foreground tracking-tight">
              Each row keeps the catalogue price captured when it was recorded.
            </p>
            <p className="text-xs text-muted-foreground tracking-tight">
              A later catalogue price change never alters a charge that already exists.
            </p>
          </CardContent>
        </Card>
      </div>

      {voidWiring && voidTarget ? (
        <VoidConfirmation record={voidTarget} lines={lines} wiring={voidWiring} />
      ) : null}

      <div className={USAGE_TABLE_WRAPPER_CLASS}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-border text-left">
              <th className="py-2 px-3 font-semibold tracking-tight">Service</th>
              <th className="py-2 px-3 font-semibold tracking-tight">Attribution</th>
              <th className="py-2 px-3 font-semibold tracking-tight text-right">Quantity</th>
              <th className="py-2 px-3 font-semibold tracking-tight text-right">Unit price snapshot</th>
              <th className="py-2 px-3 font-semibold tracking-tight text-right">Amount</th>
              <th className="py-2 px-3 font-semibold tracking-tight">State</th>
              {voidWiring ? (
                <th className="py-2 px-3 font-semibold tracking-tight">Void</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={voidWiring ? 7 : 6} className="py-4 px-3 text-center text-muted-foreground">
                  No service usage has been recorded for this booking.
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <UsageRow key={record.usageId} record={record} lines={lines} voidWiring={voidWiring} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}