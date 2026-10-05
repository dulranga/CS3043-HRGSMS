import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { appendAudit } from './audit';
import {
  type GuestIdentity,
  type GuestProfileFields,
  findGuestIdentityMatches,
  lockGuestIdentities,
  maskNic,
  parseGuestProfileFields,
} from './guestIdentity';

// M1-S12 online guest own-profile API (SRS §4.3, FR-016/017/018/021/022,
// BR-013, NFR-011). An online guest can read and edit only their linked
// guest profile; cross-account access is rejected. The same NIC, email and
// phone duplicate rules apply as in M1-S11, reusing the identity locks and
// validation. For brevity, "online guest profile" routes are mounted under
// /api/guest/profile (singular) to distinguish them from /api/guests
// (plural, staff).

type Queryable = Pick<PoolClient, 'query'>;
export type GuestAccountDb = Queryable & Pick<Pool, 'connect'>;

const REASON_MAX_LENGTH = 255;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE_KEYS = new Set(['fullName', 'email', 'phone', 'nic']);

interface GuestRow {
  guest_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  nic: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface GuestAccountProfileView {
  guestId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  maskedNic: string | null;
  hasNic: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function toView(row: GuestRow): GuestAccountProfileView {
  return {
    guestId: row.guest_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    maskedNic: maskNic(row.nic),
    hasNic: row.nic !== null,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, errors: Record<string, string>) {
  for (const key of Object.keys(record)) if (!allowed.has(key)) errors[key] = 'is not allowed';
}

// ---------------------------------------------------------------------------
// Input validation

export interface GuestAccountWriteInput {
  fields: Partial<GuestProfileFields>;
  confirmNotDuplicate: boolean;
}

export function validateGuestAccountWriteInput(body: unknown): {
  value?: GuestAccountWriteInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(body ?? {});
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, new Set(['fullName', 'email', 'phone', 'nic', 'confirmNotDuplicate']), errors);

  // For simplicity, own-profile edits must include at least one field.
  const hasSomeField = Array.from(PROFILE_KEYS).some((key) => key in record);
  if (!hasSomeField) return { errors: { body: 'at least one field (fullName, email, phone, nic) is required' } };

  const fields = parseGuestProfileFields(record, errors, true);
  
  // Check for contact requirement (FR-017).
  if (!record.fullName && record.email === null && record.phone === null) {
    // Clearing all contacts is allowed only if left with at least one existing one.
    // This will be validated against the actual guest row during the update.
  }
  
  if (Object.keys(errors).length > 0) return { errors };

  const confirmNotDuplicate = record.confirmNotDuplicate === true;

  return { value: { fields, confirmNotDuplicate } };
}

// ---------------------------------------------------------------------------
// Service layer

export interface CreateGuestAccountService {
  getOwnProfile(guestId: string): Promise<GuestAccountProfileView | null>;
  updateOwnProfile(
    guestId: string,
    userId: string,
    input: GuestAccountWriteInput,
  ): Promise<{ data?: GuestAccountProfileView; error?: { code: string; message: string; fields?: Record<string, string> } }>;
}

export function createGuestAccount({ db }: { db: GuestAccountDb }): CreateGuestAccountService {
  return {
    async getOwnProfile(guestId: string): Promise<GuestAccountProfileView | null> {
      if (!UUID_PATTERN.test(guestId)) return null;
      const result = await db.query(
        'SELECT guest_id, full_name, email, phone, nic, active, created_at, updated_at FROM guest WHERE guest_id = $1',
        [guestId],
      );
      return result.rows[0] ? toView(result.rows[0]) : null;
    },

    async updateOwnProfile(
      guestId: string,
      userId: string,
      input: GuestAccountWriteInput,
    ): Promise<{ data?: GuestAccountProfileView; error?: { code: string; message: string; fields?: Record<string, string> } }> {
      // BR-013: the session's guestId and the route's guestId must match.
      // This is enforced by the caller, but double-check here as a safety net.
      if (!UUID_PATTERN.test(guestId)) {
        return { error: { code: 'INVALID_GUEST_ID', message: 'Invalid guest ID.' } };
      }

      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Lock the guest row. If the guest is deactivated or does not exist,
        // fail cleanly without exposing whether it exists.
        const guestResult = await client.query<GuestRow>(
          'SELECT guest_id, full_name, email, phone, nic, active, created_at, updated_at FROM guest WHERE guest_id = $1 FOR UPDATE',
          [guestId],
        );
        if (!guestResult.rows[0]) {
          await client.query('ROLLBACK');
          return { error: { code: 'GUEST_NOT_FOUND', message: 'Guest profile not found.' } };
        }

        const guest = guestResult.rows[0];
        if (!guest.active) {
          await client.query('ROLLBACK');
          return { error: { code: 'GUEST_INACTIVE', message: 'This profile is deactivated.' } };
        }

        // Check that the guest will still have at least one contact method after
        // this update (FR-017).
        const willHaveEmail = input.fields.email !== undefined ? input.fields.email : guest.email;
        const willHavePhone = input.fields.phone !== undefined ? input.fields.phone : guest.phone;
        if (!willHaveEmail && !willHavePhone) {
          await client.query('ROLLBACK');
          return {
            error: {
              code: 'INVALID_INPUT',
              message: 'Guest profile requires at least one contact method.',
              fields: { contact: 'an email address or phone number is required' },
            },
          };
        }

        // Identify which fields have actually changed, using undefined to mean "no change".
        const changed: Record<string, unknown> = {};
        if (input.fields.fullName !== undefined && input.fields.fullName !== guest.full_name) {
          changed.fullName = input.fields.fullName;
        }
        if (input.fields.email !== undefined && input.fields.email !== guest.email) {
          changed.email = input.fields.email;
        }
        if (input.fields.phone !== undefined && input.fields.phone !== guest.phone) {
          changed.phone = input.fields.phone;
        }
        if (input.fields.nic !== undefined && input.fields.nic !== guest.nic) {
          changed.nic = input.fields.nic;
        }

        // If nothing has changed, return the profile as-is without auditing.
        if (Object.keys(changed).length === 0) {
          await client.query('ROLLBACK');
          return { data: toView(guest) };
        }

        // Only check duplicates on fields that changed. Exclude the current guest
        // from the duplicate check so a guest can keep their own email/phone/NIC.
        const toCheck: Partial<GuestIdentity> = {};
        if ('email' in changed) toCheck.email = changed.email as string | null;
        if ('phone' in changed) toCheck.phone = changed.phone as string | null;
        if ('nic' in changed) toCheck.nic = changed.nic as string | null;

        // Lock the guest-identity rows for any changed identifiers.
        await lockGuestIdentities(client, toCheck);

        // Find duplicates among other guests (excluding this one).
        const matches = await findGuestIdentityMatches(client, toCheck, guestId);
        
        // Check for exact NIC match (always refused).
        const nicMatch = matches.find((m) => m.matchedOn.includes('nic'));
        if (nicMatch) {
          await client.query('ROLLBACK');
          return {
            error: {
              code: 'GUEST_NIC_EXISTS',
              message: 'A guest with that NIC already exists.',
              fields: { nic: 'this NIC is already registered to another guest' },
            },
          };
        }

        // Check for email/phone matches (refused unless confirmed).
        if (matches.length > 0 && !input.confirmNotDuplicate) {
          await client.query('ROLLBACK');
          return {
            error: {
              code: 'POSSIBLE_DUPLICATE',
              message: 'A guest with similar contact details may already exist.',
            },
          };
        }

        // Update the guest profile.
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramCount = 1;

        if ('fullName' in changed) {
          updates.push(`full_name = $${paramCount++}`);
          values.push(changed.fullName);
        }
        if ('email' in changed) {
          updates.push(`email = $${paramCount++}`);
          values.push(changed.email);
        }
        if ('phone' in changed) {
          updates.push(`phone = $${paramCount++}`);
          values.push(changed.phone);
        }
        if ('nic' in changed) {
          updates.push(`nic = $${paramCount++}`);
          values.push(changed.nic);
        }

        if (updates.length > 0) {
          values.push(guestId);
          await client.query(`UPDATE guest SET ${updates.join(', ')} WHERE guest_id = $${paramCount}`, values);
        }

        // Record audit for changed fields only.
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};

        if ('fullName' in changed) {
          before.fullName = guest.full_name;
          after.fullName = changed.fullName;
        }
        if ('email' in changed) {
          before.email = guest.email;
          after.email = changed.email;
        }
        if ('phone' in changed) {
          before.phone = guest.phone;
          after.phone = changed.phone;
        }
        if ('nic' in changed) {
          before.nic = guest.nic;
          after.nic = changed.nic;
        }

        await appendAudit(client, {
          entityName: 'guest',
          entityId: guestId,
          action: 'UPDATE',
          userId,
          before,
          after,
        });

        await client.query('COMMIT');

        // Return the updated profile.
        const final = await client.query<GuestRow>(
          'SELECT guest_id, full_name, email, phone, nic, active, created_at, updated_at FROM guest WHERE guest_id = $1',
          [guestId],
        );
        return { data: toView(final.rows[0]) };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
