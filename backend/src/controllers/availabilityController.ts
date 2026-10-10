import { NextFunction, Request, Response } from 'express';
import {
  AvailabilitySearchInput,
  findAvailableRooms,
  getAvailabilityOptions,
} from '../services/availabilityService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_QUERY_FIELDS = new Set([
  'branchId',
  'checkIn',
  'checkOut',
  'guestCount',
  'immediateCheckIn',
  'roomTypeId',
]);

class AvailabilityValidationError extends Error {}

function parseSingleString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AvailabilityValidationError(`${field} must be a single non-empty string.`);
  }
  return value;
}

function parseUuid(value: unknown, field: string): string {
  const parsed = parseSingleString(value, field);
  if (!UUID_PATTERN.test(parsed)) {
    throw new AvailabilityValidationError(`${field} must be a valid UUID.`);
  }
  return parsed;
}

function parseDate(value: unknown, field: string): string {
  const parsed = parseSingleString(value, field);
  if (!DATE_PATTERN.test(parsed)) {
    throw new AvailabilityValidationError(`${field} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${parsed}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== parsed) {
    throw new AvailabilityValidationError(`${field} must be a valid calendar date.`);
  }
  return parsed;
}

function parseGuestCount(value: unknown): number {
  const parsed = parseSingleString(value, 'guestCount');
  if (!/^[1-9]\d*$/.test(parsed)) {
    throw new AvailabilityValidationError('guestCount must be a positive integer.');
  }
  const count = Number(parsed);
  if (!Number.isSafeInteger(count) || count > 32767) {
    throw new AvailabilityValidationError('guestCount must be from 1 to 32767.');
  }
  return count;
}

function parseImmediateCheckIn(value: unknown): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new AvailabilityValidationError('immediateCheckIn must be true or false.');
}

function parseSearch(req: Request): AvailabilitySearchInput {
  const unknown = Object.keys(req.query).find((key) => !ALLOWED_QUERY_FIELDS.has(key));
  if (unknown) {
    throw new AvailabilityValidationError(`Unsupported query field: ${unknown}.`);
  }

  const checkIn = parseDate(req.query.checkIn, 'checkIn');
  const checkOut = parseDate(req.query.checkOut, 'checkOut');
  if (checkOut <= checkIn) {
    throw new AvailabilityValidationError('checkOut must be later than checkIn.');
  }

  return {
    branchId: parseUuid(req.query.branchId, 'branchId'),
    checkIn,
    checkOut,
    guestCount: parseGuestCount(req.query.guestCount),
    immediateCheckIn: parseImmediateCheckIn(req.query.immediateCheckIn),
    roomTypeId:
      req.query.roomTypeId === undefined
        ? null
        : parseUuid(req.query.roomTypeId, 'roomTypeId'),
  };
}

type PgError = Error & { code?: string };

function sendError(error: unknown, res: Response): void {
  if (error instanceof AvailabilityValidationError || (error as PgError)?.code === '22023') {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: error instanceof Error ? error.message : 'Invalid availability search.',
      },
    });
    return;
  }

  console.error('Availability request failed', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Availability could not be searched.' },
  });
}

export function availabilityOptionsHandler(req: Request, res: Response): void {
  if (Object.keys(req.query).length) {
    sendError(new AvailabilityValidationError('Search choices do not accept query parameters.'), res);
    return;
  }
  getAvailabilityOptions().then(data => res.json({ data })).catch(error => sendError(error, res));
}

export function searchAvailabilityHandler(
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let input: AvailabilitySearchInput;
  try {
    input = parseSearch(req);
  } catch (error) {
    sendError(error, res);
    return;
  }

  findAvailableRooms(input)
    .then((rooms) => {
      res.json({
        data: rooms,
        meta: {
          branchId: input.branchId,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          guestCount: input.guestCount,
          immediateCheckIn: input.immediateCheckIn,
          roomTypeId: input.roomTypeId,
          resultCount: rooms.length,
        },
      });
    })
    .catch((error) => sendError(error, res));
}
