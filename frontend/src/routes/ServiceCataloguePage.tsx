import { useCallback, useEffect, useMemo, useState } from "react";

import { ServiceCataloguePanel } from "@/components/catalogue/ServiceCataloguePanel";
import { AppShell } from "@/components/layout/AppShell";
import { BoundedContainer } from "@/components/layout/BoundedContainer";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ActiveFilter,
  CatalogueFailure,
  CatalogueRole,
  SEEDED_CATALOGUE_ROLES,
  ServiceDraft,
  ServiceRecord,
  activeFilterQuery,
  applyCreatedService,
  applyUpdatedService,
  describeCatalogueFailure,
  filterByActive,
  parseCatalogueFailure,
  parseServiceList,
  resolveCatalogueCapabilities,
  serviceCollectionPath,
  serviceWritePath,
  validatePrice,
  validateServiceDraft,
} from "@/lib/serviceCatalogueViewModel";

const API_BASE = "http://localhost:4000/api";
const EMPTY_DRAFT: ServiceDraft = { name: "", category: "", price: "" };

/**
 * M1-S08/M1-S09 session middleware is not mounted yet, so there is no
 * authenticated "who am I" endpoint to read a role from. Until Member 1 ships
 * one, the screen resolves an unknown actor and renders read-only; the server
 * remains the authority for every write. The dev-only selector below exists so
 * the six AT-24 permission states can be exercised locally and is compiled out
 * of production builds.
 */
function resolveSessionRole(): CatalogueRole | null {
  return null;
}

export default function ServiceCataloguePage() {
  const [role, setRole] = useState<CatalogueRole | null>(resolveSessionRole());
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [filter, setFilter] = useState<ActiveFilter>("all");
  const [draft, setDraft] = useState<ServiceDraft>(EMPTY_DRAFT);
  const [draftErrors, setDraftErrors] = useState<{ name?: string; category?: string; price?: string }>({});
  const [priceError, setPriceError] = useState<{ serviceId: string; message: string } | null>(null);
  const [savingServiceId, setSavingServiceId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadFailure, setLoadFailure] = useState<CatalogueFailure | null>(null);
  const [writeFailure, setWriteFailure] = useState<CatalogueFailure | null>(null);

  const capabilities = useMemo(() => resolveCatalogueCapabilities(role), [role]);

  const loadServices = useCallback(async (activeFilter: ActiveFilter) => {
    setLoading(true);
    setLoadFailure(null);

    try {
      const response = await fetch(
        `${API_BASE}${serviceCollectionPath()}${activeFilterQuery(activeFilter)}`,
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setServices([]);
        setLoadFailure(parseCatalogueFailure(response.status, payload));
        return;
      }

      setServices(parseServiceList(payload));
    } catch {
      setServices([]);
      setLoadFailure({
        status: 0,
        code: "CATALOGUE_READ_FAILED",
        message: "Unable to reach the service catalogue.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServices(filter);
  }, [filter, loadServices]);

  const handleFilterChange = useCallback((next: ActiveFilter) => {
    setFilter(next);
  }, []);

  const handleCreate = useCallback(async () => {
    const validation = validateServiceDraft(draft);
    setDraftErrors(validation.errors);
    if (!validation.valid || !capabilities.canCreate) {
      return;
    }

    setIsCreating(true);
    setWriteFailure(null);

    try {
      const response = await fetch(`${API_BASE}${serviceWritePath()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.payload),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setWriteFailure(parseCatalogueFailure(response.status, payload));
        return;
      }

      const created = parseServiceList({ services: [payload.service] })[0];
      if (created) {
        setServices((current) => applyCreatedService(current, created));
        setDraft(EMPTY_DRAFT);
        setDraftErrors({});
      }
    } catch {
      setWriteFailure({
        status: 0,
        code: "CATALOGUE_READ_FAILED",
        message: "Unable to reach the service catalogue.",
      });
    } finally {
      setIsCreating(false);
    }
  }, [capabilities.canCreate, draft]);

  const runUpdate = useCallback(
    async (service: ServiceRecord, body: Record<string, unknown>) => {
      if (!capabilities.isChainManager) {
        return;
      }

      setSavingServiceId(service.serviceId);
      setWriteFailure(null);
      setPriceError(null);

      try {
        const response = await fetch(`${API_BASE}${serviceWritePath(service.serviceId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          setWriteFailure(parseCatalogueFailure(response.status, payload));
          return;
        }

        const updated = parseServiceList({ services: [payload.service] })[0];
        if (updated) {
          setServices((current) => applyUpdatedService(current, updated));
        }
      } catch {
        setWriteFailure({
          status: 0,
          code: "CATALOGUE_READ_FAILED",
          message: "Unable to reach the service catalogue.",
        });
      } finally {
        setSavingServiceId(null);
      }
    },
    [capabilities.isChainManager],
  );

  const handleToggleActive = useCallback(
    (service: ServiceRecord, nextActive: boolean) => {
      void runUpdate(service, { active: nextActive });
    },
    [runUpdate],
  );

  const handleEditPrice = useCallback(
    (service: ServiceRecord, nextPrice: string) => {
      const check = validatePrice(nextPrice);
      if (!check.valid) {
        setPriceError({ serviceId: service.serviceId, message: check.error ?? "Invalid price." });
        return;
      }
      void runUpdate(service, { current_price: nextPrice.trim() });
    },
    [runUpdate],
  );

  const visibleServices = useMemo(() => filterByActive(services, filter), [services, filter]);

  return (
    <AppShell>
      <PageContainer>
        <BoundedContainer>
          <div className="space-y-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Service Catalogue</h1>
              <p className="text-sm text-muted-foreground">
                Chain-wide services and current prices. Only a Chain Manager may change this
                catalogue; front desk and service staff record usage against an active stay instead.
              </p>
            </header>

            {import.meta.env.DEV ? (
              <Card className="border-dashed shadow-none">
                <CardHeader className="p-4">
                  <CardTitle className="text-sm tracking-tight">
                    Development preview — AT-24 permission states
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={role === null ? "default" : "outline"}
                      aria-pressed={role === null}
                      onClick={() => setRole(null)}
                    >
                      Unknown actor (read-only)
                    </Button>
                    {SEEDED_CATALOGUE_ROLES.map((seeded) => (
                      <Button
                        key={seeded}
                        size="sm"
                        variant={role === seeded ? "default" : "outline"}
                        aria-pressed={role === seeded}
                        onClick={() => setRole(seeded)}
                      >
                        {seeded}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground tracking-tight">
                    Removed from production builds. Replace with the M1-S08/M1-S09 session role once
                    authentication middleware is mounted.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {loadFailure ? (
              <p
                role="alert"
                className="rounded-xl border-2 border-destructive bg-card p-3 text-sm text-destructive"
              >
                {describeCatalogueFailure(loadFailure)}
              </p>
            ) : null}

            <Button variant="outline" onClick={() => void loadServices(filter)} disabled={loading}>
              {loading ? "Loading…" : "Reload catalogue"}
            </Button>

            <ServiceCataloguePanel
              services={visibleServices}
              capabilities={capabilities}
              filter={filter}
              onFilterChange={handleFilterChange}
              draft={draft}
              draftErrors={draftErrors}
              savingServiceId={savingServiceId}
              isCreating={isCreating}
              writeFailure={writeFailure}
              onDraftChange={setDraft}
              onCreate={() => void handleCreate()}
              onToggleActive={handleToggleActive}
              onEditPrice={handleEditPrice}
            />

            {priceError ? (
              <p role="alert" className="text-sm text-destructive">
                {priceError.message}
              </p>
            ) : null}
          </div>
        </BoundedContainer>
      </PageContainer>
    </AppShell>
  );
}