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
