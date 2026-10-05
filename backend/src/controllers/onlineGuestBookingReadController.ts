import { NextFunction, Request, Response } from 'express';
import {
  OnlineGuestBookingListInput,
  OnlineGuestReadAccessError,
  getOnlineGuestBookingDetail,
  listOnlineGuestBookings,
} from '../services/onlineGuestBookingReadService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OnlineGuestBookingReadRequestContext {
  authenticatedUserId(req: Request, res: Response): string;
}

class OnlineGuestBookingReadValidationError extends Error {}

function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new OnlineGuestBookingReadValidationError(`${field} must be a valid UUID.`);
  }
  return value;
}

function parseIntegerQuery(
  value: unknown,
  field: string,
  defaultValue: number,
  maximum?: number,
): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new OnlineGuestBookingReadValidationError(`${field} must be a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || (maximum !== undefined && parsed > maximum)) {
    throw new OnlineGuestBookingReadValidationError(
      maximum === undefined
        ? `${field} must be a non-negative safe integer.`
        : `${field} must be an integer from 0 to ${maximum}.`,
    );
  }
  return parsed;
}

function parseListQuery(query: Request['query']): OnlineGuestBookingListInput {
  const unknown = Object.keys(query).find((key) => !['limit', 'offset'].includes(key));
  if (unknown) {
    throw new OnlineGuestBookingReadValidationError(`Unsupported query parameter: ${unknown}.`);
  }
  const limit = parseIntegerQuery(query.limit, 'limit', 50, 100);
  if (limit < 1) {
    throw new OnlineGuestBookingReadValidationError('limit must be an integer from 1 to 100.');
  }
  return { limit, offset: parseIntegerQuery(query.offset, 'offset', 0) };
}

function sendError(error: unknown, res: Response): void {
  if (error instanceof OnlineGuestBookingReadValidationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.message } });
    return;
  }
  if (error instanceof OnlineGuestReadAccessError) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Online guest booking access is not permitted.' },
    });
    return;
  }
  console.error('Online guest booking read failed', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'The booking records could not be loaded.' },
  });
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function handle(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch((error) => sendError(error, res));
  };
}

export function createOnlineGuestBookingReadHandlers(
  context: OnlineGuestBookingReadRequestContext,
) {
  const userId = (req: Request, res: Response) =>
    parseUuid(context.authenticatedUserId(req, res), 'authenticated user ID');

  return {
    list: handle(async (req, res) => {
      res.json({
        data: await listOnlineGuestBookings(userId(req, res), parseListQuery(req.query)),
      });
    }),
    detail: handle(async (req, res) => {
      if (Object.keys(req.query).length > 0) {
        throw new OnlineGuestBookingReadValidationError(
          'Booking detail does not accept query parameters.',
        );
      }
      const detail = await getOnlineGuestBookingDetail(
        userId(req, res),
        parseUuid(req.params.bookingId, 'bookingId'),
      );
      if (!detail) {
        res.status(404).json({
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking was not found.' },
        });
        return;
      }
      res.json({ data: detail });
    }),
  };
}
