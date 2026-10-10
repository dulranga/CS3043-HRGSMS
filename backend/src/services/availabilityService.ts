import { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../db';

const availabilitySchema = process.env.PG_SCHEMA;
if (availabilitySchema && !/^[a-z_][a-z0-9_]*$/.test(availabilitySchema)) {
  throw new Error('PG_SCHEMA must be a lowercase PostgreSQL identifier.');
}

export interface AvailabilitySearchInput {
  branchId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  immediateCheckIn: boolean;
  roomTypeId: string | null;
}

export interface AvailabilityOptionsDto {
  branches: { branchId: string; name: string; city: string }[];
  roomTypes: { roomTypeId: string; name: string }[];
}

// Public search choices contain hotel catalogue labels only, never identities,
// administrative metadata or a second writable copy of inventory.
export async function getAvailabilityOptions(): Promise<AvailabilityOptionsDto> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (availabilitySchema) await client.query(`SET LOCAL search_path TO "${availabilitySchema}", public`);
    const branches = await client.query<{ branchId: string; name: string; city: string }>(
      `SELECT branch_id AS "branchId", name, city FROM branch
        WHERE active = true ORDER BY name, branch_id`,
    );
    const roomTypes = await client.query<{ roomTypeId: string; name: string }>(
      `SELECT room_type_id AS "roomTypeId", name FROM room_type
        WHERE active = true ORDER BY name, room_type_id`,
    );
    await client.query('COMMIT');
    return { branches: branches.rows, roomTypes: roomTypes.rows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export interface AvailabilityShowcaseDto {
  stats: { branchCount: number; cityCount: number; roomCount: number; roomTypeCount: number };
  roomTypes: {
    roomTypeId: string;
    name: string;
    capacity: number;
    baseDailyRate: string;
    roomCount: number;
    amenities: string[];
    branches: { branchId: string; name: string; city: string }[];
  }[];
}

// Public home-page summary derived from live inventory: only active branches,
// active rooms and active room types/amenities. No booking or guest data.
export async function getAvailabilityShowcase(): Promise<AvailabilityShowcaseDto> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (availabilitySchema) await client.query(`SET LOCAL search_path TO "${availabilitySchema}", public`);
    const stats = await client.query<AvailabilityShowcaseDto['stats']>(
      `SELECT (SELECT count(*) FROM branch WHERE active)::int AS "branchCount",
              (SELECT count(DISTINCT lower(btrim(city))) FROM branch WHERE active)::int AS "cityCount",
              (SELECT count(*) FROM room r
                 JOIN branch b ON b.branch_id = r.branch_id AND b.active
                 JOIN room_type t ON t.room_type_id = r.room_type_id AND t.active
                WHERE r.active)::int AS "roomCount",
              (SELECT count(DISTINCT r.room_type_id) FROM room r
                 JOIN branch b ON b.branch_id = r.branch_id AND b.active
                 JOIN room_type t ON t.room_type_id = r.room_type_id AND t.active
                WHERE r.active)::int AS "roomTypeCount"`,
    );
    const roomTypes = await client.query<AvailabilityShowcaseDto['roomTypes'][number]>(
      `SELECT t.room_type_id AS "roomTypeId",
              t.name,
              t.capacity::int AS capacity,
              t.base_daily_rate::text AS "baseDailyRate",
              count(r.room_id)::int AS "roomCount",
              COALESCE((SELECT array_agg(a.name ORDER BY a.name)
                          FROM room_type_amenity ta
                          JOIN amenity a ON a.amenity_id = ta.amenity_id AND a.active
                         WHERE ta.room_type_id = t.room_type_id), '{}') AS amenities,
              jsonb_agg(DISTINCT jsonb_build_object('branchId', b.branch_id, 'name', b.name, 'city', b.city)) AS branches
         FROM room_type t
         JOIN room r ON r.room_type_id = t.room_type_id AND r.active
         JOIN branch b ON b.branch_id = r.branch_id AND b.active
        WHERE t.active
        GROUP BY t.room_type_id
        ORDER BY t.base_daily_rate, t.name, t.room_type_id`,
    );
    await client.query('COMMIT');
    return {
      stats: stats.rows[0],
      roomTypes: roomTypes.rows.map(row => ({
        ...row,
        branches: [...row.branches].sort((a, b) => a.name.localeCompare(b.name)),
      })),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

interface AmenityRow {
  amenity_id: string;
  name: string;
  description: string | null;
}

interface AvailableRoomRow extends QueryResultRow {
  room_id: string;
  room_number: string;
  operational_status: 'READY' | 'CLEANING';
  branch_id: string;
  room_type_id: string;
  room_type_name: string;
  room_type_capacity: number;
  base_daily_rate: string;
  amenities: AmenityRow[];
}

export interface AvailabilityAmenityDto {
  amenityId: string;
  name: string;
  description: string | null;
}

export interface AvailableRoomDto {
  roomId: string;
  roomNumber: string;
  operationalStatus: 'READY' | 'CLEANING';
  branchId: string;
  roomType: {
    roomTypeId: string;
    name: string;
    capacity: number;
    baseDailyRate: string;
    amenities: AvailabilityAmenityDto[];
  };
}

function mapAvailableRoom(row: AvailableRoomRow): AvailableRoomDto {
  return {
    roomId: row.room_id,
    roomNumber: row.room_number,
    operationalStatus: row.operational_status,
    branchId: row.branch_id,
    roomType: {
      roomTypeId: row.room_type_id,
      name: row.room_type_name,
      capacity: row.room_type_capacity,
      baseDailyRate: row.base_daily_rate,
      amenities: row.amenities.map((amenity) => ({
        amenityId: amenity.amenity_id,
        name: amenity.name,
        description: amenity.description,
      })),
    },
  };
}

async function beginAvailabilityRead(client: PoolClient): Promise<void> {
  await client.query('BEGIN READ ONLY');
  if (availabilitySchema) {
    await client.query(`SET LOCAL search_path TO "${availabilitySchema}", public`);
  }
}

export async function findAvailableRooms(
  input: AvailabilitySearchInput,
): Promise<AvailableRoomDto[]> {
  const client = await pool.connect();
  try {
    await beginAvailabilityRead(client);
    const result = await client.query<AvailableRoomRow>(
      `SELECT room_id,
              room_number,
              operational_status,
              branch_id,
              room_type_id,
              room_type_name,
              room_type_capacity,
              base_daily_rate::text,
              amenities
         FROM fn_available_rooms($1, $2, $3, $4, $5, $6)
        ORDER BY room_type_name, room_number, room_id`,
      [
        input.branchId,
        input.checkIn,
        input.checkOut,
        input.guestCount,
        input.immediateCheckIn,
        input.roomTypeId,
      ],
    );
    await client.query('COMMIT');
    return result.rows.map(mapAvailableRoom);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
