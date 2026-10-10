import { useEffect, useState } from "react";
import { Ban, Sparkles, Tag, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ActiveFilter,
  CatalogueCapabilities,
  CatalogueFailure,
  ServiceDraft,
  ServiceRecord,
  catalogueCompleteness,
  describeCatalogueDenial,
  describeCatalogueFailure,
  formatLkr,
} from "@/lib/serviceCatalogueViewModel";

const SERVICE_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4";
const SERVICE_TABLE_WRAPPER_CLASS = "w-full overflow-x-auto";

interface ServiceRowProps {
  service: ServiceRecord;
  capabilities: CatalogueCapabilities;
  isSaving: boolean;
  onToggleActive: (service: ServiceRecord, nextActive: boolean) => void;
  onEditPrice: (service: ServiceRecord, nextPrice: string) => void;
}

function ServiceRow({ service, capabilities, isSaving, onToggleActive, onEditPrice }: ServiceRowProps) {
  const [priceDraft, setPriceDraft] = useState(service.currentPrice);

  useEffect(() => {
    setPriceDraft(service.currentPrice);
  }, [service.currentPrice]);

  const priceDenial = capabilities.canEditPrice
    ? null
    : describeCatalogueDenial(capabilities.role, 'price');
  const activeDenial = capabilities.canEditActiveState
    ? null
    : describeCatalogueDenial(capabilities.role, 'active');

  return (
    <Card className="shadow-md">
      <CardHeader className="p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg tracking-tight flex items-center gap-2">
            <Sparkles className="size-5" aria-hidden="true" />
            {service.name}
          </CardTitle>
          <Badge variant={service.active ? "default" : "secondary"}>
            {service.active ? "ACTIVE" : "INACTIVE"}
          </Badge>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground tracking-tight">
          <Tag className="size-4" aria-hidden="true" />
          {service.category}
        </p>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <p className="text-sm font-semibold tracking-tight">{formatLkr(service.currentPrice)}</p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`price-${service.serviceId}`} className="text-xs">
              New price (LKR)
            </Label>
            <Input
              id={`price-${service.serviceId}`}
              className="h-9 w-32"
              value={priceDraft}
              disabled={!capabilities.canEditPrice || isSaving}
              onChange={(event) => setPriceDraft(event.target.value)}
              aria-describedby={`price-hint-${service.serviceId}`}
            />
          </div>
          <Button
            size="sm"
            disabled={!capabilities.canEditPrice || isSaving || priceDraft === service.currentPrice}
            onClick={() => onEditPrice(service, priceDraft)}
          >
            Save price
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!capabilities.canEditActiveState || isSaving}
            onClick={() => onToggleActive(service, !service.active)}
          >
            {service.active ? "Deactivate" : "Activate"}
          </Button>
        </div>

        {priceDenial || activeDenial ? (
          <p
            id={`price-hint-${service.serviceId}`}
            className="flex items-start gap-1.5 text-xs text-muted-foreground tracking-tight"
          >
            <Ban className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {[priceDenial, activeDenial].filter(Boolean).join(' ')}
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface CreateServiceFormProps {
  capabilities: CatalogueCapabilities;
  isSaving: boolean;
  draft: ServiceDraft;
  errors: { name?: string; category?: string; price?: string };
  onChange: (draft: ServiceDraft) => void;
  onSubmit: () => void;
}

function CreateServiceForm({
  capabilities,
  isSaving,
  draft,
  errors,
  onChange,
  onSubmit,
}: CreateServiceFormProps) {
  return (
    <Card className="shadow-md">
      <CardHeader className="p-4 md:p-5">
        <CardTitle className="text-lg tracking-tight">Add a service</CardTitle>
      </CardHeader>
      <CardContent className="p-4 md:p-5 pt-0 space-y-3">
        <form
          className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="service-name">Name</Label>
            <Input
              id="service-name"
              value={draft.name}
              disabled={!capabilities.canCreate || isSaving}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service-category">Category</Label>
            <Input
              id="service-category"
              value={draft.category}
              disabled={!capabilities.canCreate || isSaving}
              onChange={(event) => onChange({ ...draft, category: event.target.value })}
              aria-invalid={Boolean(errors.category)}
            />
            {errors.category ? (
              <p className="text-xs text-destructive">{errors.category}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service-price">Price (LKR)</Label>
            <Input
              id="service-price"
              value={draft.price}
              disabled={!capabilities.canCreate || isSaving}
              onChange={(event) => onChange({ ...draft, price: event.target.value })}
              aria-invalid={Boolean(errors.price)}
            />
            {errors.price ? <p className="text-xs text-destructive">{errors.price}</p> : null}
          </div>
          <Button type="submit" disabled={!capabilities.canCreate || isSaving}>
            {isSaving ? "Saving…" : "Add service"}
          </Button>
        </form>

        {!capabilities.canCreate ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground tracking-tight">
            <Ban className="size-4 shrink-0" aria-hidden="true" />
            {describeCatalogueDenial(capabilities.role, 'create')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CataloguePermissionBanner({ capabilities }: { capabilities: CatalogueCapabilities }) {
  if (capabilities.isChainManager) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-xl border-2 border-border bg-card p-3 text-sm text-foreground"
      >
        <Sparkles className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
        Chain Manager access: catalogue, price and active-state changes are enabled.
      </p>
    );
  }

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-xl border-2 border-border bg-card p-3 text-sm text-foreground"
    >
      <Ban className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {capabilities.denial}
        {capabilities.isUsageRecordingRole
          ? ' Front desk and service staff may record service usage for an active stay, but they cannot change catalogue prices.'
          : ''}
      </span>
    </p>
  );
}

export function CatalogueWriteDenied({ failure }: { failure: CatalogueFailure }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border-2 border-destructive bg-card p-3 text-sm text-destructive"
    >
      <TriangleAlert className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{describeCatalogueFailure(failure)}</span>
    </div>
  );
}

export function CatalogueCompletenessNotice({ services }: { services: ServiceRecord[] }) {
  const completeness = catalogueCompleteness(services);

  return (
    <p className="text-xs text-muted-foreground tracking-tight">
      {completeness.complete
        ? `Catalogue holds ${completeness.count} services and covers every required category.`
        : `Catalogue holds ${completeness.count} services. FR-042 requires at least six, including ${
            completeness.missing.length
              ? `missing: ${completeness.missing.join(', ')}`
              : 'more entries'
          }.`}
    </p>
  );
}

interface ServiceCataloguePanelProps {
  services: ServiceRecord[];
  capabilities: CatalogueCapabilities;
  filter: ActiveFilter;
  onFilterChange: (filter: ActiveFilter) => void;
  draft: ServiceDraft;
  draftErrors: { name?: string; category?: string; price?: string };
  savingServiceId: string | null;
  isCreating: boolean;
  writeFailure: CatalogueFailure | null;
  onDraftChange: (draft: ServiceDraft) => void;
  onCreate: () => void;
  onToggleActive: (service: ServiceRecord, nextActive: boolean) => void;
  onEditPrice: (service: ServiceRecord, nextPrice: string) => void;
}

export function ServiceCataloguePanel({
  services,
  capabilities,
  filter,
  onFilterChange,
  draft,
  draftErrors,
  savingServiceId,
  isCreating,
  writeFailure,
  onDraftChange,
  onCreate,
  onToggleActive,
  onEditPrice,
}: ServiceCataloguePanelProps) {
  return (
    <div className="space-y-6">
      <CataloguePermissionBanner capabilities={capabilities} />
      {writeFailure ? <CatalogueWriteDenied failure={writeFailure} /> : null}
      <CreateServiceForm
        capabilities={capabilities}
        isSaving={isCreating}
        draft={draft}
        errors={draftErrors}
        onChange={onDraftChange}
        onSubmit={onCreate}
      />

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'active', 'inactive'] as ActiveFilter[]).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={filter === option ? "default" : "outline"}
            aria-pressed={filter === option}
            onClick={() => onFilterChange(option)}
          >
            {option === 'all'
              ? 'All services'
              : option === 'active'
                ? 'Active only'
                : 'Inactive only'}
          </Button>
        ))}
      </div>

      <div className={SERVICE_TABLE_WRAPPER_CLASS}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-border text-left">
              <th className="py-2 px-3 font-semibold tracking-tight">Service</th>
              <th className="py-2 px-3 font-semibold tracking-tight">Category</th>
              <th className="py-2 px-3 font-semibold tracking-tight text-right">Current price</th>
              <th className="py-2 px-3 font-semibold tracking-tight">Active state</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 px-3 text-center text-muted-foreground">
                  No services match this filter.
                </td>
              </tr>
            ) : (
              services.map((service) => (
                <tr
                  key={service.serviceId}
                  className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors"
                >
                  <td className="py-2 px-3 font-medium whitespace-nowrap">{service.name}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{service.category}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {formatLkr(service.currentPrice)}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {service.active ? 'ACTIVE' : 'INACTIVE'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CatalogueCompletenessNotice services={services} />

      {services.length === 0 ? null : (
        <div className={SERVICE_GRID_CLASS}>
          {services.map((service) => (
            <ServiceRow
              key={service.serviceId}
              service={service}
              capabilities={capabilities}
              isSaving={savingServiceId === service.serviceId}
              onToggleActive={onToggleActive}
              onEditPrice={onEditPrice}
            />
          ))}
        </div>
      )}
    </div>
  );
}