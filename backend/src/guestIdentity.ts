import type { PoolClient } from 'pg';

// Shared guest identity rules for online registration (M1-S10) and staff
// guest-profile maintenance (M1-S11), so both paths normalize, lock and detect
// duplicates the same way (FR-017/018/019, SRS §6.1.4 identity contract).

type Queryable = Pick<PoolClient, 'query'>;

export const GUEST_NAME_MAX_LENGTH = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export interface GuestIdentity {
  email: string | null;
  phone: string | null;
  nic: string | null;
}

export interface GuestProfileFields extends GuestIdentity {
  fullName: string;
}

export type GuestIdentityField = keyof GuestIdentity;

// Phone numbers are compared and stored as digits with an optional leading +,
// so "077 123-4567" and "0771234567" are the same contact.
export function normalizePhone(value: string): string {
  return value.replace(/[\s().-]/g, '');
}

// Ordinary lists and detail views show only the last four NIC characters
// behind a fixed-width prefix, so the NIC length is not revealed (NFR-011).
export function maskNic(nic: string | null): string | null {
  if (nic === null) return null;
  return `•••••${nic.length > 4 ? nic.slice(-4) : ''}`;
}

// Parses the editable profile fields. With partial = true, absent keys stay
// undefined (unchanged) and null/blank clears an optional field.
export function parseGuestProfileFields(
  record: Record<string, unknown>,
  errors: Record<string, string>,
  partial: boolean,
): Partial<GuestProfileFields> {
  const value: Partial<GuestProfileFields> = {};
  const read = (key: string): string | null | undefined => {
    if (!(key in record) || record[key] === undefined) return partial ? undefined : null;
    const raw = record[key];
    if (raw === null) return null;
    if (typeof raw !== 'string') {
      errors[key] = 'must be a string';
      return undefined;
    }
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  };

  const fullName = read('fullName');
  if (fullName === null) errors.fullName = 'is required';
  else if (fullName !== undefined) {
    if (fullName.length > GUEST_NAME_MAX_LENGTH) errors.fullName = `must be at most ${GUEST_NAME_MAX_LENGTH} characters`;
    else value.fullName = fullName;
  } else if (!partial && !errors.fullName) errors.fullName = 'is required';

  const email = read('email');
  if (email !== undefined) {
    const lowered = email?.toLowerCase() ?? null;
    if (lowered && (lowered.length > GUEST_NAME_MAX_LENGTH || !EMAIL_PATTERN.test(lowered))) {
      errors.email = 'must be a valid email address';
    } else value.email = lowered;
  }

  const phone = read('phone');
  if (phone !== undefined) {
    const normalized = phone ? normalizePhone(phone) : null;
    if (normalized && !PHONE_PATTERN.test(normalized)) errors.phone = 'must be 7-15 digits with an optional leading +';
    else value.phone = normalized;
  }

  // FR-018 leaves NIC format validation to a team decision; only normalize.
  const nic = read('nic');
  if (nic !== undefined) {
    const upper = nic?.toUpperCase() ?? null;
    if (upper && upper.length > GUEST_NAME_MAX_LENGTH) errors.nic = `must be at most ${GUEST_NAME_MAX_LENGTH} characters`;
    else value.nic = upper;
  }

  return value;
}

// Serializes concurrent creates/updates that share any identifier. Keys are
// sorted so two transactions always lock in the same order and cannot deadlock.
export async function lockGuestIdentities(client: Queryable, identity: Partial<GuestIdentity>): Promise<void> {
  const keys = (['email', 'phone', 'nic'] as const)
    .map((field) => (identity[field] ? `${field}:${identity[field]}` : null))
    .filter((key): key is string => key !== null)
    .sort();
  for (const key of keys) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`guest-identity:${key}`]);
  }
}

export interface GuestIdentityMatch {
  guestId: string;
  fullName: string;
  active: boolean;
  maskedNic: string | null;
  matchedOn: GuestIdentityField[];
}

// Finds guest profiles (active or not) sharing an email, phone or NIC. Stored
// values are normalized in SQL too, for rows written before these rules.
export async function findGuestIdentityMatches(
  client: Queryable,
  identity: Partial<GuestIdentity>,
  excludeGuestId?: string,
): Promise<GuestIdentityMatch[]> {
  const email = identity.email ?? null;
  const phone = identity.phone ?? null;
  const nic = identity.nic ?? null;
  if (!email && !phone && !nic) return [];
  const result = await client.query<{
    guest_id: string;
    full_name: string;
    active: boolean;
    nic: string | null;
    email_match: boolean;
    phone_match: boolean;
    nic_match: boolean;
  }>(
    `SELECT guest_id, full_name, active, nic,
            ($1::text IS NOT NULL AND lower(btrim(email)) = $1) IS TRUE AS email_match,
            ($2::text IS NOT NULL AND regexp_replace(phone, '[\\s().-]', '', 'g') = $2) IS TRUE AS phone_match,
            ($3::text IS NOT NULL AND nic = $3) IS TRUE AS nic_match
       FROM guest
      WHERE (($1::text IS NOT NULL AND lower(btrim(email)) = $1)
          OR ($2::text IS NOT NULL AND regexp_replace(phone, '[\\s().-]', '', 'g') = $2)
          OR ($3::text IS NOT NULL AND nic = $3))
        AND ($4::uuid IS NULL OR guest_id <> $4::uuid)
      ORDER BY full_name, guest_id
      LIMIT 10`,
    [email, phone, nic, excludeGuestId ?? null],
  );
  return result.rows.map((row) => ({
    guestId: row.guest_id,
    fullName: row.full_name,
    active: row.active,
    maskedNic: maskNic(row.nic),
    matchedOn: (['email', 'phone', 'nic'] as const).filter((field) => row[`${field}_match`]),
  }));
}
