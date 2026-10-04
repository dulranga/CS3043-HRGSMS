import { NextFunction, Request, Response } from 'express';
import {
  CreateBlockInput,
  CreateRoomInput,
  InventoryConflictError,
  InventoryFilters,
  InventoryNotFoundError,
  InventoryValidationError,
  UpdateBlockInput,
  UpdateRoomInput,
  createRoom,
  createRoomBlock,
  deleteRoomBlock,
  getRoom,
  listRoomBlocks,
  listRooms,
  updateRoom,
  updateRoomBlock,
} from '../services/roomInventoryService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Body = Record<string, unknown>;

export interface RoomInventoryRequestContext {
  branchId(req: Request, res: Response): string;
  actorId(req: Request, res: Response): string;
}

function requireBody(value: unknown): Body {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InventoryValidationError('Request body must be a JSON object.');
  }
  return value as Body;
}

function rejectUnknownKeys(body: Body, allowed: string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new InventoryValidationError(`Unsupported field: ${unknown[0]}.`);
  }
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new InventoryValidationError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InventoryValidationError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255) {
    throw new InventoryValidationError(`${field} must contain 1 to 255 characters.`);
  }
  return normalized;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new InventoryValidationError(`${field} must be a boolean.`);
  }
  return value;
}

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new InventoryValidationError(`${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InventoryValidationError(`${field} must be a valid calendar date.`);
  }
  return value;
}

function assertDateInterval(startDate: string, endDate: string): void {
  if (endDate <= startDate) {
    throw new InventoryValidationError('endDate must be later than startDate.');
  }
}

function parseFilters(req: Request): InventoryFilters {
  const rawSearch = req.query.search;
  if (rawSearch !== undefined && typeof rawSearch !== 'string') {
    throw new InventoryValidationError('search must be a single string.');
  }
  const search = rawSearch?.trim() ?? '';
  if (search.length > 255) {
    throw new InventoryValidationError('search must not exceed 255 characters.');
  }

  const rawActive = req.query.active;
  if (rawActive === undefined || rawActive === 'all') return { search, active: null };
  if (rawActive === 'true') return { search, active: true };
  if (rawActive === 'false') return { search, active: false };
  throw new InventoryValidationError('active must be true, false or all.');
}

function parseRoomCreate(value: unknown): CreateRoomInput {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['roomNumber', 'roomTypeId', 'active']);
  return {
    roomNumber: parseText(body.roomNumber, 'roomNumber'),
    roomTypeId: parseUuid(body.roomTypeId, 'roomTypeId'),
    active: body.active === undefined ? true : parseBoolean(body.active, 'active'),
  };
}

function parseRoomPatch(value: unknown): UpdateRoomInput {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['roomNumber', 'roomTypeId', 'active']);
  if (Object.keys(body).length === 0) {
    throw new InventoryValidationError('At least one room field is required.');
  }
  return {
    ...(body.roomNumber !== undefined && {
      roomNumber: parseText(body.roomNumber, 'roomNumber'),
    }),
    ...(body.roomTypeId !== undefined && {
      roomTypeId: parseUuid(body.roomTypeId, 'roomTypeId'),
    }),
    ...(body.active !== undefined && { active: parseBoolean(body.active, 'active') }),
  };
}

function parseBlockCreate(value: unknown): CreateBlockInput {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['startDate', 'endDate', 'reason']);
  const startDate = parseDate(body.startDate, 'startDate');
  const endDate = parseDate(body.endDate, 'endDate');
  assertDateInterval(startDate, endDate);
  return { startDate, endDate, reason: parseText(body.reason, 'reason') };
}

function parseBlockPatch(value: unknown): UpdateBlockInput {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['startDate', 'endDate', 'reason']);
  if (Object.keys(body).length === 0) {
    throw new InventoryValidationError('At least one room-block field is required.');
  }
  return {
    ...(body.startDate !== undefined && { startDate: parseDate(body.startDate, 'startDate') }),
    ...(body.endDate !== undefined && { endDate: parseDate(body.endDate, 'endDate') }),
    ...(body.reason !== undefined && { reason: parseText(body.reason, 'reason') }),
  };
}

type PgError = Error & { code?: string; constraint?: string };

function sendError(error: unknown, res: Response): void {
  if (error instanceof InventoryValidationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    return;
  }
  if (error instanceof InventoryNotFoundError) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
    return;
  }
  if (error instanceof InventoryConflictError) {
    res.status(409).json({
      error: {
        code: 'INVENTORY_CONFLICT',
        message: error.message,
        affectedLines: error.affectedLines,
      },
    });
    return;
  }

  const pgError = error as PgError;
  if (pgError.code === '23505' && pgError.constraint === 'room_branch_number_unique') {
    res.status(409).json({
      error: {
        code: 'ROOM_NUMBER_CONFLICT',
        message: 'That room number already exists in this branch.',
      },
    });
    return;
  }
  if (pgError.code === '23514' || pgError.code === '23503' || pgError.code === '23505') {
    res.status(409).json({
      error: {
        code: 'INVENTORY_CONFLICT',
        message: 'The room change conflicts with current room or reservation data.',
      },
    });
    return;
  }
  if (pgError.code === '40P01' || pgError.code === '40001') {
    res.status(409).json({
      error: {
        code: 'RETRY_TRANSACTION',
        message: 'The room inventory changed concurrently. Retry the complete request.',
      },
    });
    return;
  }

  console.error('Room inventory request failed', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'The room request could not be completed.' },
  });
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function handle(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch((error) => sendError(error, res));
  };
}

export function createRoomInventoryHandlers(context: RoomInventoryRequestContext) {
  const authorizedBranchId = (req: Request, res: Response) =>
    parseUuid(context.branchId(req, res), 'authorized branch ID');
  const authorizedActorId = (req: Request, res: Response) =>
    parseUuid(context.actorId(req, res), 'authenticated actor ID');

  return {
    listRooms: handle(async (req, res) => {
      res.json({ data: await listRooms(authorizedBranchId(req, res), parseFilters(req)) });
    }),
    getRoom: handle(async (req, res) => {
      res.json({
        data: await getRoom(
          authorizedBranchId(req, res),
          parseUuid(req.params.roomId, 'roomId'),
        ),
      });
    }),
    createRoom: handle(async (req, res) => {
      res.status(201).json({
        data: await createRoom(authorizedBranchId(req, res), parseRoomCreate(req.body)),
      });
    }),
    updateRoom: handle(async (req, res) => {
      res.json({
        data: await updateRoom(
          authorizedBranchId(req, res),
          parseUuid(req.params.roomId, 'roomId'),
          parseRoomPatch(req.body),
        ),
      });
    }),
    listBlocks: handle(async (req, res) => {
      res.json({
        data: await listRoomBlocks(
          authorizedBranchId(req, res),
          parseUuid(req.params.roomId, 'roomId'),
        ),
      });
    }),
    createBlock: handle(async (req, res) => {
      res.status(201).json({
        data: await createRoomBlock(
          authorizedBranchId(req, res),
          parseUuid(req.params.roomId, 'roomId'),
          authorizedActorId(req, res),
          parseBlockCreate(req.body),
        ),
      });
    }),
    updateBlock: handle(async (req, res) => {
      const patch = parseBlockPatch(req.body);
      if (patch.startDate !== undefined && patch.endDate !== undefined) {
        assertDateInterval(patch.startDate, patch.endDate);
      }
      res.json({
        data: await updateRoomBlock(
          authorizedBranchId(req, res),
          parseUuid(req.params.blockId, 'blockId'),
          patch,
        ),
      });
    }),
    deleteBlock: handle(async (req, res) => {
      await deleteRoomBlock(
        authorizedBranchId(req, res),
        parseUuid(req.params.blockId, 'blockId'),
      );
      res.status(204).send();
    }),
  };
}
