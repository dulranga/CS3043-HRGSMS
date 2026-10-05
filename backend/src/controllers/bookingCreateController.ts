import { NextFunction, Request, Response } from 'express';
import {
  BookingInventoryConflictError,
  BookingLineSelection,
  BookingPolicyUnavailableError,
  ConfirmedBookingLineInput,
  StaffBookingInput,
  createStaffBooking,
  quoteStaffBooking,
} from '../services/bookingCreateService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RATE_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

type Body = Record<string, unknown>;

export interface BookingCreateRequestContext {
  actorId(req: Request, res: Response): string;
  branchId(req: Request, res: Response): string;
}

class BookingRequestValidationError extends Error {}

function requireBody(value: unknown): Body {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BookingRequestValidationError('Request body must be a JSON object.');
  }
  return value as Body;
}

function rejectUnknownKeys(body: Body, allowed: string[]): void {
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) throw new BookingRequestValidationError(`Unsupported field: ${unknown}.`);
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BookingRequestValidationError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new BookingRequestValidationError(`${field} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new BookingRequestValidationError(`${field} must be a valid calendar date.`);
  }
  return value;
}

function parseGuestCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 32767) {
    throw new BookingRequestValidationError('guestCount must be an integer from 1 to 32767.');
  }
  return value;
}

function parseRate(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !RATE_PATTERN.test(String(value))) {
    throw new BookingRequestValidationError(
      'quotedBaseDailyRate must be a non-negative decimal with at most 10 integer and 2 decimal digits.',
    );
  }
  return String(value);
}

function parseSelection(value: unknown, confirmed: false): BookingLineSelection;
function parseSelection(value: unknown, confirmed: true): ConfirmedBookingLineInput;
function parseSelection(
  value: unknown,
  confirmed: boolean,
): BookingLineSelection | ConfirmedBookingLineInput {
  const line = requireBody(value);
  const baseKeys = ['roomId', 'checkIn', 'checkOut', 'guestCount'];
  rejectUnknownKeys(
    line,
    confirmed ? [...baseKeys, 'quotedRoomTypeId', 'quotedBaseDailyRate'] : baseKeys,
  );
  const checkIn = parseDate(line.checkIn, 'checkIn');
  const checkOut = parseDate(line.checkOut, 'checkOut');
  if (checkOut <= checkIn) {
    throw new BookingRequestValidationError('checkOut must be later than checkIn.');
  }
  const selection: BookingLineSelection = {
    roomId: parseUuid(line.roomId, 'roomId'),
    checkIn,
    checkOut,
    guestCount: parseGuestCount(line.guestCount),
  };
  if (!confirmed) return selection;
  return {
    ...selection,
    quotedRoomTypeId: parseUuid(line.quotedRoomTypeId, 'quotedRoomTypeId'),
    quotedBaseDailyRate: parseRate(line.quotedBaseDailyRate),
  };
}

function parseLines(value: unknown, confirmed: false): BookingLineSelection[];
function parseLines(value: unknown, confirmed: true): ConfirmedBookingLineInput[];
function parseLines(
  value: unknown,
  confirmed: boolean,
): BookingLineSelection[] | ConfirmedBookingLineInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BookingRequestValidationError('lines must be a non-empty array.');
  }
  if (confirmed) return value.map((line) => parseSelection(line, true));
  return value.map((line) => parseSelection(line, false));
}

function parseQuoteRequest(value: unknown): BookingLineSelection[] {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['lines']);
  return parseLines(body.lines, false);
}

function parseBookingChannel(value: unknown): StaffBookingInput['bookingChannel'] {
  if (value === 'FRONT_DESK' || value === 'PHONE' || value === 'EMAIL') return value;
  throw new BookingRequestValidationError(
    'bookingChannel must be FRONT_DESK, PHONE or EMAIL for staff creation.',
  );
}

function parseCreateRequest(value: unknown): StaffBookingInput {
  const body = requireBody(value);
  rejectUnknownKeys(body, [
    'guestId',
    'bookingChannel',
    'quotedBillingPolicyId',
    'lines',
  ]);
  return {
    guestId: parseUuid(body.guestId, 'guestId'),
    bookingChannel: parseBookingChannel(body.bookingChannel),
    quotedBillingPolicyId: parseUuid(
      body.quotedBillingPolicyId,
      'quotedBillingPolicyId',
    ),
    lines: parseLines(body.lines, true),
  };
}

type PgError = Error & { code?: string };

function sendError(error: unknown, res: Response): void {
  if (error instanceof BookingRequestValidationError || (error as PgError)?.code === '22023') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: (error as Error).message } });
    return;
  }
  if (error instanceof BookingPolicyUnavailableError || (error as PgError)?.code === 'P2002') {
    res.status(409).json({ error: { code: 'POLICY_UNAVAILABLE', message: (error as Error).message } });
    return;
  }
  if ((error as PgError)?.code === 'P2001') {
    res.status(409).json({
      error: {
        code: 'REQUOTE_REQUIRED',
        message: 'The room rate or billing policy changed. Request a fresh quote and reconfirm.',
      },
    });
    return;
  }
  if (error instanceof BookingInventoryConflictError || (error as PgError)?.code === '23514') {
    res.status(409).json({ error: { code: 'INVENTORY_CONFLICT', message: (error as Error).message } });
    return;
  }
  if ((error as PgError)?.code === 'P2003' || (error as PgError)?.code === 'P2004') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: (error as Error).message } });
    return;
  }
  if ((error as PgError)?.code === '42501') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff booking creation is not permitted.' } });
    return;
  }
  if (['23503', '23505'].includes((error as PgError)?.code ?? '')) {
    res.status(409).json({
      error: { code: 'BOOKING_CONFLICT', message: 'The booking conflicts with current hotel data.' },
    });
    return;
  }
  if (['40P01', '40001'].includes((error as PgError)?.code ?? '')) {
    res.status(409).json({
      error: {
        code: 'RETRY_TRANSACTION',
        message: 'Room inventory changed concurrently. Retry the complete quote and confirmation.',
      },
    });
    return;
  }

  console.error('Staff booking request failed', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'The booking request could not be completed.' },
  });
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function handle(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch((error) => sendError(error, res));
  };
}

export function createBookingCreateHandlers(context: BookingCreateRequestContext) {
  const actorId = (req: Request, res: Response) =>
    parseUuid(context.actorId(req, res), 'authenticated actor ID');
  const branchId = (req: Request, res: Response) =>
    parseUuid(context.branchId(req, res), 'authorized branch ID');

  return {
    quote: handle(async (req, res) => {
      res.json({ data: await quoteStaffBooking(branchId(req, res), parseQuoteRequest(req.body)) });
    }),
    create: handle(async (req, res) => {
      res.status(201).json({
        data: await createStaffBooking(
          actorId(req, res),
          branchId(req, res),
          parseCreateRequest(req.body),
        ),
      });
    }),
  };
}
