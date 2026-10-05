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
  UsageRole,
  applyRecordedUsage,
  describeSupportFailure,
  describeUsageFailure,
  emptyUsageDraft,
  isUsageAccessDenial,
  parseRecordedUsage,
  parseUsageFailure,
  parseUsageList,
  resolveUsageCapabilities,
  usageAvailability,
  usageRequestPath,
  validateUsageDraft,
} from "@/lib/serviceUsageViewModel";

const API_BASE = "http://localhost:4000/api";
const ACTIVE_STAY_PATH = (bookingRef: string) => `/stays/${encodeURIComponent(bookingRef.trim())}`;

/**
 * M1-S08/M1-S09 session middleware is not mounted, so no authenticated
 * "who am I" endpoint exists and the screen must not guess one. Until Member 1
 * ships it, the actor resolves as unknown and usage stays read-only; a
 * development-only preview exercises the recording roles locally and compiles
 * out of production builds.
 */
function resolveSessionRole(): UsageRole | null {
  return null;
}

export default function ServiceUsagePage() {
  const [role, setRole] = useState<UsageRole | null>(resolveSessionRole());
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

  const capabilities = useMemo(() => resolveUsageCapabilities(role), [role]);

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

  useEffect(() => {
    setRecords([]);
    setLines([]);
    setLoadedRef('');
    setSupportFailures([]);
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

            {import.meta.env.DEV ? (
              <Card className="border-dashed shadow-none">
                <CardHeader className="p-4">
                  <CardTitle className="text-sm tracking-tight">
                    Development preview — recording-role states
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={role === null ? 'default' : 'outline'}
                      aria-pressed={role === null}
                      onClick={() => setRole(null)}
                    >
                      Unknown actor (read-only)
                    </Button>
                    {(['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'] as UsageRole[]).map(
                      (seeded) => (
                        <Button
                          key={seeded}
                          size="sm"
                          variant={role === seeded ? 'default' : 'outline'}
                          aria-pressed={role === seeded}
                          onClick={() => setRole(seeded)}
                        >
                          {seeded}
                        </Button>
                      ),
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground tracking-tight">
                    Removed from production builds. Replace with the M1-S08/M1-S09 session role once
                    authentication middleware is mounted.
                  </p>
                </CardContent>
              </Card>
            ) : null}

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
                {describeUsageFailure(denied)}
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