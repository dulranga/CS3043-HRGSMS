import type { PoolClient } from 'pg';

// Controlled SRS §6.1.4 audit-action labels. Keep in sync with the
// audit_log_action_check constraint in m1_004_create_audit_log.sql.
export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'DEACTIVATE',
  'REACTIVATE',
  'STATUS_CHANGE',
  'VOID',
  'REVERSE',
  'PUBLISH',
  'LOGIN',
  'LOGOUT',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

type AuditQueryable = Pick<PoolClient, 'query'>;

export interface AppendAuditParams {
  userId: string;
  entityName: string;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === 'nic' ||
    normalized === 'password' ||
    normalized === 'password_hash' ||
    normalized === 'passwordhash' ||
    normalized.includes('password') ||
    normalized.includes('token') ||
    normalized.includes('secret')
  );
}

// Recursively masks sensitive keys (passwords, tokens, NIC) in before/after
// evidence so they never reach the audit_log in plain text (SRS §6.1.4).
export function maskSensitiveValues(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveValues(item));
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    result[key] = isSensitiveKey(key) ? '[REDACTED]' : maskSensitiveValues(record[key]);
  }
  return result;
}

// Appends one audit entry, masking any sensitive before/after values.
export async function appendAudit(
  client: AuditQueryable,
  params: AppendAuditParams,
): Promise<void> {
  const beforeJson =
    params.before === undefined ? null : JSON.stringify(maskSensitiveValues(params.before));
  const afterJson =
    params.after === undefined ? null : JSON.stringify(maskSensitiveValues(params.after));
  await client.query(
    `INSERT INTO audit_log
       (user_id, entity_name, entity_id, action, before_value, after_value, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.userId,
      params.entityName,
      params.entityId,
      params.action,
      beforeJson,
      afterJson,
      params.ipAddress ?? null,
    ],
  );
}
