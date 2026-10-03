import { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../db';

type Queryable = Pick<PoolClient, 'query'>;

const catalogueSchema = process.env.PG_SCHEMA;
if (catalogueSchema && !/^[a-z_][a-z0-9_]*$/.test(catalogueSchema)) {
  throw new Error('PG_SCHEMA must be a lowercase PostgreSQL identifier.');
}

async function acquireClient(): Promise<PoolClient> {
  return pool.connect();
}

async function releaseClient(client: PoolClient): Promise<void> {
  client.release();
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await acquireClient();
  try {
    await client.query('BEGIN');
    if (catalogueSchema) {
      await client.query(`SET LOCAL search_path TO "${catalogueSchema}", public`);
    }
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await releaseClient(client);
  }
}

export class CatalogueValidationError extends Error {}
export class CatalogueNotFoundError extends Error {}
export class CatalogueConflictError extends Error {}

export interface CatalogueFilters {
  search: string;
  active: boolean | null;
}

export interface RoomTypeInput {
  name: string;
  capacity: number;
  baseDailyRate: string;
  active: boolean;
  amenityIds: string[];
}

export interface RoomTypePatch {
  name?: string;
  capacity?: number;
  baseDailyRate?: string;
  active?: boolean;
  amenityIds?: string[];
}

export interface AmenityInput {
  name: string;
  description: string | null;
  active: boolean;
}

export interface AmenityPatch {
  name?: string;
  description?: string | null;
  active?: boolean;
}

interface AmenityRow extends QueryResultRow {
  amenity_id: string;
  name: string;
  description: string | null;
  active: boolean;
}

interface RoomTypeRow extends QueryResultRow {
  room_type_id: string;
  name: string;
  capacity: number;
  base_daily_rate: string;
  active: boolean;
  amenities: AmenityRow[];
}

export interface AmenityDto {
  amenityId: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface RoomTypeDto {
  roomTypeId: string;
  name: string;
  capacity: number;
  baseDailyRate: string;
  active: boolean;
  amenities: AmenityDto[];
}

const ROOM_TYPE_SELECT = `
  SELECT target_type.room_type_id,
         target_type.name,
         target_type.capacity,
         target_type.base_daily_rate::text,
         target_type.active,
         COALESCE((
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'amenity_id', linked_amenity.amenity_id,
                      'name', linked_amenity.name,
                      'description', linked_amenity.description,
                      'active', linked_amenity.active
                    )
                    ORDER BY linked_amenity.name, linked_amenity.amenity_id
                  )
             FROM room_type_amenity AS link
             JOIN amenity AS linked_amenity
               ON linked_amenity.amenity_id = link.amenity_id
            WHERE link.room_type_id = target_type.room_type_id
         ), '[]'::jsonb) AS amenities
    FROM room_type AS target_type
`;

function mapAmenity(row: AmenityRow): AmenityDto {
  return {
    amenityId: row.amenity_id,
    name: row.name,
    description: row.description,
    active: row.active,
  };
}

function mapRoomType(row: RoomTypeRow): RoomTypeDto {
  return {
    roomTypeId: row.room_type_id,
    name: row.name,
    capacity: row.capacity,
    baseDailyRate: row.base_daily_rate,
    active: row.active,
    amenities: row.amenities.map(mapAmenity),
  };
}

async function getRoomTypeWith(db: Queryable, roomTypeId: string): Promise<RoomTypeDto> {
  const result = await db.query<RoomTypeRow>(
    `${ROOM_TYPE_SELECT} WHERE target_type.room_type_id = $1`,
    [roomTypeId],
  );
  if (result.rowCount === 0) {
    throw new CatalogueNotFoundError('Room type was not found.');
  }
  return mapRoomType(result.rows[0]);
}

async function getAmenityWith(db: Queryable, amenityId: string): Promise<AmenityDto> {
  const result = await db.query<AmenityRow>(
    `SELECT amenity_id, name, description, active
       FROM amenity
      WHERE amenity_id = $1`,
    [amenityId],
  );
  if (result.rowCount === 0) {
    throw new CatalogueNotFoundError('Amenity was not found.');
  }
  return mapAmenity(result.rows[0]);
}

async function replaceAmenityLinks(
  client: PoolClient,
  roomTypeId: string,
  amenityIds: string[],
): Promise<void> {
  if (amenityIds.length > 0) {
    const amenities = await client.query<{ amenity_id: string; active: boolean }>(
      `SELECT amenity_id, active
         FROM amenity
        WHERE amenity_id = ANY($1::uuid[])
        FOR KEY SHARE`,
      [amenityIds],
    );
    if (amenities.rowCount !== amenityIds.length) {
      throw new CatalogueValidationError('Every amenity ID must identify an existing amenity.');
    }
    if (amenities.rows.some((amenity) => !amenity.active)) {
      throw new CatalogueConflictError('Inactive amenities cannot be assigned to a room type.');
    }
  }

  await client.query('DELETE FROM room_type_amenity WHERE room_type_id = $1', [roomTypeId]);
  if (amenityIds.length > 0) {
    await client.query(
      `INSERT INTO room_type_amenity (room_type_id, amenity_id)
       SELECT $1, unnest($2::uuid[])`,
      [roomTypeId, amenityIds],
    );
  }
}

export async function listRoomTypes(filters: CatalogueFilters): Promise<RoomTypeDto[]> {
  return inTransaction(async (client) => {
    const result = await client.query<RoomTypeRow>(
      `${ROOM_TYPE_SELECT}
        WHERE ($1::boolean IS NULL OR target_type.active = $1)
          AND ($2 = '' OR strpos(lower(target_type.name), lower($2)) > 0)
        ORDER BY target_type.name, target_type.room_type_id`,
      [filters.active, filters.search],
    );
    return result.rows.map(mapRoomType);
  });
}

export async function getRoomType(roomTypeId: string): Promise<RoomTypeDto> {
  return inTransaction((client) => getRoomTypeWith(client, roomTypeId));
}

export async function createRoomType(input: RoomTypeInput): Promise<RoomTypeDto> {
  return inTransaction(async (client) => {
    const inserted = await client.query<{ room_type_id: string }>(
      `INSERT INTO room_type (name, capacity, base_daily_rate, active)
       VALUES ($1, $2, $3, $4)
       RETURNING room_type_id`,
      [input.name, input.capacity, input.baseDailyRate, input.active],
    );
    const roomTypeId = inserted.rows[0].room_type_id;
    await replaceAmenityLinks(client, roomTypeId, input.amenityIds);
    return getRoomTypeWith(client, roomTypeId);
  });
}

export async function updateRoomType(
  roomTypeId: string,
  patch: RoomTypePatch,
): Promise<RoomTypeDto> {
  return inTransaction(async (client) => {
    const current = await client.query(
      'SELECT 1 FROM room_type WHERE room_type_id = $1 FOR UPDATE',
      [roomTypeId],
    );
    if (current.rowCount === 0) {
      throw new CatalogueNotFoundError('Room type was not found.');
    }

    const assignments: string[] = [];
    const values: unknown[] = [];
    const setValue = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if (patch.name !== undefined) setValue('name', patch.name);
    if (patch.capacity !== undefined) setValue('capacity', patch.capacity);
    if (patch.baseDailyRate !== undefined) setValue('base_daily_rate', patch.baseDailyRate);
    if (patch.active !== undefined) setValue('active', patch.active);

    if (assignments.length > 0) {
      values.push(roomTypeId);
      await client.query(
        `UPDATE room_type SET ${assignments.join(', ')} WHERE room_type_id = $${values.length}`,
        values,
      );
    }
    if (patch.amenityIds !== undefined) {
      await replaceAmenityLinks(client, roomTypeId, patch.amenityIds);
    }

    return getRoomTypeWith(client, roomTypeId);
  });
}

export async function listAmenities(filters: CatalogueFilters): Promise<AmenityDto[]> {
  return inTransaction(async (client) => {
    const result = await client.query<AmenityRow>(
      `SELECT amenity_id, name, description, active
         FROM amenity
        WHERE ($1::boolean IS NULL OR active = $1)
          AND ($2 = '' OR strpos(lower(name), lower($2)) > 0)
        ORDER BY name, amenity_id`,
      [filters.active, filters.search],
    );
    return result.rows.map(mapAmenity);
  });
}

export async function getAmenity(amenityId: string): Promise<AmenityDto> {
  return inTransaction((client) => getAmenityWith(client, amenityId));
}

export async function createAmenity(input: AmenityInput): Promise<AmenityDto> {
  return inTransaction(async (client) => {
    const result = await client.query<{ amenity_id: string }>(
      `INSERT INTO amenity (name, description, active)
       VALUES ($1, $2, $3)
       RETURNING amenity_id`,
      [input.name, input.description, input.active],
    );
    return getAmenityWith(client, result.rows[0].amenity_id);
  });
}

export async function updateAmenity(
  amenityId: string,
  patch: AmenityPatch,
): Promise<AmenityDto> {
  return inTransaction(async (client) => {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const setValue = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if (patch.name !== undefined) setValue('name', patch.name);
    if (patch.description !== undefined) setValue('description', patch.description);
    if (patch.active !== undefined) setValue('active', patch.active);
    values.push(amenityId);

    const result = await client.query(
      `UPDATE amenity
          SET ${assignments.join(', ')}
        WHERE amenity_id = $${values.length}`,
      values,
    );
    if (result.rowCount === 0) {
      throw new CatalogueNotFoundError('Amenity was not found.');
    }
    return getAmenityWith(client, amenityId);
  });
}
