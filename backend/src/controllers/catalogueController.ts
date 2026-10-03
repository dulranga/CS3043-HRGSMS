import { NextFunction, Request, Response } from 'express';
import {
  AmenityInput,
  AmenityPatch,
  CatalogueConflictError,
  CatalogueFilters,
  CatalogueNotFoundError,
  CatalogueValidationError,
  RoomTypeInput,
  RoomTypePatch,
  createAmenity,
  createRoomType,
  getAmenity,
  getRoomType,
  listAmenities,
  listRoomTypes,
  updateAmenity,
  updateRoomType,
} from '../services/catalogueService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

type Body = Record<string, unknown>;

function requireBody(value: unknown): Body {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogueValidationError('Request body must be a JSON object.');
  }
  return value as Body;
}

function rejectUnknownKeys(body: Body, allowed: string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new CatalogueValidationError(`Unsupported field: ${unknown[0]}.`);
  }
}

function parseRequiredName(value: unknown, field = 'name'): string {
  if (typeof value !== 'string') {
    throw new CatalogueValidationError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255) {
    throw new CatalogueValidationError(`${field} must contain 1 to 255 characters.`);
  }
  return normalized;
}

function parseDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new CatalogueValidationError('description must be a string or null.');
  }
  const normalized = value.trim();
  if (normalized.length > 255) {
    throw new CatalogueValidationError('description must not exceed 255 characters.');
  }
  return normalized.length === 0 ? null : normalized;
}

function parseCapacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 32767) {
    throw new CatalogueValidationError('capacity must be an integer from 1 to 32767.');
  }
  return value;
}

function parseRate(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !RATE_PATTERN.test(String(value))) {
    throw new CatalogueValidationError(
      'baseDailyRate must be a non-negative decimal with at most 10 integer and 2 decimal digits.',
    );
  }
  return String(value);
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new CatalogueValidationError(`${field} must be a boolean.`);
  }
  return value;
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new CatalogueValidationError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseAmenityIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new CatalogueValidationError('amenityIds must be an array of UUIDs.');
  }
  const ids = value.map((id) => parseUuid(id, 'amenityIds entry'));
  if (new Set(ids).size !== ids.length) {
    throw new CatalogueValidationError('amenityIds must not contain duplicates.');
  }
  return ids;
}

function parseFilters(req: Request): CatalogueFilters {
  const rawSearch = req.query.search;
  if (rawSearch !== undefined && typeof rawSearch !== 'string') {
    throw new CatalogueValidationError('search must be a single string.');
  }
  const search = rawSearch?.trim() ?? '';
  if (search.length > 255) {
    throw new CatalogueValidationError('search must not exceed 255 characters.');
  }

  const rawActive = req.query.active;
  if (rawActive === undefined || rawActive === 'true') return { search, active: true };
  if (rawActive === 'false') return { search, active: false };
  if (rawActive === 'all') return { search, active: null };
  throw new CatalogueValidationError('active must be true, false or all.');
}

function parseRoomTypeCreate(value: unknown): RoomTypeInput {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['name', 'capacity', 'baseDailyRate', 'active', 'amenityIds']);
  return {
    name: parseRequiredName(body.name),
    capacity: parseCapacity(body.capacity),
    baseDailyRate: parseRate(body.baseDailyRate),
    active: body.active === undefined ? true : parseBoolean(body.active, 'active'),
    amenityIds: body.amenityIds === undefined ? [] : parseAmenityIds(body.amenityIds),
  };
}

function parseRoomTypePatch(value: unknown): RoomTypePatch {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['name', 'capacity', 'baseDailyRate', 'active', 'amenityIds']);
  if (Object.keys(body).length === 0) {
    throw new CatalogueValidationError('At least one room-type field is required.');
  }
  return {
    ...(body.name !== undefined && { name: parseRequiredName(body.name) }),
    ...(body.capacity !== undefined && { capacity: parseCapacity(body.capacity) }),
    ...(body.baseDailyRate !== undefined && { baseDailyRate: parseRate(body.baseDailyRate) }),
    ...(body.active !== undefined && { active: parseBoolean(body.active, 'active') }),
    ...(body.amenityIds !== undefined && { amenityIds: parseAmenityIds(body.amenityIds) }),
  };
}

function parseAmenityCreate(value: unknown): AmenityInput {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['name', 'description', 'active']);
  return {
    name: parseRequiredName(body.name),
    description: body.description === undefined ? null : parseDescription(body.description),
    active: body.active === undefined ? true : parseBoolean(body.active, 'active'),
  };
}

function parseAmenityPatch(value: unknown): AmenityPatch {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['name', 'description', 'active']);
  if (Object.keys(body).length === 0) {
    throw new CatalogueValidationError('At least one amenity field is required.');
  }
  return {
    ...(body.name !== undefined && { name: parseRequiredName(body.name) }),
    ...(body.description !== undefined && { description: parseDescription(body.description) }),
    ...(body.active !== undefined && { active: parseBoolean(body.active, 'active') }),
  };
}

type PgError = Error & { code?: string };

function sendError(error: unknown, res: Response): void {
  if (error instanceof CatalogueValidationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    return;
  }
  if (error instanceof CatalogueNotFoundError) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
    return;
  }
  if (error instanceof CatalogueConflictError) {
    res.status(409).json({ error: { code: 'CATALOGUE_CONFLICT', message: error.message } });
    return;
  }

  const code = (error as PgError)?.code;
  if (code === '23514' || code === '23505' || code === '23503') {
    res.status(409).json({
      error: {
        code: 'CATALOGUE_CONFLICT',
        message: 'The catalogue change conflicts with current catalogue or reservation data.',
      },
    });
    return;
  }
  if (code === '40P01' || code === '40001') {
    res.status(409).json({
      error: {
        code: 'RETRY_TRANSACTION',
        message: 'The catalogue changed concurrently. Retry the complete request.',
      },
    });
    return;
  }

  console.error('Catalogue request failed', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'The catalogue request could not be completed.' },
  });
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function handle(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch((error) => sendError(error, res));
  };
}

export const listRoomTypesHandler = handle(async (req, res) => {
  res.json({ data: await listRoomTypes(parseFilters(req)) });
});

export const getRoomTypeHandler = handle(async (req, res) => {
  res.json({ data: await getRoomType(parseUuid(req.params.roomTypeId, 'roomTypeId')) });
});

export const createRoomTypeHandler = handle(async (req, res) => {
  res.status(201).json({ data: await createRoomType(parseRoomTypeCreate(req.body)) });
});

export const updateRoomTypeHandler = handle(async (req, res) => {
  res.json({
    data: await updateRoomType(
      parseUuid(req.params.roomTypeId, 'roomTypeId'),
      parseRoomTypePatch(req.body),
    ),
  });
});

export const listAmenitiesHandler = handle(async (req, res) => {
  res.json({ data: await listAmenities(parseFilters(req)) });
});

export const getAmenityHandler = handle(async (req, res) => {
  res.json({ data: await getAmenity(parseUuid(req.params.amenityId, 'amenityId')) });
});

export const createAmenityHandler = handle(async (req, res) => {
  res.status(201).json({ data: await createAmenity(parseAmenityCreate(req.body)) });
});

export const updateAmenityHandler = handle(async (req, res) => {
  res.json({
    data: await updateAmenity(
      parseUuid(req.params.amenityId, 'amenityId'),
      parseAmenityPatch(req.body),
    ),
  });
});
