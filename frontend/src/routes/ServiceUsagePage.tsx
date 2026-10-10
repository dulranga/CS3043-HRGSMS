import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ServiceUsagePanel } from "@/components/usage/ServiceUsagePanel";
import { parseActiveStays } from "@/lib/activeStayViewModel";
import {
  SERVICE_CATALOGUE_BASE,
  activeFilterQuery,
  parseServiceList,
} from "@/lib/serviceCatalogueViewModel";
import {
  ServiceUsageRecord,
  UsageDraft,
  UsageFailure,
  UsageLineOption,
  VoidDraft,
  applyRecordedUsage,
  applyVoidedUsage,
  describeListDenial,
  describeSupportFailure,
  describeUsageFailure,
  emptyUsageDraft,
  emptyVoidDraft,
  isUsageAccessDenial,
  isVoidRepeat,
  parseRecordedUsage,
  parseUsageFailure,
  parseUsageList,
  parseVoidResult,
  resolveUsageCapabilities,
  resolveVoidCapabilities,
  usageAvailability,
  usageRequestPath,
  validateUsageDraft,
  validateVoidDraft,
  voidRequestPath,
} from "@/lib/serviceUsageViewModel";

const API_BASE = "/api";
const ACTIVE_STAY_PATH = (bookingRef: string) => `/stays/${encodeURIComponent(bookingRef.trim())}`;


export default function ServiceUsagePage() {
  const role = useFeatureSessions().role;
  const [bookingRef, setBookingRef] = useState<string>('');
  const [loadedRef, setLoadedRef] = useState<string>('');
  const [records, setRecords] = useState<ServiceUsageRecord[]>([]);
  const [lines, setLines] = useState<UsageLineOption[]>([]);
  const [services, setServices] = useState<
    Array<{ serviceId: string; name: string; category: string; currentPrice: string }>
  >([]);
  const [draft, setDraft] = useState<UsageDraft>(emptyUsageDraft());
  const [draftErrors, setDraftErrors] = useState<{
    serviceId?: string;
    quantity?: string;
    lineId?: string;
    usedAt?: string;
  }>({});
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadFailure, setLoadFailure] = useState<UsageFailure | null>(null);
  const [supportFailures, setSupportFailures] = useState<string[]>([]);
  const [denied, setDenied] = useState<UsageFailure | null>(null);
  const [writeFailure, setWriteFailure] = useState<UsageFailure | null>(null);
  const [voidDraft, setVoidDraft] = useState<VoidDraft>(emptyVoidDraft());
  const [voidErrors, setVoidErrors] = useState<{ usageId?: string; reason?: string }>({});
  const [isVoiding, setIsVoiding] = useState<boolean>(false);
  const [voidFailure, setVoidFailure] = useState<UsageFailure | null>(null);
  const [voidResult, setVoidResult] = useState<ReturnType<typeof parseVoidResult>>(null);

  const capabilities = useMemo(() => resolveUsageCapabilities(role), [role]);
  const voidCapabilities = useMemo(() => resolveVoidCapabilities(role), [role]);

  const load = useCallback(async (reference: string) => {
    setLoading(true);
    setLoadFailure(null);
    setDenied(null);
    setSupportFailures([]);

    try {
      // M3-S08's read is the authority for which lines are actually occupied,
      // so only those lines may be chosen as FR-044 room attribution.
      const [usageResult, stayResult, catalogueResult] = await Promise.all([
        fetch(`${API_BASE}${usageRequestPath(reference)}`),
        fetch(`${API_BASE}${ACTIVE_STAY_PATH(reference)}`),
        fetch(`${API_BASE}${SERVICE_CATALOGUE_BASE}${activeFilterQuery('active')}`),
      ]);

      const usagePayload = await usageResult.json().catch(() => null);
      const stayPayload = await stayResult.json().catch(() => null);
      const cataloguePayload = await catalogueResult.json().catch(() => null);

      if (!usageResult.ok) {
        const failure = parseUsageFailure(usageResult.status, usagePayload);
        setRecords([]);
        setSupportFailures([]);
        if (isUsageAccessDenial(failure)) {
          setDenied(failure);
        } else {
          setLoadFailure(failure);
        }
        return;
      }

      // A failed supporting read must not look like an empty result: an
      // unmounted or denied catalogue would otherwise appear as "no service can
      // be selected" with no explanation.
      setSupportFailures(
        [
          !stayResult.ok ? ('CHECKED_IN_LINES' as const) : null,
          !catalogueResult.ok ? ('SERVICE_CATALOGUE' as const) : null,
        ].filter((kind): kind is 'CHECKED_IN_LINES' | 'SERVICE_CATALOGUE' => kind !== null)
          .map((kind) =>
            describeSupportFailure(
              kind,
              parseUsageFailure(kind === 'CHECKED_IN_LINES' ? stayResult.status : catalogueResult.status,
                kind === 'CHECKED_IN_LINES' ? stayPayload : cataloguePayload),
            ),
          ),
      );

      setRecords(parseUsageList(usagePayload));
      setLines(
        parseActiveStays(stayPayload).map((stay) => ({
          lineId: stay.line_id,
          roomNumber: stay.room_number,
        })),
      );
      setServices(
        parseServiceList(cataloguePayload)
          .filter((service) => service.active)
          .map((service) => ({
            serviceId: service.serviceId,
            name: service.name,
            category: service.category,
            currentPrice: service.currentPrice,
          })),
      );
      setLoadedRef(reference);
    } catch {
      setRecords([]);
      setSupportFailures([]);
      setLoadFailure({
        status: 0,
        code: 'USAGE_READ_FAILED',
        message: 'Unable to reach the service-usage API.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLoad = useCallback(() => {
    const trimmed = bookingRef.trim();
    if (!trimmed) {
      setRecords([]);
      setSupportFailures([]);
      setLoadFailure({
        status: 400,
        code: 'INVALID_SERVICE_USAGE_INPUT',
        message: 'Enter a booking reference or booking UUID.',
      });
      return;
    }
    void load(trimmed);
  }, [bookingRef, load]);

  const handleSubmit = useCallback(async () => {
    const validation = validateUsageDraft(draft, lines);
    setDraftErrors(validation.errors);
    if (!validation.valid || !capabilities.canRecord || !loadedRef) {
      return;
    }

    // The form is disabled without a checked-in line, but FR-044 is also
    // re-checked here so a stale render can never send a booking-wide charge
    // that the server would have to reject.
    const availability = usageAvailability(lines);
    if (!availability.canRecord) {
      setWriteFailure({ status: 0, code: 'USAGE_CONFLICT', message: availability.reason ?? '' });
      return;
    }

    setIsSaving(true);
    setWriteFailure(null);

    try {
      const response = await fetch(`${API_BASE}${usageRequestPath(loadedRef)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validation.payload),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setWriteFailure(parseUsageFailure(response.status, payload));
        return;
      }

      const created = parseRecordedUsage(payload);
      if (created) {
        setRecords((current) => applyRecordedUsage(current, created));
        setDraft({ ...emptyUsageDraft(), serviceId: draft.serviceId });
        setDraftErrors({});
      }
    } catch {
      setWriteFailure({
        status: 0,
        code: 'USAGE_REJECTED',
        message: 'Unable to reach the service-usage API.',
      });
    } finally {
      setIsSaving(false);
    }
  }, [capabilities.canRecord, draft, lines, loadedRef]);

  const handleVoidSelect = useCallback((usageId: string) => {
    setVoidDraft({ usageId, reason: '' });
    setVoidErrors({});
    setVoidFailure(null);
    setVoidResult(null);
  }, []);

  const handleVoidReasonChange = useCallback((reason: string) => {
    setVoidDraft((current) => ({ ...current, reason }));
  }, []);

  const handleVoidCancel = useCallback(() => {
    setVoidDraft(emptyVoidDraft());
    setVoidErrors({});
  }, []);

  const handleVoidConfirm = useCallback(async () => {
    const validation = validateVoidDraft(voidDraft);
    setVoidErrors(validation.errors);
    if (!validation.valid || !voidCapabilities.canVoid || !loadedRef) {
      return;
    }

    // FR-048 allows one reversal per charge. The disabled control and the
    // server's USAGE_ALREADY_VOIDED already cover this, so a stale render is
    // also refused locally instead of sending a request the server must reject.
    const target = records.find((record) => record.usageId === voidDraft.usageId);
    if (!target || target.voided) {
      setVoidFailure({
        status: 0,
        code: 'USAGE_ALREADY_VOIDED',
        message: 'This charge was already voided, so it cannot be voided again.',
      });
      return;
    }

    setIsVoiding(true);
    setVoidFailure(null);

    try {
      const response = await fetch(`${API_BASE}${voidRequestPath(loadedRef, voidDraft.usageId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validation.payload),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const failure = parseUsageFailure(response.status, payload);
        setVoidFailure(failure);
        // Someone else may have reversed the charge already, so re-read the
        // list and show the retained row instead of a stale local guess.
        if (isVoidRepeat(failure)) {
          await load(loadedRef);
        }
        return;
      }

      const result = parseVoidResult(payload);
      if (result) {
        setRecords((current) => applyVoidedUsage(current, result));
        setVoidResult(result);
        setVoidDraft(emptyVoidDraft());
        setVoidErrors({});
      } else {
        setVoidFailure({
          status: 0,
          code: 'VOID_REJECTED',
          message: 'The server confirmed the void without a readable reversal record.',
        });
      }
    } catch {
      setVoidFailure({
        status: 0,
        code: 'VOID_REJECTED',
        message: 'Unable to reach the service-usage API.',
      });
    } finally {
      setIsVoiding(false);
    }
  }, [loadedRef, load, records, voidCapabilities.canVoid, voidDraft]);

  useEffect(() => {
    setRecords([]);
    setLines([]);
    setLoadedRef('');
    setSupportFailures([]);
    setVoidDraft(emptyVoidDraft());
    setVoidErrors({});
    setVoidFailure(null);
    setVoidResult(null);
  }, [bookingRef]);

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Service Usage</h1>
              <p className="text-sm text-muted-foreground">
                Record service charges against a stay. Each charge keeps the catalogue price captured
                at the moment it was recorded, and booking-wide charges stay unallocated.
              </p>
            </header>

            <Card className="shadow-md">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="text-lg tracking-tight">Find a booking</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5 pt-0 space-y-3">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="usage-booking-ref">Booking reference or UUID</Label>
                    <Input
                      id="usage-booking-ref"
                      value={bookingRef}
                      placeholder="e.g. BK-2026-0001"
                      onChange={(event) => setBookingRef(event.target.value)}
                    />
                  </div>
                  <Button onClick={handleLoad} disabled={loading}>
                    {loading ? 'Loading…' : 'Load service usage'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground tracking-tight">
                  Usage is scoped to your own branch, and only lines that are currently checked in can
                  take room attribution.
                </p>
              </CardContent>
            </Card>

            {denied ? (
              <p
                role="alert"
                className="rounded-xl border-2 border-destructive bg-card p-3 text-sm text-destructive"
              >
                {describeListDenial(role, voidCapabilities.canVoid)}
              </p>
            ) : null}

            {!denied && loadFailure ? (
              <p
                role="alert"
                className="rounded-xl border-2 border-destructive bg-card p-3 text-sm text-destructive"
              >
                {describeUsageFailure(loadFailure)}
              </p>
            ) : null}

            {loadedRef && !denied && !loadFailure && supportFailures.length > 0 ? (
              <div
                role="alert"
                className="space-y-1 rounded-xl border-2 border-destructive bg-card p-3"
              >
                {supportFailures.map((message) => (
                  <p key={message} className="text-sm text-destructive">
                    {message}
                  </p>
                ))}
              </div>
            ) : null}

            {loadedRef && !denied && !loadFailure ? (
              <section className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{loadedRef}</span>
                <span>{lines.length} checked-in room line{lines.length === 1 ? '' : 's'}</span>
              </section>
            ) : null}

            {loadedRef && !denied && !loadFailure ? (
              <ServiceUsagePanel
                records={records}
                lines={lines}
                capabilities={capabilities}
                services={services}
                draft={draft}
                errors={draftErrors}
                isSaving={isSaving}
                writeFailure={writeFailure}
                voidWiring={{
                  capabilities: voidCapabilities,
                  draft: voidDraft,
                  errors: voidErrors,
                  isVoiding,
                  failure: voidFailure,
                  result: voidResult,
                  onSelect: handleVoidSelect,
                  onReasonChange: handleVoidReasonChange,
                  onCancel: handleVoidCancel,
                  onConfirm: () => void handleVoidConfirm(),
                }}
                onDraftChange={setDraft}
                onSubmit={() => void handleSubmit()}
              />
            ) : null}
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}