import { MONEY_PATTERN, formatLkr, toMoneyString } from './money';

export { formatLkr, toMoneyString };

export type CatalogueRole =
  | 'FRONT_DESK'
  | 'SERVICE_STAFF'
  | 'BRANCH_MANAGER'
  | 'CHAIN_MANAGER'
  | 'SYSTEM_ADMINISTRATOR'
  | 'AUDITOR';

export const SEEDED_CATALOGUE_ROLES: ReadonlyArray<CatalogueRole> = [
  'FRONT_DESK',
  'SERVICE_STAFF',
  'BRANCH_MANAGER',
  'CHAIN_MANAGER',
  'SYSTEM_ADMINISTRATOR',
  'AUDITOR',
];

export const CHAIN_MANAGER: CatalogueRole = 'CHAIN_MANAGER';

/** SRS §4.6.1 / AT-24: only CHAIN_MANAGER may change the shared catalogue. */
export const AT24_FORBIDDEN_ROLES: ReadonlyArray<CatalogueRole> = SEEDED_CATALOGUE_ROLES.filter(
  (role) => role !== CHAIN_MANAGER,
);

/** Roles that may record usage against a stay but must never edit prices. */
export const USAGE_RECORDING_ROLES: ReadonlyArray<CatalogueRole> = [
  'FRONT_DESK',
  'SERVICE_STAFF',
];

export interface ServiceRecord {
  serviceId: string;
  name: string;
  category: string;
  /** `numeric(12,2)` on the server, so it arrives as a fixed-point string. */
  currentPrice: string;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CatalogueCapabilities {
  role: CatalogueRole | null;
  isChainManager: boolean;
  canCreate: boolean;
  canEditPrice: boolean;
  canEditActiveState: boolean;
  isUsageRecordingRole: boolean;
  denial: string | null;
}

export interface CatalogueFailure {
  status: number;
  code: string;
  message: string;
}

export interface ServiceDraft {
  name: string;
  category: string;
  price: string;
}

export interface DraftValidation {
  valid: boolean;
  errors: { name?: string; category?: string; price?: string };
  payload: { name: string; category: string; current_price: string };
}

export type ActiveFilter = 'all' | 'active' | 'inactive';

const DENIAL_TEMPLATES: Record<string, string> = {
  create: 'Only a Chain Manager may add a service to the chain-wide catalogue.',
  price: 'Only a Chain Manager may change a service price.',
  active: 'Only a Chain Manager may activate or deactivate a service.',
};

export function resolveCatalogueCapabilities(role: CatalogueRole | null): CatalogueCapabilities {
  const isChainManager = role === CHAIN_MANAGER;
  const denial = isChainManager
    ? null
    : role
      ? 'Only a Chain Manager may change the chain-wide service catalogue.'
      : 'Your role is not a Chain Manager, so catalogue changes are read-only.';

  return {
    role,
    isChainManager,
    canCreate: isChainManager,
    canEditPrice: isChainManager,
    canEditActiveState: isChainManager,
    isUsageRecordingRole: role !== null && USAGE_RECORDING_ROLES.includes(role),
    denial,
  };
}

export function describeCatalogueDenial(role: CatalogueRole | null, action: keyof typeof DENIAL_TEMPLATES): string {
  const base = DENIAL_TEMPLATES[action];
  return role ? `${base} Signed in as ${role}.` : base;
}

function normalizeService(row: Record<string, unknown>): ServiceRecord | null {
  const serviceId = row?.service_id;
  const name = row?.name;
  if (typeof serviceId !== 'string' || typeof name !== 'string') return null;

  return {
    serviceId,
    name,
    category: typeof row.category === 'string' ? row.category : '',
    currentPrice: toMoneyString(row.current_price as string | number),
    active: row.active === true || row.active === 'true',
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

export function parseServiceList(payload: unknown): ServiceRecord[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { services?: unknown[] } | null)?.services)
      ? ((payload as { services: unknown[] }).services as unknown[])
      : [];
  return rows
    .map((row) => normalizeService((row ?? {}) as Record<string, unknown>))
    .filter((record): record is ServiceRecord => record !== null);
}

export function filterByActive(
  services: ServiceRecord[],
  filter: ActiveFilter,
): ServiceRecord[] {
  if (filter === 'active') return services.filter((service) => service.active);
  if (filter === 'inactive') return services.filter((service) => !service.active);
  return services;
}

export function activeFilterQuery(filter: ActiveFilter): string {
  if (filter === 'all') return '';
  return `?active=${filter === 'active' ? 'true' : 'false'}`;
}

/**
 * M3-S05 stores `current_price` as `numeric(12,2)`, so the client keeps the
 * two-decimal scale and rejects values PostgreSQL would have to round.
 */
export function validatePrice(value: string): { valid: boolean; error?: string } {
  const price = value.trim();
  if (!price) return { valid: false, error: 'Service price is required.' };
  if (!MONEY_PATTERN.test(price)) {
    return {
      valid: false,
      error: 'Enter a non-negative price with at most two decimal places.',
    };
  }
  return { valid: true };
}

export function validateServiceDraft(draft: ServiceDraft): DraftValidation {
  const errors: DraftValidation['errors'] = {};
  const name = draft.name.trim();
  const category = draft.category.trim();
  const price = draft.price.trim();

  if (!name) errors.name = 'Service name is required.';
  if (!category) errors.category = 'Service category is required.';

  const priceCheck = validatePrice(price);
  if (!priceCheck.valid) errors.price = priceCheck.error;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    payload: { name, category, current_price: price },
  };
}

export function applyCreatedService(
  services: ServiceRecord[],
  created: ServiceRecord,
): ServiceRecord[] {
  const withoutDuplicate = services.filter((service) => service.serviceId !== created.serviceId);
  return [...withoutDuplicate, created].sort((left, right) => left.name.localeCompare(right.name));
}

export function applyUpdatedService(
  services: ServiceRecord[],
  updated: ServiceRecord,
): ServiceRecord[] {
  return services
    .map((service) => (service.serviceId === updated.serviceId ? updated : service))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * SRS FR-042: the catalogue must hold at least six services including room
 * service, spa, laundry and minibar-related entries.
 */
export function catalogueCompleteness(services: ServiceRecord[]): {
  count: number;
  missing: string[];
  complete: boolean;
} {
  const haystack = services
    .map((service) => `${service.name} ${service.category}`.toLowerCase())
    .join(' ');
  const required = [
    { label: 'room service', pattern: /room\s*service/ },
    { label: 'spa', pattern: /\bspa\b/ },
    { label: 'laundry', pattern: /laundry/ },
    { label: 'minibar-related', pattern: /mini\s*bar|minibar/ },
  ];

  const missing = required.filter((entry) => !entry.pattern.test(haystack)).map((entry) => entry.label);
  return { count: services.length, missing, complete: services.length >= 6 && missing.length === 0 };
}

/**
 * M3-S05's router factory is not mounted yet, so its final mount point is
 * still open. `/services` under the shared `/api` prefix follows the existing
 * `serviceUsageRoutes` convention and is provisional until M1-S08/S09 mount it.
 */
export const SERVICE_CATALOGUE_BASE = '/services';

export function serviceCollectionPath(): string {
  return SERVICE_CATALOGUE_BASE;
}

export function serviceWritePath(serviceId?: string): string {
  return serviceId ? `${SERVICE_CATALOGUE_BASE}/${encodeURIComponent(serviceId)}` : SERVICE_CATALOGUE_BASE;
}

const CATALOGUE_FAILURE_MESSAGES: Record<string, string> = {
  CATALOGUE_FORBIDDEN:
    'Only a Chain Manager may change the chain-wide service catalogue. The server rejected this change.',
  SERVICE_NOT_FOUND: 'That service no longer exists in the catalogue.',
  VALIDATION_ERROR: 'The service could not be saved. Correct the highlighted fields.',
  CATALOGUE_READ_FAILED: 'The service catalogue could not be loaded. Retry the request.',
  UNAUTHENTICATED: 'Sign in with an active staff account to manage the service catalogue.',
};

function codeForStatus(status: number): CatalogueFailure['code'] {
  if (status === 403) return 'CATALOGUE_FORBIDDEN';
  if (status === 404) return 'SERVICE_NOT_FOUND';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  return 'CATALOGUE_READ_FAILED';
}

export function parseCatalogueFailure(status: number, payload: unknown): CatalogueFailure {
  const error = (payload as { error?: unknown } | null)?.error;

  // M3-S05 currently answers with a flat `{ error: "message" }` body, while the
  // other Member 3 endpoints use `{ error: { code, message } }`. Accept both so
  // the UI stays correct whichever envelope is mounted.
  if (typeof error === 'string') {
    return { status, code: codeForStatus(status), message: error };
  }

  const structured = error as { code?: string; message?: string } | null | undefined;
  return {
    status,
    code: structured?.code ?? codeForStatus(status),
    message: structured?.message ?? '',
  };
}

export function describeCatalogueFailure(failure: CatalogueFailure): string {
  // AT-24 always renders the canonical Chain-Manager sentence instead of the
  // server's raw message, which leaks the internal role name.
  if (failure.code === 'CATALOGUE_FORBIDDEN') {
    return CATALOGUE_FAILURE_MESSAGES.CATALOGUE_FORBIDDEN;
  }

  // Validation errors stay verbatim so the message stays field-specific.
  if (failure.code === 'VALIDATION_ERROR' && failure.message) {
    return failure.message;
  }

  return (
    CATALOGUE_FAILURE_MESSAGES[failure.code] ?? CATALOGUE_FAILURE_MESSAGES.CATALOGUE_READ_FAILED
  );
}

export function isChainManagerDenial(failure: CatalogueFailure): boolean {
  return failure.status === 403 || failure.code === 'CATALOGUE_FORBIDDEN';
}