import type { PoolClient } from 'pg';

// Non-financial current-value settings (SRS §6.1.4, FR-076, FR-080). Checks here
// mirror m1_006_create_system_config.sql so callers get field errors early; the
// database remains the authority for the key registry, per-key value patterns,
// SYSTEM_ADMINISTRATOR authorization, activation date and audit evidence.
// Financial values belong to billing_policy and must never be read from here.

type Queryable = Pick<PoolClient, 'query'>;

export const SYSTEM_CONFIG_TIME_ZONE = 'Asia/Colombo';
export const SYSTEM_CONFIG_VALUE_MAX_LENGTH = 65535;

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const KEY_MAX_LENGTH = 255;
const FORBIDDEN_KEY_TERMS =
  /(^|_)(tax|taxes|fee|fees|rate|rates|discount|discounts|charge|charges|price|prices|amount|amounts|percent|percentage|billing|cancellation|no_show|noshow|late_checkout|grace|refund|payment|invoice|password|secret|token)(_|$)/;

export interface SystemConfigEntry {
  configKey: string;
  configValue: string;
  effectiveFrom: string;
  updatedBy: string;
  updatedAt: Date;
}

export class SystemConfigValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super(`Invalid system configuration: ${Object.keys(fieldErrors).join(', ')}`);
    this.name = 'SystemConfigValidationError';
  }
}

export function validateSystemConfigInput(configKey: unknown, configValue: unknown): {
  configKey: string;
  configValue: string;
} {
  const errors: Record<string, string> = {};

  if (
    typeof configKey !== 'string' ||
    configKey.length > KEY_MAX_LENGTH ||
    !KEY_PATTERN.test(configKey)
  ) {
    errors.configKey = 'must be a lowercase snake_case key of at most 255 characters';
  } else if (FORBIDDEN_KEY_TERMS.test(configKey)) {
    errors.configKey = 'financial and secret settings cannot be stored in system configuration';
  }

  if (typeof configValue !== 'string' || configValue.trim() === '') {
    errors.configValue = 'is required';
  } else if (configValue.length > SYSTEM_CONFIG_VALUE_MAX_LENGTH) {
    errors.configValue = `must be at most ${SYSTEM_CONFIG_VALUE_MAX_LENGTH} characters`;
  }

  if (Object.keys(errors).length > 0) {
    throw new SystemConfigValidationError(errors);
  }
  return { configKey: configKey as string, configValue: configValue as string };
}

const SELECT_COLUMNS = `
  config_key AS "configKey",
  config_value AS "configValue",
  effective_from::text AS "effectiveFrom",
  updated_by AS "updatedBy",
  updated_at AS "updatedAt"`;

// Creates or immediately replaces one setting. The database authorizes the
// actor, rejects unregistered keys and invalid values, sets updated_at and the
// current activation date, and writes the CREATE/UPDATE audit row (with the old
// value) in the caller's transaction, so a failure rolls everything back.
export async function setSystemConfig(
  client: Queryable,
  configKey: string,
  configValue: string,
  actorUserId: string,
): Promise<SystemConfigEntry> {
  const input = validateSystemConfigInput(configKey, configValue);
  const result = await client.query<SystemConfigEntry>(
    `INSERT INTO system_config (config_key, config_value, effective_from, updated_by, updated_at)
     VALUES ($1, $2, CURRENT_DATE, $3, now())
     ON CONFLICT (config_key) DO UPDATE
        SET config_value = EXCLUDED.config_value,
            updated_by = EXCLUDED.updated_by
     RETURNING ${SELECT_COLUMNS}`,
    [input.configKey, input.configValue, actorUserId],
  );
  return result.rows[0];
}

export async function getSystemConfig(
  client: Queryable,
  configKey: string,
): Promise<SystemConfigEntry | null> {
  const result = await client.query<SystemConfigEntry>(
    `SELECT ${SELECT_COLUMNS} FROM system_config WHERE config_key = $1`,
    [configKey],
  );
  return result.rows[0] ?? null;
}

export async function listSystemConfig(client: Queryable): Promise<SystemConfigEntry[]> {
  const result = await client.query<SystemConfigEntry>(
    `SELECT ${SELECT_COLUMNS} FROM system_config ORDER BY config_key`,
  );
  return result.rows;
}
