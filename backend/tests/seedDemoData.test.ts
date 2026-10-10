// Focused verification for the demonstration seed (SRS §6.1.11 / Table 48,
// NFR-032). Applies the real numbered migration chain into a throwaway schema,
// runs the seed twice and asserts the demonstration baseline is produced and
// that a second run is idempotent (no duplicated catalogue, bookings, payments
// or service usage).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { migrate } from '../src/migrations/migrate';
import { seedDemoData } from '../src/seed/demoData';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const migrationsDir = path.join(__dirname, '..', 'migrations');

function directConnectionString(): string {
  const url = new URL(process.env.PG_TEST_URL || process.env.PG_URL || '');
  // Session search_path and a direct client require the non-pooler host.
  url.hostname = url.hostname.replace('-pooler.', '.');
  return url.toString();
}

async function scalar(client: Client, sql: string): Promise<number> {
  return Number((await client.query(sql)).rows[0].n);
}

test('seedDemoData builds the Table 48 baseline and is idempotent', async () => {
  const connectionString = directConnectionString();
  const schema = `seed_${randomBytes(8).toString('hex')}`;

  await migrate({ connectionString, migrationsDir, schema });

  const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);

    const first = await seedDemoData({ connectionString, schema });
    assert.ok(first.counts.accounts >= 8, 'at least the demo staff + one guest account');
    assert.equal(first.counts.roomTypes, 3, 'Single, Double and Suite');
    assert.ok(first.counts.amenities >= 3);
    assert.ok(first.counts.rooms >= 10, 'Table 48 requires at least 10 rooms');
    assert.ok(first.counts.services >= 6, 'FR-042 requires at least six services');
    assert.ok(first.counts.guests >= 5, 'Table 48 requires at least five guests');
    assert.equal(first.counts.bookings, 6, 'one booking per demonstration lifecycle');
    assert.ok(first.counts.payments >= 4, 'at least three partial payments plus a settlement');
    assert.ok(first.counts.serviceUsages >= 4);

    // Two rooms under one booking, with different room-type base rates.
    const demo01 = await client.query(
      `SELECT count(*)::int AS n,
              count(DISTINCT t.room_type_id)::int AS types
         FROM booking_room_line l
         JOIN booking b ON b.booking_id = l.booking_id
         JOIN booking_room_assignment a ON a.line_id = l.line_id
         JOIN room r ON r.room_id = a.room_id
         JOIN room_type t ON t.room_type_id = r.room_type_id
        WHERE b.booking_ref = 'DEMO-01'`,
    );
    assert.equal(demo01.rows[0].n, 2, 'DEMO-01 has two room lines');
    assert.equal(demo01.rows[0].types, 2, 'DEMO-01 mixes two room types at different rates');

    // Two simultaneous Single rooms at the same base rate.
    const demo02 = await client.query(
      `SELECT count(*)::int AS n,
              count(DISTINCT l.rate_snapshot)::int AS rates
         FROM booking_room_line l
         JOIN booking b ON b.booking_id = l.booking_id
        WHERE b.booking_ref = 'DEMO-02'`,
    );
    assert.equal(demo02.rows[0].n, 2);
    assert.equal(demo02.rows[0].rates, 1, 'DEMO-02 rooms share the same base rate');

    // One checkout reached a FINAL invoice; cancellation and no-show are present.
    assert.equal(
      await scalar(
        client,
        `SELECT count(*)::int AS n FROM invoice i JOIN booking b ON b.booking_id = i.booking_id
          WHERE i.status = 'FINAL' AND b.booking_ref LIKE 'DEMO-%'`,
      ),
      1,
      'the fully settled checkout finalises exactly one invoice',
    );
    assert.equal(
      await scalar(
        client,
        `SELECT count(*)::int AS n FROM booking_room_line l JOIN booking b ON b.booking_id = l.booking_id
          WHERE l.status = 'CANCELLED' AND b.booking_ref LIKE 'DEMO-%'`,
      ),
      1,
    );
    assert.equal(
      await scalar(
        client,
        `SELECT count(*)::int AS n FROM booking_room_line l JOIN booking b ON b.booking_id = l.booking_id
          WHERE l.status = 'NO_SHOW' AND b.booking_ref LIKE 'DEMO-%'`,
      ),
      1,
    );

    // A booking-wide (unallocated) service usage and a voided usage both exist.
    assert.ok(
      (await scalar(client, `SELECT count(*)::int AS n FROM service_usage WHERE booking_room_line_id IS NULL`)) >= 1,
    );
    assert.ok((await scalar(client, `SELECT count(*)::int AS n FROM service_usage WHERE voided IS TRUE`)) >= 1);

    // Idempotency: a second run adds nothing.
    const second = await seedDemoData({ connectionString, schema });
    assert.deepEqual(second.counts, first.counts, 'a re-run must not change the row counts');
    assert.equal(second.billingPolicyId, first.billingPolicyId, 'the published policy is reused');
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end();
  }
});
