import type { PoolClient } from 'pg';

// Chain-wide typed billing policy contract (SRS §4.7.4, §6.1.4, FR-076, DBR-035).
// Bounds mirror the CHECK constraints in m1_005_create_billing_policy.sql; the
// database remains the final authority for bounds, authorization, publication
// time, ordering and append-only history. Numeric values are exchanged as
// two-decimal strings so LKR amounts never pass through floating point.

type Queryable = Pick<PoolClient, 'query'>;

export const BILLING_POLICY_TIME_ZONE = 'Asia/Colombo';

export interface BillingPolicyInput {
  effectiveFrom: string;
  taxPercent: string | number;
  serviceChargePercent: string | number;
  maxDiscountPercent: string | number;
  cancellationFee: string | number;
  noShowFee: string | number;
  lateCheckoutFee: string | number;
  noShowGraceDays: number;
  isDemo: boolean;
}

export interface BillingPolicy {
  billingPolicyId: string;
  effectiveFrom: string;
  taxPercent: string;
  serviceChargePercent: string;
  maxDiscountPercent: string;
  cancellationFee: string;
  noShowFee: string;
  lateCheckoutFee: string;
  noShowGraceDays: number;
  isDemo: boolean;
  createdBy: string;
  createdAt: Date;
}

export interface BillingPolicyEnvironment {
  // Production rejects demo publication and never selects a demo version.
  production: boolean;
}

export class BillingPolicyValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super(`Invalid billing policy: ${Object.keys(fieldErrors).join(', ')}`);
    this.name = 'BillingPolicyValidationError';
  }
}

export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_FEE_INTEGER_DIGITS = 10;

function normalizeDecimal(value: unknown): string | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  return DECIMAL_PATTERN.test(trimmed) ? trimmed : null;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function validateBillingPolicyInput(
  input: BillingPolicyInput,
  environment: BillingPolicyEnvironment,
): BillingPolicyInput {
  const errors: Record<string, string> = {};
  const normalized = { ...input };

  if (!isCalendarDate(input.effectiveFrom)) {
    errors.effectiveFrom = 'must be a valid YYYY-MM-DD date';
  }

  for (const field of ['taxPercent', 'serviceChargePercent', 'maxDiscountPercent'] as const) {
    const value = normalizeDecimal(input[field]);
    if (value === null || Number(value) > 100) {
      errors[field] = 'must be a percentage between 0 and 100 with at most two decimals';
    } else {
      normalized[field] = value;
    }
  }

  for (const field of ['cancellationFee', 'noShowFee', 'lateCheckoutFee'] as const) {
    const value = normalizeDecimal(input[field]);
    if (value === null || value.split('.')[0].replace(/^0+(?=\d)/, '').length > MAX_FEE_INTEGER_DIGITS) {
      errors[field] = 'must be a non-negative LKR amount with at most two decimals';
    } else {
      normalized[field] = value;
    }
  }

  if (!Number.isInteger(input.noShowGraceDays) || input.noShowGraceDays < 1 || input.noShowGraceDays > 7) {
    errors.noShowGraceDays = 'must be a whole number of days between 1 and 7';
  }

  if (typeof input.isDemo !== 'boolean') {
    errors.isDemo = 'is required';
  } else if (input.isDemo && environment.production) {
    errors.isDemo = 'demo policies cannot be published in production';
  }

  if (Object.keys(errors).length > 0) {
    throw new BillingPolicyValidationError(errors);
  }
  return normalized;
}

const SELECT_COLUMNS = `
  billing_policy_id AS "billingPolicyId",
  effective_from::text AS "effectiveFrom",
  tax_percent::text AS "taxPercent",
  service_charge_percent::text AS "serviceChargePercent",
  max_discount_percent::text AS "maxDiscountPercent",
  cancellation_fee::text AS "cancellationFee",
  no_show_fee::text AS "noShowFee",
  late_checkout_fee::text AS "lateCheckoutFee",
  no_show_grace_days AS "noShowGraceDays",
  is_demo AS "isDemo",
  created_by AS "createdBy",
  created_at AS "createdAt"`;

// Publishes one immutable version. The database authorizes the actor (active
// CHAIN_MANAGER, or the system principal for demo rows only), serializes
// publication, sets created_at and writes the PUBLISH audit row atomically.
export async function publishBillingPolicy(
  client: Queryable,
  input: BillingPolicyInput,
  actorUserId: string,
  environment: BillingPolicyEnvironment,
): Promise<BillingPolicy> {
  const policy = validateBillingPolicyInput(input, environment);
  const result = await client.query<BillingPolicy>(
    `INSERT INTO billing_policy (
       effective_from, tax_percent, service_charge_percent, max_discount_percent,
       cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
       is_demo, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${SELECT_COLUMNS}`,
    [
      policy.effectiveFrom,
      policy.taxPercent,
      policy.serviceChargePercent,
      policy.maxDiscountPercent,
      policy.cancellationFee,
      policy.noShowFee,
      policy.lateCheckoutFee,
      policy.noShowGraceDays,
      policy.isDemo,
      actorUserId,
    ],
  );
  return result.rows[0];
}

// Selects the version governing a confirmation at `confirmedAt`: published at or
// before that instant, effective on or before its Asia/Colombo calendar date,
// latest by (effective_from, created_at, billing_policy_id). Returns null when
// none applies, which must block confirmation. Production ignores demo rows.
// When `confirmedAt` is omitted the database transaction time (now()) is used,
// so call this inside the confirmation transaction. A timestamptz string keeps
// PostgreSQL's microsecond precision, which a JavaScript Date cannot.
export async function findEffectiveBillingPolicy(
  client: Queryable,
  environment: BillingPolicyEnvironment,
  confirmedAt?: Date | string,
): Promise<BillingPolicy | null> {
  const result = await client.query<BillingPolicy>(
    `WITH confirmation AS (SELECT COALESCE($1::timestamptz, now()) AS at)
     SELECT ${SELECT_COLUMNS}
       FROM billing_policy, confirmation
      WHERE effective_from <= (confirmation.at AT TIME ZONE '${BILLING_POLICY_TIME_ZONE}')::date
        AND created_at <= confirmation.at
        AND NOT ($2::boolean AND is_demo)
      ORDER BY effective_from DESC, created_at DESC, billing_policy_id DESC
      LIMIT 1`,
    [confirmedAt ?? null, environment.production],
  );
  return result.rows[0] ?? null;
}

export async function getBillingPolicy(
  client: Queryable,
  billingPolicyId: string,
): Promise<BillingPolicy | null> {
  const result = await client.query<BillingPolicy>(
    `SELECT ${SELECT_COLUMNS} FROM billing_policy WHERE billing_policy_id = $1`,
    [billingPolicyId],
  );
  return result.rows[0] ?? null;
}

// Full published history, newest effective version first.
export async function listBillingPolicies(client: Queryable): Promise<BillingPolicy[]> {
  const result = await client.query<BillingPolicy>(
    `SELECT ${SELECT_COLUMNS}
       FROM billing_policy
      ORDER BY effective_from DESC, created_at DESC, billing_policy_id DESC`,
  );
  return result.rows;
}
