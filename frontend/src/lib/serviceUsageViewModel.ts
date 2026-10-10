import { QUANTITY_PATTERN, formatLkr, multiplyMoney, sumMoney, toMoneyString } from './money';

export type UsageAttribution = 'ROOM_LINE' | 'BOOKING_WIDE';

export type UsageRole = 'FRONT_DESK' | 'SERVICE_STAFF' | 'CHAIN_MANAGER' | 'BRANCH_MANAGER' | 'SYSTEM_ADMINISTRATOR' | 'AUDITOR';

/**
 * SRS §4.6.2 / M3-S10: recording is limited to active own-branch FRONT_DESK and
 * SERVICE_STAFF. Unlike the catalogue, these roles are the *writers*, so they
 * are the only roles this screen enables.
 */
export const USAGE_RECORDING_ROLES: ReadonlyArray<UsageRole> = ['FRONT_DESK', 'SERVICE_STAFF'];

/**
 * SRS §4.6.2 / M3-S11: a void is the auditable reversal of a recorded charge,
 * so only managers may perform one. This is deliberately the inverse of
 * `USAGE_RECORDING_ROLES`: the roles that record a charge can never void it,
 * which is what makes a reversal a separate authority rather than an undo.
 */
export const USAGE_VOID_ROLES: ReadonlyArray<UsageRole> = [
  'BRANCH_MANAGER',
  'CHAIN_MANAGER',
  'SYSTEM_ADMINISTRATOR',
];

/** `audit_log.after_value->>'reason'` is stored as `varchar(255)`. */
export const MAX_VOID_REASON_LENGTH = 255;

export const UNALLOCATED_LABEL = 'Unallocated (booking-wide)';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UsageCapabilities {
  role: UsageRole | null;
  canRecord: boolean;
  denial: string | null;
}

export interface ServiceUsageRecord {
  usageId: string;
  serviceId: string;
  serviceName: string;
  category: string;
  /** `null` means booking-wide usage, which SRS FR-044 requires be shown as unallocated. */
  bookingRoomLineId: string | null;
  usedAt: string;
  /** Exact `numeric(10,2)` text from the server; never recomputed in the client. */
  quantity: string;
  /** Exact `numeric(12,2)` snapshot taken by M3-S09 inside the recording transaction. */
  unitPriceSnapshot: string;
  /** Exact `numeric(12,2)` amount reported by M3-S10's list read. */
  amount: string;
  voided: boolean;
  voidedAt: string | null;
  /** M3-S11's reversal actor, so the retained row can show who reversed it. */
  voidedBy: string | null;
  recordedAt: string | null;
  recordedBy: string | null;
}

/**
 * M3-S11 void authority. `BRANCH_MANAGER` is own-branch only, which the client
 * cannot verify, so the branch decision stays with the server and a refusal is
 * reported as authoritative.
 */
export interface VoidCapabilities {
  role: UsageRole | null;
  canVoid: boolean;
  denial: string | null;
}

export interface VoidDraft {
  usageId: string;
  reason: string;
}

export interface VoidDraftValidation {
  valid: boolean;
  errors: { usageId?: string; reason?: string };
  payload: { reason?: string };
}

export interface VoidBillingOutcome {
  totalAmount: string;
  netPaid: string;
  balance: string;
  isCredit: boolean;
  creditAmount: string;
}

export interface VoidResult {
  usageId: string;
  /** Server-computed `ROUND(quantity * unit_price_snapshot, 2)` for the reversal. */
  voidedAmount: string;
  voidedAt: string;
  voidedBy: string;
  invoiceId: string | null;
  billing: VoidBillingOutcome | null;
}

export interface UsageLineOption {
  lineId: string;
  roomNumber: string | null;
}

export interface UsageDraft {
  serviceId: string;
  quantity: string;
  attribution: UsageAttribution;
  lineId: string;
  usedAt: string;
}

export interface UsageDraftValidation {
  valid: boolean;
  errors: { serviceId?: string; quantity?: string; lineId?: string; usedAt?: string };
  payload: {
    serviceId: string;
    quantity: string;
    bookingRoomLineId?: string;
    usedAt?: string;
  };
}

export interface UsageFailure {
  status: number;
  code: string;
  message: string;
}

export interface UsageTotals {
  count: number;
  voidedCount: number;
  unallocatedCount: number;
  subtotal: string;
}

const EMPTY_DRAFT: UsageDraft = {
  serviceId: '',
  quantity: '1',
  attribution: 'BOOKING_WIDE',
  lineId: '',
  usedAt: '',
};

export function emptyUsageDraft(): UsageDraft {
  return { ...EMPTY_DRAFT };
}

export function resolveUsageCapabilities(role: UsageRole | null): UsageCapabilities {
  const canRecord = role !== null && USAGE_RECORDING_ROLES.includes(role);

  return {
    role,
    canRecord,
    denial: canRecord
      ? null
      : role
        ? 'Only active Front Desk or Service Staff of this branch may record service usage.'
        : 'Your role is not a service-usage recording role, so usage is read-only.',
  };
}

export function describeUsageDenial(role: UsageRole | null): string {
  const base = 'Only active Front Desk or Service Staff of this branch may record service usage.';
  return role ? `${base} Signed in as ${role}.` : base;
}

/**
 * M3-S11's counterpart to `resolveUsageCapabilities`. The two sets are disjoint
 * on purpose: whoever records a charge cannot reverse it.
 */
export function resolveVoidCapabilities(role: UsageRole | null): VoidCapabilities {
  const canVoid = role !== null && USAGE_VOID_ROLES.includes(role);

  return {
    role,
    canVoid,
    denial: canVoid
      ? null
      : role
        ? 'Only an active Branch Manager of this branch, Chain Manager or System Administrator may void service usage.'
        : 'Your role is not a service-usage void authority, so recorded charges are read-only.',
  };
}

export function describeVoidDenial(role: UsageRole | null): string {
  const base =
    'Only an active Branch Manager of this branch, Chain Manager or System Administrator may void service usage.';
  return role ? `${base} Signed in as ${role}.` : base;
}

/**
 * FR-048: the void is a reversal, not a deletion. A row that is already voided
 * keeps its original quantity, snapshot, actor and time, so it stays in the
 * list for reporting and can never be voided a second time.
 */
export function voidRowState(
  record: Pick<ServiceUsageRecord, 'usageId' | 'voided' | 'voidedAt'>,
  capabilities: VoidCapabilities,
): { canVoid: boolean; reason: string | null } {
  if (record.voided) {
    return {
      canVoid: false,
      reason: 'This charge was already voided, so it cannot be voided again. The original row is retained.',
    };
  }
  if (!capabilities.canVoid) {
    return { canVoid: false, reason: capabilities.denial };
  }
  return { canVoid: true, reason: null };
}

/**
 * SRS FR-044: booking-wide usage stays explicitly unallocated, while
 * room-specific usage names the checked-in line so the report can attribute it
 * to a room without multiplying the charge across rooms (FR-069).
 */
export function attributionLabel(
  record: Pick<ServiceUsageRecord, 'bookingRoomLineId'>,
  lines: UsageLineOption[] = [],
): string {
  if (!record.bookingRoomLineId) return UNALLOCATED_LABEL;
  const match = lines.find((line) => line.lineId === record.bookingRoomLineId);
  return match?.roomNumber ? `Room ${match.roomNumber}` : `Room line ${record.bookingRoomLineId}`;
}

export function isUnallocated(record: Pick<ServiceUsageRecord, 'bookingRoomLineId'>): boolean {
  return !record.bookingRoomLineId;
}

/**
 * FR-045: the client never sends a price. M3-S09 reads the active catalogue
 * price inside its own transaction and stores that exact snapshot, so the form
 * has no field that could spoof it.
 */
export function buildUsagePayload(
  draft: UsageDraft,
): Pick<UsageDraftValidation['payload'], 'serviceId' | 'quantity' | 'bookingRoomLineId' | 'usedAt'> {
  const payload: UsageDraftValidation['payload'] = {
    serviceId: draft.serviceId.trim(),
    quantity: draft.quantity.trim(),
  };
  if (draft.attribution === 'ROOM_LINE' && draft.lineId.trim()) {
    payload.bookingRoomLineId = draft.lineId.trim();
  }
  const usedAt = draft.usedAt.trim();
  if (usedAt) {
    payload.usedAt = usedAt;
  }
  return payload;
}

export function validateUsageDraft(
  draft: UsageDraft,
  checkedInLines: UsageLineOption[] = [],
): UsageDraftValidation {
  const errors: UsageDraftValidation['errors'] = {};
  const serviceId = draft.serviceId.trim();
  const quantity = draft.quantity.trim();
  const lineId = draft.lineId.trim();
  const usedAt = draft.usedAt.trim();

  if (!serviceId) {
    errors.serviceId = 'Choose a service from the catalogue.';
  } else if (!UUID_PATTERN.test(serviceId)) {
    errors.serviceId = 'Choose a valid service from the catalogue.';
  }

  if (!quantity) {
    errors.quantity = 'Quantity is required.';
  } else if (!QUANTITY_PATTERN.test(quantity)) {
    errors.quantity = 'Enter a positive quantity with at most two decimal places.';
  } else if (Number(quantity) <= 0) {
    errors.quantity = 'Quantity must be greater than zero.';
  }

  if (draft.attribution === 'ROOM_LINE') {
    if (!lineId) {
      errors.lineId = 'Choose the checked-in room line this service belongs to.';
    } else if (!checkedInLines.some((line) => line.lineId === lineId)) {
      // A line that is not CHECKED_IN can never be valid attribution (FR-044),
      // so the client refuses it instead of relying on a server 409.
      errors.lineId = 'Service usage can only be attributed to a checked-in room line.';
    }
  }

  if (usedAt && Number.isNaN(Date.parse(usedAt))) {
    errors.usedAt = 'Enter a valid usage timestamp.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    payload: buildUsagePayload(draft),
  };
}

/**
 * SRS FR-050: the subtotal sums non-void usage only, exactly, in integer
 * hundredths of a rupee.
 */
export function usageTotals(records: ServiceUsageRecord[]): UsageTotals {
  const billable = records.filter((record) => !record.voided);
  return {
    count: records.length,
    voidedCount: records.length - billable.length,
    unallocatedCount: billable.filter(isUnallocated).length,
    subtotal: sumMoney(billable.map((record) => record.amount)),
  };
}

export function parseUsageList(payload: unknown): ServiceUsageRecord[] {
  const rows = (payload as { usage?: unknown[] } | null)?.usage;
  if (!Array.isArray(rows)) return [];

  const records: ServiceUsageRecord[] = [];
  for (const candidate of rows) {
    const row = (candidate ?? {}) as Record<string, unknown>;
    const usageId = row.usage_id;
    if (typeof usageId !== 'string') continue;

    records.push({
      usageId,
      serviceId: typeof row.service_id === 'string' ? row.service_id : '',
      serviceName: typeof row.service_name === 'string' ? row.service_name : 'Unknown service',
      category: typeof row.category === 'string' ? row.category : '',
      bookingRoomLineId:
        typeof row.booking_room_line_id === 'string' && row.booking_room_line_id ? row.booking_room_line_id : null,
      usedAt: typeof row.used_at === 'string' ? row.used_at : '',
      quantity: toMoneyString(row.quantity as string),
      unitPriceSnapshot: toMoneyString(row.unit_price_snapshot as string),
      amount: toMoneyString(row.amount as string),
      voided: row.voided === true,
      voidedAt: typeof row.voided_at === 'string' ? row.voided_at : null,
      voidedBy: typeof row.voided_by === 'string' ? row.voided_by : null,
      recordedAt: typeof row.recorded_at === 'string' ? row.recorded_at : null,
      recordedBy: typeof row.recorded_by === 'string' ? row.recorded_by : null,
    });
  }
  return records;
}

/**
 * The 201 body from M3-S10 returns a flat usage row rather than the list
 * shape, so it is normalised through the same parser before being merged.
 */
export function parseRecordedUsage(payload: unknown): ServiceUsageRecord | null {
  const row = (payload ?? {}) as Record<string, unknown>;
  const [record] = parseUsageList({
    usage: [
      {
        ...row,
        service_name: row.service_name ?? 'Just recorded',
        used_at: row.used_at ?? row.recorded_at ?? new Date(0).toISOString(),
        amount:
          row.amount ??
          (row.quantity !== undefined && row.unit_price_snapshot !== undefined
            ? multiplyMoney(String(row.quantity), String(row.unit_price_snapshot))
            : '0.00'),
      },
    ],
  });
  return record ?? null;
}

export function applyRecordedUsage(
  records: ServiceUsageRecord[],
  created: ServiceUsageRecord,
): ServiceUsageRecord[] {
  const withoutDuplicate = records.filter((record) => record.usageId !== created.usageId);
  return [...withoutDuplicate, created].sort(compareUsage);
}

export function compareUsage(left: ServiceUsageRecord, right: ServiceUsageRecord): number {
  if (left.usedAt !== right.usedAt) return left.usedAt < right.usedAt ? -1 : 1;
  return left.usageId < right.usageId ? -1 : left.usageId > right.usageId ? 1 : 0;
}

const EMPTY_VOID_DRAFT: VoidDraft = { usageId: '', reason: '' };

export function emptyVoidDraft(): VoidDraft {
  return { ...EMPTY_VOID_DRAFT };
}

/** `POST /api/bookings/:bookingRef/service-usage/:usageId/void` from M3-S11. */
export function voidRequestPath(bookingRef: string, usageId: string): string {
  return `${usageRequestPath(bookingRef)}/${encodeURIComponent(usageId.trim())}/void`;
}

/**
 * The reason is optional: M3-S11 stores it on the audit row, and the reversal
 * itself is server-authorized. Only the length the audit column can hold is
 * enforced here, so a long note is trimmed rather than silently truncated.
 */
export function validateVoidDraft(draft: VoidDraft): VoidDraftValidation {
  const errors: VoidDraftValidation['errors'] = {};
  const usageId = draft.usageId.trim();
  const reason = draft.reason.trim();

  if (!usageId) {
    errors.usageId = 'Choose the recorded charge to void.';
  } else if (!UUID_PATTERN.test(usageId)) {
    errors.usageId = 'Choose a valid recorded charge to void.';
  }
  if (reason.length > MAX_VOID_REASON_LENGTH) {
    errors.reason = `Keep the reason under ${MAX_VOID_REASON_LENGTH} characters.`;
  }

  const payload: VoidDraftValidation['payload'] = {};
  if (reason) {
    payload.reason = reason;
  }

  return { valid: Object.keys(errors).length === 0, errors, payload };
}

/**
 * M3-S11's 200 body. `billing` is Member 4's refreshed balance, reported so a
 * void that produces a credit is visible instead of silently over-refunding.
 */
export function parseVoidResult(payload: unknown): VoidResult | null {
  const row = (payload ?? {}) as Record<string, unknown>;
  if (typeof row.usage_id !== 'string' || !row.usage_id) {
    return null;
  }
  const billing = (row.billing ?? null) as Record<string, unknown> | null;
  const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value) : '0');

  return {
    usageId: row.usage_id,
    voidedAmount: toMoneyString(typeof row.voided_amount === 'string' ? row.voided_amount : null),
    voidedAt: typeof row.voided_at === 'string' ? row.voided_at : '',
    voidedBy: typeof row.voided_by === 'string' ? row.voided_by : '',
    invoiceId: typeof row.invoice_id === 'string' ? row.invoice_id : null,
    billing: billing
      ? {
          totalAmount: toMoneyString(text(billing.totalAmount)),
          netPaid: toMoneyString(text(billing.netPaid)),
          balance: toMoneyString(text(billing.balance)),
          isCredit: billing.isCredit === true,
          creditAmount: toMoneyString(text(billing.creditAmount)),
        }
      : null,
  };
}

/**
 * FR-048: a void only adds reversal metadata. The original service, room-line
 * attribution, quantity, unit-price snapshot, amount, recording actor and
 * timestamps are copied through untouched, so the retained row still reports
 * what was originally charged.
 */
export function applyVoidedUsage(records: ServiceUsageRecord[], result: VoidResult): ServiceUsageRecord[] {
  return records.map((record) =>
    record.usageId === result.usageId
      ? {
          ...record,
          voided: true,
          voidedAt: result.voidedAt || record.voidedAt,
          voidedBy: result.voidedBy || record.voidedBy,
        }
      : record,
  );
}

const VOID_FAILURE_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Sign in with an active staff account to void service usage.',
  VOID_ACCESS_DENIED:
    'Voiding is limited to an active Branch Manager of this branch, Chain Manager or System Administrator.',
  USAGE_NOT_FOUND: 'That service charge is no longer available to void.',
  USAGE_ALREADY_VOIDED:
    'This charge was already voided, so it cannot be voided again. The original row is retained.',
  INVOICE_FINAL:
    'This booking’s invoice is FINAL, so the charge cannot be voided here. Escalate to management as FR-058 requires.',
  INVALID_SERVICE_USAGE_VOID_INPUT: 'A booking reference and valid charge reference are required.',
  VOID_REJECTED: 'The void was rejected by the server.',
};

export function describeVoidFailure(failure: UsageFailure): string {
  const mapped = VOID_FAILURE_MESSAGES[failure.code];
  if (!mapped) return failure.message || VOID_FAILURE_MESSAGES.VOID_REJECTED;
  return failure.message ? `${mapped} (${failure.message})` : mapped;
}

/** A repeat void is a distinct state: the row is already reversed. */
export function isVoidRepeat(failure: UsageFailure): boolean {
  return failure.code === 'USAGE_ALREADY_VOIDED';
}

/**
 * M3-S10 scopes the usage list read to the recording roles, so a void authority
 * can be refused the list itself. Saying so is better than showing an empty
 * charge list that looks like an uncharged booking.
 */
export function describeListDenial(role: UsageRole | null, canVoid: boolean): string {
  if (!canVoid) {
    return 'Service usage is restricted to active Front Desk or Service Staff of this branch.';
  }
  const base =
    'Your role may void service usage, but the usage list read is still limited to active Front Desk or Service Staff, so no charge can be shown for voiding.';
  return role ? `${base} Signed in as ${role}.` : base;
}

const USAGE_FAILURE_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Sign in with an active staff account to record service usage.',
  USAGE_ACCESS_DENIED:
    'Service usage is limited to active Front Desk or Service Staff of this booking’s own branch.',
  BOOKING_NOT_FOUND: 'Booking not found in the authorized branch.',
  INVALID_SERVICE_USAGE_INPUT: 'Choose a service from the catalogue and enter a positive quantity.',
  INVALID_QUANTITY: 'Quantity must be a positive finite number.',
  INVALID_ROOM_LINE_ID: 'Room-line attribution must be a valid UUID.',
  USAGE_CONFLICT:
    'The booking has no checked-in room line, or that line belongs to another booking, so the usage was rejected.',
  INVOICE_FINAL: 'This booking’s invoice is FINAL, so service usage can no longer be recorded.',
  USAGE_REJECTED: 'The service usage was rejected by the server.',
  USAGE_READ_FAILED: 'Service usage could not be loaded. Retry the request.',
  INTERNAL_ERROR: 'Service usage could not be loaded. Retry the request.',
};

export function parseUsageFailure(status: number, payload: unknown): UsageFailure {
  const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
  return {
    status,
    code: error?.code ?? 'USAGE_READ_FAILED',
    message: error?.message ?? '',
  };
}

export function describeUsageFailure(failure: UsageFailure): string {
  const mapped = USAGE_FAILURE_MESSAGES[failure.code];
  if (!mapped) return failure.message || USAGE_FAILURE_MESSAGES.USAGE_READ_FAILED;
  return failure.message ? `${mapped} (${failure.message})` : mapped;
}

export function isUsageAccessDenial(failure: UsageFailure): boolean {
  return failure.status === 403 || failure.code === 'USAGE_ACCESS_DENIED';
}

/**
 * M3-S08's stay read and M3-S05's catalogue read only support the usage screen:
 * the usage list stays valid without them, but staff must be told why
 * attribution or service selection is empty instead of being shown a
 * misleading "nothing is checked in" state.
 */
export function describeSupportFailure(
  kind: 'CHECKED_IN_LINES' | 'SERVICE_CATALOGUE',
  failure: UsageFailure,
): string {
  const base =
    kind === 'CHECKED_IN_LINES'
      ? 'Checked-in room lines could not be loaded, so room attribution is unavailable.'
      : 'The active service catalogue could not be loaded, so no service can be selected.';
  return failure.message ? `${base} (${failure.message})` : base;
}

export function usageRequestPath(bookingRef: string): string {
  return `/bookings/${encodeURIComponent(bookingRef.trim())}/service-usage`;
}

/** SRS §4.6.2 requires at least one CHECKED_IN line before usage may be recorded. */
export function usageAvailability(checkedInLines: UsageLineOption[]): {
  canRecord: boolean;
  reason: string | null;
} {
  if (checkedInLines.length === 0) {
    return {
      canRecord: false,
      reason: 'Service usage can only be recorded while at least one room line is checked in.',
    };
  }
  return { canRecord: true, reason: null };
}

export { formatLkr };