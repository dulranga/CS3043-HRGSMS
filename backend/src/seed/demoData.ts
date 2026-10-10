import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { checkInRoomLine } from '../services/checkInService';
import { recordServiceUsage, voidServiceUsage } from '../services/serviceUsageService';

// SkyNest demonstration seed (SRS §6.1.11 / Table 48, NFR-032).
//
// This is intentionally NOT a migration. As a migration, demo rows would run in
// every environment and the append-only financial/audit tables could not be
// safely re-seeded. Instead this module is an idempotent, additive seed that:
//   * drives the real transaction contracts (sp_create_booking,
//     sp_create_online_guest_booking, check-in, service usage, payment,
//     checkout, cancellation, no-show and the room-condition operation) so
//     every guard, history table and DRAFT/FINAL invoice is produced exactly as
//     production callers produce it,
//   * resolves or creates each demo entity by a stable natural key, so a re-run
//     after a partial failure finishes the missing work and never duplicates
//     what already exists, and
//   * never mutates or deletes non-demo rows.
//
// Lecture concepts applied: multi-table state changes run through explicit
// transactions (the called SQL functions open their own), every value is bound
// as a parameter instead of string-concatenated (prepared-statement / SQL
// injection guidance), and rows are inserted parents-before-children so no FK
// or deferred lifecycle trigger is ever violated.

export const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'SkyNest#2026';
export const BCRYPT_COST = 12;
const SCHEMA_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const BOOKING_REF_PREFIX = 'DEMO-';

export interface SeedDemoOptions {
  connectionString: string;
  /** Optional schema; when omitted the connection default (usually public) is used. */
  schema?: string;
  logger?: (message: string) => void;
}

export interface SeedDemoResult {
  counts: {
    accounts: number;
    roomTypes: number;
    amenities: number;
    rooms: number;
    services: number;
    guests: number;
    bookings: number;
    payments: number;
    serviceUsages: number;
  };
  billingPolicyId: string;
  credentials: { username: string; password: string }[];
}

type Row = Record<string, any>;
type Query = (sql: string, params?: unknown[]) => Promise<Row[]>;

interface SeedContext {
  client: Client;
  q: Query;
  schema?: string;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(value: number | string): string {
  return Number(value).toFixed(2);
}

export async function seedDemoData(options: SeedDemoOptions): Promise<SeedDemoResult> {
  const log = options.logger ?? (() => {});
  const schema = options.schema;
  if (schema && !SCHEMA_IDENTIFIER.test(schema)) {
    throw new Error(`Invalid schema name "${schema}"`);
  }

  const client = new Client({ connectionString: options.connectionString, connectionTimeoutMillis: 15000 });
  await client.connect();
  const q: Query = async (sql, params = []) => (await client.query(sql, params)).rows;
  const ctx: SeedContext = { client, q, schema };

  try {
    if (schema) await client.query(`SET search_path TO "${schema}"`);

    log('Resolving branches and seeded roles...');
    const colomboId = await ensureBranch(ctx, 'Colombo', 'Colombo', '1 Galle Road, Colombo 03');
    const kandyId = await ensureBranch(ctx, 'Kandy', 'Kandy', '12 Peradeniya Road, Kandy');
    const galleId = await ensureBranch(ctx, 'Galle', 'Galle', '45 Matara Road, Galle');
    const roleIds = await loadRoles(ctx);

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);

    log('Creating demonstration staff and online-guest accounts...');
    const chainManagerId = await ensureStaff(ctx, passwordHash, {
      username: 'demo.chain',
      fullName: 'Demo Chain Manager',
      roleId: roleIds.CHAIN_MANAGER,
      branchId: colomboId,
      email: 'demo.chain@skynest.test',
      phone: '+94110000001',
      nic: 'DEMO-OFC-0001',
    });
    const frontDeskId = await ensureStaff(ctx, passwordHash, {
      username: 'demo.frontdesk',
      fullName: 'Demo Front Desk',
      roleId: roleIds.FRONT_DESK,
      branchId: colomboId,
      email: 'demo.frontdesk@skynest.test',
      phone: '+94110000002',
      nic: 'DEMO-OFC-0002',
    });
    const serviceStaffId = await ensureStaff(ctx, passwordHash, {
      username: 'demo.service',
      fullName: 'Demo Service Staff',
      roleId: roleIds.SERVICE_STAFF,
      branchId: colomboId,
      email: 'demo.service@skynest.test',
      phone: '+94110000003',
      nic: 'DEMO-OFC-0003',
    });
    const branchManagerId = await ensureStaff(ctx, passwordHash, {
      username: 'demo.branchmanager',
      fullName: 'Demo Branch Manager',
      roleId: roleIds.BRANCH_MANAGER,
      branchId: colomboId,
      email: 'demo.branchmanager@skynest.test',
      phone: '+94110000004',
      nic: 'DEMO-OFC-0004',
    });
    const adminId = await ensureStaff(ctx, passwordHash, {
      username: 'demo.admin',
      fullName: 'Demo System Administrator',
      roleId: roleIds.SYSTEM_ADMINISTRATOR,
      branchId: colomboId,
      email: 'demo.admin@skynest.test',
      phone: '+94110000005',
      nic: 'DEMO-OFC-0005',
    });
    await ensureStaff(ctx, passwordHash, {
      username: 'demo.auditor',
      fullName: 'Demo Auditor',
      roleId: roleIds.AUDITOR,
      branchId: colomboId,
      email: 'demo.auditor@skynest.test',
      phone: '+94110000006',
      nic: 'DEMO-OFC-0006',
    });
    // A second-branch FRONT_DESK actor lets authorization tests prove that a
    // Kandy officer cannot act on Colombo inventory.
    await ensureStaff(ctx, passwordHash, {
      username: 'demo.frontdesk.kandy',
      fullName: 'Demo Kandy Front Desk',
      roleId: roleIds.FRONT_DESK,
      branchId: kandyId,
      email: 'demo.frontdesk.kandy@skynest.test',
      phone: '+94810000007',
      nic: 'DEMO-OFC-0007',
    });
    const onlineGuestUserId = await ensureUserAccount(ctx, passwordHash, 'demo.guest');

    log('Creating room types, amenities and physical rooms...');
    const singleId = await ensureRoomType(ctx, 'Demo Single', 1, money(12000));
    const doubleId = await ensureRoomType(ctx, 'Demo Double', 2, money(18000));
    const suiteId = await ensureRoomType(ctx, 'Demo Suite', 4, money(35000));

    const wifiId = await ensureAmenity(ctx, 'Demo Wi-Fi', 'Complimentary wireless internet');
    const acId = await ensureAmenity(ctx, 'Demo Air Conditioning', 'Individual climate control');
    const minibarId = await ensureAmenity(ctx, 'Demo Minibar', 'In-room stocked minibar');
    for (const [typeId, amenityId] of [
      [singleId, wifiId],
      [singleId, acId],
      [doubleId, wifiId],
      [doubleId, acId],
      [doubleId, minibarId],
      [suiteId, wifiId],
      [suiteId, acId],
      [suiteId, minibarId],
    ] as const) {
      await q(
        `INSERT INTO room_type_amenity (room_type_id, amenity_id) VALUES ($1::uuid, $2::uuid)
         ON CONFLICT (room_type_id, amenity_id) DO NOTHING`,
        [typeId, amenityId],
      );
    }

    // Colombo carries most inventory so one branch can exercise the whole
    // book/check-in/out/cancel/no-show lifecycle; Kandy and Galle prove
    // cross-branch availability and administration.
    const roomSpec: { branchId: string; number: string; typeId: string; condition?: string }[] = [
      { branchId: colomboId, number: '101', typeId: singleId },
      { branchId: colomboId, number: '102', typeId: singleId },
      { branchId: colomboId, number: '103', typeId: doubleId },
      { branchId: colomboId, number: '104', typeId: doubleId },
      { branchId: colomboId, number: '105', typeId: suiteId },
      { branchId: colomboId, number: '106', typeId: doubleId },
      { branchId: colomboId, number: '108', typeId: singleId },
      { branchId: colomboId, number: '109', typeId: singleId, condition: 'OUT_OF_SERVICE' },
      { branchId: kandyId, number: '201', typeId: singleId, condition: 'CLEANING' },
      { branchId: kandyId, number: '202', typeId: doubleId },
      { branchId: galleId, number: '301', typeId: doubleId },
      { branchId: galleId, number: '302', typeId: suiteId },
    ];
    const roomIds: Record<string, string> = {};
    const conditionHistorySupported = await hasRoomStatusReasonColumn(ctx);
    if (!conditionHistorySupported) {
      log(
        'Warning: room_status_history lacks its reason column on this database, so the audited ' +
          'fn_set_room_condition cannot run; seeding initial conditions with an equivalent guarded write.',
      );
    }
    for (const spec of roomSpec) {
      const roomId = await ensureRoom(ctx, spec.branchId, spec.number, spec.typeId);
      roomIds[spec.number] = roomId;
      if (spec.condition) {
        await ensureRoomCondition(
          ctx,
          roomId,
          spec.condition,
          serviceStaffId,
          `Demo seed initial condition (${spec.condition})`,
          conditionHistorySupported,
        );
      }
    }

    log('Creating service catalogue...');
    const serviceIds: Record<string, string> = {};
    for (const [key, name, category, price] of [
      ['roomService', 'Demo Room Service', 'Food and Beverage', '1500.00'],
      ['breakfast', 'Demo Breakfast', 'Food and Beverage', '2200.00'],
      ['minibar', 'Demo Minibar', 'Food and Beverage', '900.00'],
      ['spa', 'Demo Spa Treatment', 'Wellness', '8500.00'],
      ['laundry', 'Demo Laundry', 'Housekeeping', '1200.00'],
      ['airport', 'Demo Airport Pickup', 'Transport', '6500.00'],
    ] as const) {
      serviceIds[key] = await ensureService(ctx, name, category, price);
    }

    log('Creating guest profiles and the online guest link...');
    const guestIds: Record<string, string> = {};
    for (const [key, fullName, email, phone, nic] of [
      ['guest1', 'Demo Guest One', 'demo.guest1@skynest.test', '+94710000001', 'DEMO-GUEST-0001'],
      ['guest2', 'Demo Guest Two', 'demo.guest2@skynest.test', '+94710000002', 'DEMO-GUEST-0002'],
      ['guest3', 'Demo Guest Three', 'demo.guest3@skynest.test', '+94710000003', 'DEMO-GUEST-0003'],
      ['guest4', 'Demo Guest Four', 'demo.guest4@skynest.test', '+94710000004', 'DEMO-GUEST-0004'],
      ['guest5', 'Demo Guest Five', 'demo.guest5@skynest.test', '+94710000005', 'DEMO-GUEST-0005'],
    ] as const) {
      guestIds[key] = await ensureGuest(ctx, fullName, email, phone, nic);
    }
    await q(
      `INSERT INTO guest_account (guest_id, user_id) VALUES ($1::uuid, $2::uuid)
       ON CONFLICT (guest_id) DO NOTHING`,
      [guestIds.guest1, onlineGuestUserId],
    );

    log('Publishing a non-demo billing policy (required for confirmations)...');
    const today: string = (
      await q(`SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date, 'YYYY-MM-DD') AS today`)
    )[0].today;
    const billingPolicyId = await ensureBillingPolicy(ctx, chainManagerId, addDays(today, -30));

    // The session idle timeout is an approved non-financial setting; only a
    // SYSTEM_ADMINISTRATOR may write it, so seed it if it is not set yet.
    await q(
      `INSERT INTO system_config (config_key, config_value, effective_from, updated_by, updated_at)
       VALUES ('session_idle_timeout_minutes', '30', CURRENT_DATE, $1::uuid, clock_timestamp())
       ON CONFLICT (config_key) DO NOTHING`,
      [adminId],
    );

    log('Creating demonstration bookings and their lifecycle...');
    let bookingsCreated = 0;

    // DEMO-01: future two-line booking (Single + Double at different base
    // rates), part-paid to leave an outstanding balance on a DRAFT invoice.
    const bookingA = await createStaffBooking(ctx, {
      ref: `${BOOKING_REF_PREFIX}01`,
      guestId: guestIds.guest1,
      branchId: colomboId,
      channel: 'FRONT_DESK',
      actorId: frontDeskId,
      policyId: billingPolicyId,
      lines: [
        await quotedLine(ctx, roomIds['101'], addDays(today, 14), addDays(today, 17), 1),
        await quotedLine(ctx, roomIds['103'], addDays(today, 14), addDays(today, 17), 2),
      ],
    });
    if (bookingA.created) bookingsCreated += 1;
    await payPartial(ctx, bookingA.bookingId, frontDeskId, 0.4, `${BOOKING_REF_PREFIX}01-PAY-1`);

    // DEMO-02: two simultaneous Single rooms at the same base rate. One line is
    // checked in (active stay) while the sibling stays BOOKED; a room-attributed
    // and a booking-wide unallocated service are recorded, and one mistaken
    // charge is voided.
    const bookingB = await createStaffBooking(ctx, {
      ref: `${BOOKING_REF_PREFIX}02`,
      guestId: guestIds.guest2,
      branchId: colomboId,
      channel: 'PHONE',
      actorId: frontDeskId,
      policyId: billingPolicyId,
      lines: [
        await quotedLine(ctx, roomIds['102'], today, addDays(today, 3), 1),
        await quotedLine(ctx, roomIds['108'], today, addDays(today, 3), 1),
      ],
    });
    if (bookingB.created) bookingsCreated += 1;
    const bLines = await linesOf(ctx, bookingB.bookingId);
    const bLine = bLines.find((line) => line.room_number === '102') ?? bLines[0];
    await ensureCheckedIn(ctx, bLine, frontDeskId);
    await ensureServiceUsage(ctx, bookingB.bookingId, serviceIds.laundry, 2, frontDeskId, bLine.line_id);
    await ensureServiceUsage(ctx, bookingB.bookingId, serviceIds.roomService, 1, frontDeskId, null);
    await ensureVoidedServiceUsage(ctx, bookingB.bookingId, serviceIds.minibar, 1, branchManagerId);
    await payPartial(ctx, bookingB.bookingId, frontDeskId, 0.5, `${BOOKING_REF_PREFIX}02-PAY-1`);

    // DEMO-03: an in-house stay paid in full and checked out, so the invoice
    // finalises with a room charge plus a service.
    const bookingC = await createStaffBooking(ctx, {
      ref: `${BOOKING_REF_PREFIX}03`,
      guestId: guestIds.guest3,
      branchId: colomboId,
      channel: 'EMAIL',
      actorId: frontDeskId,
      policyId: billingPolicyId,
      lines: [await quotedLine(ctx, roomIds['103'], addDays(today, -2), addDays(today, 1), 2)],
    });
    if (bookingC.created) bookingsCreated += 1;
    const cLine = (await linesOf(ctx, bookingC.bookingId))[0];
    await ensureCheckedIn(ctx, cLine, frontDeskId);
    await ensureServiceUsage(ctx, bookingC.bookingId, serviceIds.breakfast, 2, frontDeskId, cLine.line_id);
    await settleBalance(ctx, bookingC.bookingId, frontDeskId, `${BOOKING_REF_PREFIX}03-PAY-1`);
    if (conditionHistorySupported) {
      await ensureCheckedOut(ctx, bookingC.bookingId, cLine.line_id, frontDeskId);
    } else {
      // fn_checkout_room_line releases the room to CLEANING through
      // fn_set_room_condition, which cannot run on a database whose
      // room_status_history predates the reason column. Leave this stay settled
      // and checked in rather than fail the whole seed.
      log(
        'Skipping DEMO-03 checkout: the audited room-condition operation is unavailable on this ' +
          'database, so the checkout transaction cannot run here. Use an isolated schema for a FINAL invoice.',
      );
    }

    // DEMO-04: a future booking cancelled before the linked-policy cutoff, so a
    // cancellation fee is billed and part-paid.
    const bookingD = await createStaffBooking(ctx, {
      ref: `${BOOKING_REF_PREFIX}04`,
      guestId: guestIds.guest4,
      branchId: colomboId,
      channel: 'FRONT_DESK',
      actorId: frontDeskId,
      policyId: billingPolicyId,
      lines: [await quotedLine(ctx, roomIds['104'], addDays(today, 10), addDays(today, 12), 1)],
    });
    if (bookingD.created) bookingsCreated += 1;
    const dLine = (await linesOf(ctx, bookingD.bookingId))[0];
    if (dLine.status === 'BOOKED') {
      // The database supplies the cancellation instant so the new history row
      // always sorts after the initial BOOKED row on the same clock.
      await q('SELECT * FROM fn_cancel_room_line($1::uuid, $2::uuid, $3::uuid, $4::varchar)', [
        bookingD.bookingId,
        dLine.line_id,
        frontDeskId,
        'Demo cancellation before cutoff',
      ]);
    }
    await payPartial(ctx, bookingD.bookingId, frontDeskId, 0.4, `${BOOKING_REF_PREFIX}04-PAY-1`);

    // DEMO-05: a past stay marked NO_SHOW after the linked-policy cutoff.
    const bookingE = await createStaffBooking(ctx, {
      ref: `${BOOKING_REF_PREFIX}05`,
      guestId: guestIds.guest5,
      branchId: colomboId,
      channel: 'PHONE',
      actorId: frontDeskId,
      policyId: billingPolicyId,
      lines: [await quotedLine(ctx, roomIds['105'], addDays(today, -5), addDays(today, -2), 2)],
    });
    if (bookingE.created) bookingsCreated += 1;
    const eLine = (await linesOf(ctx, bookingE.bookingId))[0];
    if (eLine.status === 'BOOKED') {
      await q('SELECT * FROM fn_mark_no_show_room_line($1::uuid, $2::uuid, $3::uuid, $4::varchar)', [
        bookingE.bookingId,
        eLine.line_id,
        frontDeskId,
        'Demo no-show after cutoff',
      ]);
    }

    // DEMO-06: a genuine DIRECT_ONLINE booking placed by the linked guest
    // account, proving online ownership and the guest booking list.
    const bookingF = await ensureOnlineBooking(ctx, {
      ref: `${BOOKING_REF_PREFIX}06`,
      userId: onlineGuestUserId,
      branchId: kandyId,
      policyId: billingPolicyId,
      lines: [await quotedLine(ctx, roomIds['202'], addDays(today, 20), addDays(today, 22), 1)],
    });
    if (bookingF.created) bookingsCreated += 1;
    await payPartial(ctx, bookingF.bookingId, frontDeskId, 0.3, `${BOOKING_REF_PREFIX}06-PAY-1`);

    log('Creating a dated room block to demonstrate unavailability...');
    await ensureRoomBlock(ctx, roomIds['106'], addDays(today, 20), addDays(today, 22), frontDeskId, 'Demo maintenance block');

    const counts = await countDemoData(ctx);
    log(`Done. Bookings created this run: ${bookingsCreated}.`);

    return {
      counts,
      billingPolicyId,
      credentials: [
        { username: 'demo.chain', password: DEMO_PASSWORD },
        { username: 'demo.frontdesk', password: DEMO_PASSWORD },
        { username: 'demo.service', password: DEMO_PASSWORD },
        { username: 'demo.branchmanager', password: DEMO_PASSWORD },
        { username: 'demo.admin', password: DEMO_PASSWORD },
        { username: 'demo.auditor', password: DEMO_PASSWORD },
        { username: 'demo.frontdesk.kandy', password: DEMO_PASSWORD },
        { username: 'demo.guest', password: DEMO_PASSWORD },
      ],
    };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Catalogue helpers

async function ensureBranch(ctx: SeedContext, name: string, city: string, address: string): Promise<string> {
  const existing = await ctx.q(
    `SELECT branch_id FROM branch WHERE name = $1 AND city = $2 ORDER BY created_at, branch_id LIMIT 1`,
    [name, city],
  );
  if (existing[0]) return existing[0].branch_id;
  const inserted = await ctx.q(
    `INSERT INTO branch (name, city, address) VALUES ($1, $2, $3) RETURNING branch_id`,
    [name, city, address],
  );
  return inserted[0].branch_id;
}

async function loadRoles(ctx: SeedContext): Promise<Record<string, string>> {
  const rows = await ctx.q('SELECT role_name, role_id FROM role');
  const map: Record<string, string> = {};
  for (const row of rows) map[row.role_name] = row.role_id;
  for (const required of [
    'CHAIN_MANAGER',
    'FRONT_DESK',
    'SERVICE_STAFF',
    'BRANCH_MANAGER',
    'SYSTEM_ADMINISTRATOR',
    'AUDITOR',
  ]) {
    if (!map[required]) throw new Error(`Required seeded role ${required} is missing; run migrations first.`);
  }
  return map;
}

async function ensureUserAccount(ctx: SeedContext, passwordHash: string, username: string): Promise<string> {
  const existing = await ctx.q('SELECT user_id FROM user_account WHERE username = $1', [username]);
  if (existing[0]) return existing[0].user_id;
  const inserted = await ctx.q(
    `INSERT INTO user_account (username, password_hash, active) VALUES ($1, $2, true)
     ON CONFLICT (username) DO NOTHING RETURNING user_id`,
    [username, passwordHash],
  );
  if (inserted[0]) return inserted[0].user_id;
  const fallback = await ctx.q('SELECT user_id FROM user_account WHERE username = $1', [username]);
  return fallback[0].user_id;
}

interface StaffSpec {
  username: string;
  fullName: string;
  roleId: string;
  branchId: string;
  email?: string;
  phone?: string;
  nic?: string;
}

async function ensureStaff(ctx: SeedContext, passwordHash: string, spec: StaffSpec): Promise<string> {
  const userId = await ensureUserAccount(ctx, passwordHash, spec.username);
  const existingOfficer = await ctx.q('SELECT officer_id FROM officer WHERE officer_id = $1', [userId]);
  if (existingOfficer[0]) return userId;
  await ctx.q(
    `INSERT INTO officer (officer_id, full_name, email, phone, nic, role_id, branch_id, active)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, true)
     ON CONFLICT (officer_id) DO NOTHING`,
    [userId, spec.fullName, spec.email ?? null, spec.phone ?? null, spec.nic ?? null, spec.roleId, spec.branchId],
  );
  return userId;
}

async function ensureRoomType(ctx: SeedContext, name: string, capacity: number, baseDailyRate: string): Promise<string> {
  const existing = await ctx.q('SELECT room_type_id FROM room_type WHERE name = $1 ORDER BY room_type_id LIMIT 1', [name]);
  if (existing[0]) return existing[0].room_type_id;
  const inserted = await ctx.q(
    `INSERT INTO room_type (name, capacity, base_daily_rate) VALUES ($1, $2, $3::numeric) RETURNING room_type_id`,
    [name, capacity, baseDailyRate],
  );
  return inserted[0].room_type_id;
}

async function ensureAmenity(ctx: SeedContext, name: string, description: string): Promise<string> {
  const existing = await ctx.q('SELECT amenity_id FROM amenity WHERE name = $1 ORDER BY amenity_id LIMIT 1', [name]);
  if (existing[0]) return existing[0].amenity_id;
  const inserted = await ctx.q(
    `INSERT INTO amenity (name, description) VALUES ($1, $2) RETURNING amenity_id`,
    [name, description],
  );
  return inserted[0].amenity_id;
}

async function ensureRoom(ctx: SeedContext, branchId: string, roomNumber: string, roomTypeId: string): Promise<string> {
  const existing = await ctx.q('SELECT room_id FROM room WHERE branch_id = $1::uuid AND room_number = $2', [
    branchId,
    roomNumber,
  ]);
  if (existing[0]) return existing[0].room_id;
  const inserted = await ctx.q(
    `INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2::uuid, $3::uuid) RETURNING room_id`,
    [roomNumber, branchId, roomTypeId],
  );
  return inserted[0].room_id;
}

// The published m3_002/m3_005 mock chain used CREATE TABLE IF NOT EXISTS, so a
// database whose room_status_history predates the reason column keeps a table
// the audited fn_set_room_condition cannot write to. Detect that once and use an
// equivalent guarded write (condition + history) when it is missing.
async function hasRoomStatusReasonColumn(ctx: SeedContext): Promise<boolean> {
  const rows = await ctx.q(
    `SELECT 1 AS present FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'room_status_history'
        AND column_name = 'reason'`,
  );
  return rows.length > 0;
}

async function ensureRoomCondition(
  ctx: SeedContext,
  roomId: string,
  condition: string,
  actorId: string,
  reason: string,
  auditedOperationSupported: boolean,
): Promise<void> {
  if (auditedOperationSupported) {
    await ctx.q('SELECT fn_set_room_condition($1::uuid, $2::room_condition_enum, $3::uuid, $4::varchar)', [
      roomId,
      condition,
      actorId,
      reason,
    ]);
    return;
  }
  const current = await ctx.q('SELECT operational_status::text AS status FROM room WHERE room_id = $1::uuid', [roomId]);
  const oldStatus = current[0]?.status;
  if (!oldStatus || oldStatus === condition) return;
  // Mirrors the guarded part of fn_set_room_condition. No history row is written
  // because this drifted table also uses a pre-normalization enum type; the
  // m2 room-inventory guard still enforces the OUT_OF_SERVICE rule.
  await ctx.q('UPDATE room SET operational_status = $2::room_condition_enum WHERE room_id = $1::uuid', [
    roomId,
    condition,
  ]);
}

async function ensureService(ctx: SeedContext, name: string, category: string, price: string): Promise<string> {
  const existing = await ctx.q('SELECT service_id FROM service WHERE name = $1', [name]);
  if (existing[0]) return existing[0].service_id;
  const inserted = await ctx.q(
    `INSERT INTO service (name, category, current_price) VALUES ($1, $2, $3::numeric) RETURNING service_id`,
    [name, category, price],
  );
  return inserted[0].service_id;
}

async function ensureGuest(ctx: SeedContext, fullName: string, email: string, phone: string, nic: string): Promise<string> {
  const existing = await ctx.q('SELECT guest_id FROM guest WHERE nic = $1', [nic.toUpperCase()]);
  if (existing[0]) return existing[0].guest_id;
  const inserted = await ctx.q(
    `INSERT INTO guest (full_name, email, phone, nic) VALUES ($1, $2, $3, $4) RETURNING guest_id`,
    [fullName, email, phone, nic.toUpperCase()],
  );
  return inserted[0].guest_id;
}

async function ensureBillingPolicy(ctx: SeedContext, chainManagerId: string, effectiveFrom: string): Promise<string> {
  const existing = await ctx.q(
    `SELECT billing_policy_id FROM billing_policy
      WHERE created_by = $1::uuid AND NOT is_demo
      ORDER BY effective_from DESC, created_at DESC, billing_policy_id DESC LIMIT 1`,
    [chainManagerId],
  );
  if (existing[0]) return existing[0].billing_policy_id;
  // Append-only publication by an active CHAIN_MANAGER; created_at is set by the
  // database and the publication is audited in the same transaction.
  const inserted = await ctx.q(
    `INSERT INTO billing_policy
       (effective_from, tax_percent, service_charge_percent, max_discount_percent,
        cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days, is_demo, created_by)
     VALUES ($1, 18, 10, 20, 5000, 8000, 3000, 1, false, $2::uuid)
     RETURNING billing_policy_id`,
    [effectiveFrom, chainManagerId],
  );
  return inserted[0].billing_policy_id;
}

// ---------------------------------------------------------------------------
// Booking helpers

async function quotedLine(
  ctx: SeedContext,
  roomId: string,
  checkIn: string,
  checkOut: string,
  guestCount: number,
): Promise<Row> {
  const room = await ctx.q(
    `SELECT r.room_id, r.room_type_id, t.base_daily_rate
       FROM room r JOIN room_type t ON t.room_type_id = r.room_type_id
      WHERE r.room_id = $1::uuid`,
    [roomId],
  );
  if (!room[0]) throw new Error(`Demo room ${roomId} was not found.`);
  return {
    roomId: room[0].room_id,
    checkIn,
    checkOut,
    guestCount,
    quotedRoomTypeId: room[0].room_type_id,
    quotedBaseDailyRate: money(room[0].base_daily_rate),
  };
}

interface StaffBookingSpec {
  ref: string;
  guestId: string;
  branchId: string;
  channel: string;
  actorId: string;
  policyId: string;
  lines: Row[];
}

async function createStaffBooking(
  ctx: SeedContext,
  spec: StaffBookingSpec,
): Promise<{ bookingId: string; invoiceId: string; created: boolean }> {
  const existing = await ctx.q(
    `SELECT b.booking_id, i.invoice_id
       FROM booking b JOIN invoice i ON i.booking_id = b.booking_id
      WHERE b.booking_ref = $1`,
    [spec.ref],
  );
  if (existing[0]) {
    return { bookingId: existing[0].booking_id, invoiceId: existing[0].invoice_id, created: false };
  }
  const created = await ctx.q(
    `SELECT booking_id, invoice_id
       FROM sp_create_booking($1::uuid, $2::booking_channel_enum, $3::uuid, $4::uuid, $5::uuid, $6::jsonb)`,
    [spec.guestId, spec.channel, spec.actorId, spec.branchId, spec.policyId, JSON.stringify(spec.lines)],
  );
  const bookingId = created[0].booking_id;
  // A stable demonstration reference makes re-runs idempotent and the UI readable.
  await ctx.q('UPDATE booking SET booking_ref = $2 WHERE booking_id = $1::uuid', [bookingId, spec.ref]);
  return { bookingId, invoiceId: created[0].invoice_id, created: true };
}

interface OnlineBookingSpec {
  ref: string;
  userId: string;
  branchId: string;
  policyId: string;
  lines: Row[];
}

async function ensureOnlineBooking(
  ctx: SeedContext,
  spec: OnlineBookingSpec,
): Promise<{ bookingId: string; created: boolean }> {
  const existing = await ctx.q('SELECT booking_id FROM booking WHERE booking_ref = $1', [spec.ref]);
  if (existing[0]) return { bookingId: existing[0].booking_id, created: false };
  const created = await ctx.q(
    `SELECT booking_id FROM sp_create_online_guest_booking($1::uuid, $2::uuid, $3::uuid, $4::jsonb)`,
    [spec.userId, spec.branchId, spec.policyId, JSON.stringify(spec.lines)],
  );
  const bookingId = created[0].booking_id;
  await ctx.q('UPDATE booking SET booking_ref = $2 WHERE booking_id = $1::uuid', [bookingId, spec.ref]);
  return { bookingId, created: true };
}

async function linesOf(ctx: SeedContext, bookingId: string): Promise<Row[]> {
  return ctx.q(
    `SELECT l.line_id, l.status::text AS status, a.room_id, r.room_number
       FROM booking_room_line l
       LEFT JOIN booking_room_assignment a ON a.line_id = l.line_id
       LEFT JOIN room r ON r.room_id = a.room_id
      WHERE l.booking_id = $1::uuid
      ORDER BY r.room_number`,
    [bookingId],
  );
}

// Reuses Member 3's production check-in service (which owns its transaction and
// revalidates the room, timing and lifecycle guards) rather than hand-writing
// the transition.
async function ensureCheckedIn(ctx: SeedContext, line: Row | undefined, actorId: string): Promise<void> {
  if (!line || line.status !== 'BOOKED') return;
  await checkInRoomLine(ctx.client as never, { lineId: line.line_id, actorId, schema: ctx.schema });
}

async function ensureCheckedOut(ctx: SeedContext, bookingId: string, lineId: string, actorId: string): Promise<void> {
  // Re-read the current status: the row fetched before check-in is stale.
  const current = await ctx.q('SELECT status::text AS status FROM booking_room_line WHERE line_id = $1::uuid', [
    lineId,
  ]);
  if (current[0]?.status !== 'CHECKED_IN') return;
  await ctx.q('SELECT * FROM fn_checkout_room_line($1::uuid, $2::uuid, $3::uuid)', [bookingId, lineId, actorId]);
}

async function ensureServiceUsage(
  ctx: SeedContext,
  bookingId: string,
  serviceId: string,
  quantity: number,
  actorId: string,
  bookingRoomLineId: string | null,
): Promise<void> {
  // recordServiceUsage owns its transaction and refreshes the DRAFT invoice.
  const existing = await ctx.q(
    `SELECT 1 FROM service_usage WHERE booking_id = $1::uuid AND service_id = $2::uuid AND voided IS NOT TRUE`,
    [bookingId, serviceId],
  );
  if (existing[0]) return;
  await recordServiceUsage(ctx.client as never, {
    bookingId,
    serviceId,
    quantity,
    recordedBy: actorId,
    bookingRoomLineId: bookingRoomLineId ?? undefined,
  });
}

async function ensureVoidedServiceUsage(
  ctx: SeedContext,
  bookingId: string,
  serviceId: string,
  quantity: number,
  voidedBy: string,
): Promise<void> {
  const existing = await ctx.q(
    'SELECT usage_id, voided FROM service_usage WHERE booking_id = $1::uuid AND service_id = $2::uuid LIMIT 1',
    [bookingId, serviceId],
  );
  if (existing[0]) {
    if (existing[0].voided !== true) {
      await voidServiceUsage(ctx.client as never, {
        usageId: existing[0].usage_id,
        voidedBy,
        reason: 'Demo seed: mistaken charge reversed',
      });
    }
    return;
  }
  const usage = await recordServiceUsage(ctx.client as never, {
    bookingId,
    serviceId,
    quantity,
    recordedBy: voidedBy,
  });
  await voidServiceUsage(ctx.client as never, {
    usageId: usage.usageId,
    voidedBy,
    reason: 'Demo seed: mistaken charge reversed',
  });
}

async function payPartial(
  ctx: SeedContext,
  bookingId: string,
  actorId: string,
  fraction: number,
  reference: string,
): Promise<void> {
  const existing = await ctx.q('SELECT 1 FROM payment WHERE reference = $1', [reference]);
  if (existing[0]) return;
  const balance = Number((await ctx.q('SELECT balance FROM fn_booking_balance($1::uuid)', [bookingId]))[0]?.balance ?? 0);
  const amount = Math.round(balance * fraction * 100) / 100;
  if (!(amount > 0)) return;
  await ctx.q(
    `SELECT * FROM fn_record_payment($1::uuid, $2::uuid, 'PAYMENT'::payment_kind_enum,
        $3::numeric, 'CASH'::payment_method_enum, $4::varchar)`,
    [bookingId, actorId, amount.toFixed(2), reference],
  );
}

async function settleBalance(ctx: SeedContext, bookingId: string, actorId: string, reference: string): Promise<void> {
  const existing = await ctx.q('SELECT 1 FROM payment WHERE reference = $1', [reference]);
  if (existing[0]) return;
  const balance = Number((await ctx.q('SELECT balance FROM fn_booking_balance($1::uuid)', [bookingId]))[0]?.balance ?? 0);
  if (!(balance > 0)) return;
  await ctx.q(
    `SELECT * FROM fn_record_payment($1::uuid, $2::uuid, 'PAYMENT'::payment_kind_enum,
        $3::numeric, 'CASH'::payment_method_enum, $4::varchar)`,
    [bookingId, actorId, balance.toFixed(2), reference],
  );
}

async function ensureRoomBlock(
  ctx: SeedContext,
  roomId: string,
  startDate: string,
  endDate: string,
  actorId: string,
  reason: string,
): Promise<void> {
  const existing = await ctx.q(
    `SELECT 1 FROM room_block WHERE room_id = $1::uuid AND start_date = $2 AND end_date = $3`,
    [roomId, startDate, endDate],
  );
  if (existing[0]) return;
  await ctx.q(
    `INSERT INTO room_block (room_id, start_date, end_date, reason, created_by)
     VALUES ($1::uuid, $2, $3, $4, $5::uuid)`,
    [roomId, startDate, endDate, reason, actorId],
  );
}

async function countDemoData(ctx: SeedContext): Promise<SeedDemoResult['counts']> {
  const scalar = async (sql: string): Promise<number> => Number((await ctx.q(sql))[0]?.n ?? 0);
  return {
    accounts: await scalar(`SELECT count(*)::int AS n FROM user_account WHERE username LIKE 'demo.%'`),
    roomTypes: await scalar(`SELECT count(*)::int AS n FROM room_type WHERE name LIKE 'Demo %'`),
    amenities: await scalar(`SELECT count(*)::int AS n FROM amenity WHERE name LIKE 'Demo %'`),
    rooms: await scalar(`SELECT count(*)::int AS n FROM room WHERE room_number IN
      ('101','102','103','104','105','106','108','109','201','202','301','302')`),
    services: await scalar(`SELECT count(*)::int AS n FROM service WHERE name LIKE 'Demo %'`),
    guests: await scalar(`SELECT count(*)::int AS n FROM guest WHERE nic LIKE 'DEMO-GUEST-%'`),
    bookings: await scalar(`SELECT count(*)::int AS n FROM booking WHERE booking_ref LIKE '${BOOKING_REF_PREFIX}%'`),
    payments: await scalar(`SELECT count(*)::int AS n FROM payment WHERE reference LIKE '${BOOKING_REF_PREFIX}%'`),
    serviceUsages: await scalar(
      `SELECT count(*)::int AS n FROM service_usage su
        JOIN service s ON s.service_id = su.service_id WHERE s.name LIKE 'Demo %'`,
    ),
  };
}
