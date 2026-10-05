import { NextFunction, Request, Response } from 'express';
import {
  BookingLineChangeInput,
  BookingLineValuesInput,
  BookingRoomMoveInput,
  addBookingRoomLine,
  changeBookingRoomLine,
  moveBookingRoomLine,
} from '../services/bookingModificationService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RATE_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const SIGNED_AMOUNT_PATTERN = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

type Body = Record<string, unknown>;

export interface BookingModificationRequestContext {
  actorId(req: Request, res: Response): string;
  branchId(req: Request, res: Response): string;
}

class BookingModificationValidationError extends Error {}

function requireBody(value: unknown): Body {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BookingModificationValidationError('Request body must be a JSON object.');
  }
  return value as Body;
}

function rejectUnknownKeys(body: Body, allowed: string[]): void {
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) throw new BookingModificationValidationError(`Unsupported field: ${unknown}.`);
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BookingModificationValidationError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new BookingModificationValidationError(`${field} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new BookingModificationValidationError(`${field} must be a valid calendar date.`);
  }
  return value;
}

function parseGuestCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 32767) {
    throw new BookingModificationValidationError('guestCount must be an integer from 1 to 32767.');
  }
  return value;
}

function parseRate(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !RATE_PATTERN.test(String(value))) {
    throw new BookingModificationValidationError(
      'quotedBaseDailyRate must be a non-negative decimal with at most 10 integer and 2 decimal digits.',
    );
  }
  return String(value);
}

function parseReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    throw new BookingModificationValidationError('reason must be a non-blank string of at most 200 characters.');
  }
  return value.trim();
}

function parseSignedAmount(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if ((typeof value !== 'string' && typeof value !== 'number')
      || !SIGNED_AMOUNT_PATTERN.test(String(value))) {
    throw new BookingModificationValidationError(
      'approvedPriceAdjustment must be a signed decimal with at most 12 integer and 2 decimal digits.',
    );
  }
  return String(value);
}

function parseLineValues(value: unknown, includeRoom: true): BookingLineValuesInput;
function parseLineValues(value: unknown, includeRoom: false): BookingLineChangeInput;
function parseLineValues(
  value: unknown,
  includeRoom: boolean,
): BookingLineValuesInput | BookingLineChangeInput {
  const body = requireBody(value);
  const keys = [
    'checkIn', 'checkOut', 'guestCount', 'quotedRoomTypeId', 'quotedBaseDailyRate', 'reason',
  ];
  rejectUnknownKeys(body, includeRoom ? ['roomId', ...keys] : keys);
  const checkIn = parseDate(body.checkIn, 'checkIn');
  const checkOut = parseDate(body.checkOut, 'checkOut');
  if (checkOut <= checkIn) {
    throw new BookingModificationValidationError('checkOut must be later than checkIn.');
  }
  const parsed = {
    checkIn,
    checkOut,
    guestCount: parseGuestCount(body.guestCount),
    quotedRoomTypeId: parseUuid(body.quotedRoomTypeId, 'quotedRoomTypeId'),
    quotedBaseDailyRate: parseRate(body.quotedBaseDailyRate),
    reason: parseReason(body.reason),
  };
  if (!includeRoom) return parsed;
  return { roomId: parseUuid(body.roomId, 'roomId'), ...parsed };
}

function parseMove(value: unknown): BookingRoomMoveInput {
  const body = requireBody(value);
  rejectUnknownKeys(body, [
    'roomId', 'quotedRoomTypeId', 'quotedBaseDailyRate', 'reason', 'approvedPriceAdjustment',
  ]);
  return {
    roomId: parseUuid(body.roomId, 'roomId'),
    quotedRoomTypeId: parseUuid(body.quotedRoomTypeId, 'quotedRoomTypeId'),
    quotedBaseDailyRate: parseRate(body.quotedBaseDailyRate),
    reason: parseReason(body.reason),
    approvedPriceAdjustment: parseSignedAmount(body.approvedPriceAdjustment),
  };
}

type PgError = Error & { code?: string };

function sendError(error: unknown, res: Response): void {
  const code = (error as PgError)?.code;
  if (error instanceof BookingModificationValidationError || code === '22023') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: (error as Error).message } });
    return;
  }
  if (code === 'P2101') {
    res.status(409).json({
      error: { code: 'REQUOTE_REQUIRED', message: 'The selected room type or rate changed. Request a fresh quote.' },
    });
    return;
  }
  if (code === 'P2102' || code === '02000') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: (error as Error).message } });
    return;
  }
  if (code === 'P2103' || code === 'P2104' || code === '55000') {
    res.status(409).json({ error: { code: 'INVALID_STATE', message: (error as Error).message } });
    return;
  }
  if (code === '42501') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This booking modification is not permitted.' } });
    return;
  }
  if (['23503', '23505', '23514'].includes(code ?? '')) {
    res.status(409).json({ error: { code: 'INVENTORY_CONFLICT', message: (error as Error).message } });
    return;
  }
  if (['40P01', '40001'].includes(code ?? '')) {
    res.status(409).json({
      error: { code: 'RETRY_TRANSACTION', message: 'Reservation data changed concurrently. Retry the complete operation.' },
    });
    return;
  }
  console.error('Booking modification failed', error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The booking could not be modified.' } });
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function handle(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch((error) => sendError(error, res));
  };
}

export function createBookingModificationHandlers(context: BookingModificationRequestContext) {
  const actorId = (req: Request, res: Response) =>
    parseUuid(context.actorId(req, res), 'authenticated actor ID');
  const branchId = (req: Request, res: Response) =>
    parseUuid(context.branchId(req, res), 'authorized branch ID');
  const bookingId = (req: Request) => parseUuid(req.params.bookingId, 'bookingId');
  const lineId = (req: Request) => parseUuid(req.params.lineId, 'lineId');

  return {
    add: handle(async (req, res) => {
      res.status(201).json({
        data: await addBookingRoomLine(
          actorId(req, res), branchId(req, res), bookingId(req), parseLineValues(req.body, true),
        ),
      });
    }),
    change: handle(async (req, res) => {
      res.json({
        data: await changeBookingRoomLine(
          actorId(req, res), branchId(req, res), bookingId(req), lineId(req),
          parseLineValues(req.body, false),
        ),
      });
    }),
    move: handle(async (req, res) => {
      res.json({
        data: await moveBookingRoomLine(
          actorId(req, res), branchId(req, res), bookingId(req), lineId(req), parseMove(req.body),
        ),
      });
    }),
  };
}
