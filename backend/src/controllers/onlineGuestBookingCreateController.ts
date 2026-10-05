import { NextFunction, Request, Response } from 'express';
import {
  ConfirmedOnlineBookingLineInput,
  OnlineBookingInventoryConflictError,
  OnlineBookingLineSelection,
  OnlineBookingPolicyUnavailableError,
  OnlineGuestAccessError,
  OnlineGuestBookingInput,
  createOnlineGuestBooking,
  quoteOnlineGuestBooking,
} from '../services/onlineGuestBookingCreateService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RATE_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

type Body = Record<string, unknown>;

export interface OnlineGuestBookingRequestContext {
  authenticatedUserId(req: Request, res: Response): string;
}

class OnlineBookingRequestValidationError extends Error {}

function requireBody(value: unknown): Body {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OnlineBookingRequestValidationError('Request body must be a JSON object.');
  }
  return value as Body;
}

function rejectUnknownKeys(body: Body, allowed: string[]): void {
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) throw new OnlineBookingRequestValidationError(`Unsupported field: ${unknown}.`);
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new OnlineBookingRequestValidationError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new OnlineBookingRequestValidationError(`${field} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new OnlineBookingRequestValidationError(`${field} must be a valid calendar date.`);
  }
  return value;
}

function parseGuestCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 32767) {
    throw new OnlineBookingRequestValidationError(
      'guestCount must be an integer from 1 to 32767.',
    );
  }
  return value;
}

function parseRate(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !RATE_PATTERN.test(String(value))) {
    throw new OnlineBookingRequestValidationError(
      'quotedBaseDailyRate must be a non-negative decimal with at most 10 integer and 2 decimal digits.',
    );
  }
  return String(value);
}

function parseSelection(value: unknown, confirmed: false): OnlineBookingLineSelection;
function parseSelection(value: unknown, confirmed: true): ConfirmedOnlineBookingLineInput;
function parseSelection(
  value: unknown,
  confirmed: boolean,
): OnlineBookingLineSelection | ConfirmedOnlineBookingLineInput {
  const line = requireBody(value);
  const baseKeys = ['roomId', 'checkIn', 'checkOut', 'guestCount'];
  rejectUnknownKeys(
    line,
    confirmed ? [...baseKeys, 'quotedRoomTypeId', 'quotedBaseDailyRate'] : baseKeys,
  );
  const checkIn = parseDate(line.checkIn, 'checkIn');
  const checkOut = parseDate(line.checkOut, 'checkOut');
  if (checkOut <= checkIn) {
    throw new OnlineBookingRequestValidationError('checkOut must be later than checkIn.');
  }
  const selection: OnlineBookingLineSelection = {
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

function parseLines(value: unknown, confirmed: false): OnlineBookingLineSelection[];
function parseLines(value: unknown, confirmed: true): ConfirmedOnlineBookingLineInput[];
function parseLines(
  value: unknown,
  confirmed: boolean,
): OnlineBookingLineSelection[] | ConfirmedOnlineBookingLineInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OnlineBookingRequestValidationError('lines must be a non-empty array.');
  }
  if (confirmed) return value.map((line) => parseSelection(line, true));
  return value.map((line) => parseSelection(line, false));
}

function parseQuoteRequest(value: unknown): {
  branchId: string;
  lines: OnlineBookingLineSelection[];
} {
  const body = requireBody(value);
  rejectUnknownKeys(body, ['branchId', 'lines']);
  return {
    branchId: parseUuid(body.branchId, 'branchId'),
    lines: parseLines(body.lines, false),
  };
}

function parseCreateRequest(value: unknown): OnlineGuestBookingInput {
  const body = requireBody(value);
  // guestId and bookingChannel are deliberately absent. Ownership and channel
  // are derived server-side from the authenticated online guest session.
  rejectUnknownKeys(body, ['branchId', 'quotedBillingPolicyId', 'lines']);
  return {
    branchId: parseUuid(body.branchId, 'branchId'),
    quotedBillingPolicyId: parseUuid(
      body.quotedBillingPolicyId,
      'quotedBillingPolicyId',
    ),
    lines: parseLines(body.lines, true),
  };
}

type PgError = Error & { code?: string };

function sendError(error: unknown, res: Response): void {
  if (error instanceof OnlineBookingRequestValidationError || (error as PgError)?.code === '22023') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: (error as Error).message } });
    return;
  }
  if (error instanceof OnlineGuestAccessError || (error as PgError)?.code === '42501') {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Online guest booking is not permitted.' },
    });
    return;
  }
  if (error instanceof OnlineBookingPolicyUnavailableError || (error as PgError)?.code === 'P2002') {
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
  if ((error as PgError)?.code === 'P2004') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: (error as Error).message } });
    return;
  }
  if (error instanceof OnlineBookingInventoryConflictError || (error as PgError)?.code === '23514') {
    res.status(409).json({ error: { code: 'INVENTORY_CONFLICT', message: (error as Error).message } });
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

  console.error('Online guest booking request failed', error);
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

export function createOnlineGuestBookingHandlers(context: OnlineGuestBookingRequestContext) {
  const userId = (req: Request, res: Response) =>
    parseUuid(context.authenticatedUserId(req, res), 'authenticated user ID');

  return {
    quote: handle(async (req, res) => {
      const input = parseQuoteRequest(req.body);
      res.json({
        data: await quoteOnlineGuestBooking(userId(req, res), input.branchId, input.lines),
      });
    }),
    create: handle(async (req, res) => {
      res.status(201).json({
        data: await createOnlineGuestBooking(userId(req, res), parseCreateRequest(req.body)),
      });
    }),
  };
}
