import { Request, Response } from 'express';
import { pool } from '../db';
import { member3Actor } from './member3Actor';
import { RoomConditionError, changeRoomCondition } from '../services/roomConditionService';

function readParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function errorResponse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export async function patchRoomCondition(req: Request, res: Response): Promise<void> {
  // Only Member 1's verified session middleware may supply req.user; headers and
  // body fields are never proof of identity.
  const actor = member3Actor(req);
  const roomId = readParam(req.params.roomId);
  const body = req.body || {};
  const condition = String(body.condition ?? body.newCondition ?? body.new_condition ?? '').trim().toUpperCase();

  if (!actor.userId) {
    errorResponse(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required to change physical room condition.');
    return;
  }
  if (!roomId) {
    errorResponse(res, 400, 'INVALID_ROOM_CONDITION_INPUT', 'A room identifier is required.');
    return;
  }

  try {
    const client = await pool.connect();
    try {
      const result = await changeRoomCondition(client, {
        roomId,
        condition,
        actorId: actor.userId,
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 255) : undefined,
      });
      res.status(200).json({
        room_id: result.roomId,
        room_number: result.roomNumber,
        branch_id: result.branchId,
        previous_condition: result.previousCondition,
        condition: result.condition,
        changed: result.changed,
        history_id: result.historyId,
        changed_at: result.changedAt,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof RoomConditionError) {
      errorResponse(res, error.statusCode, error.code, error.message);
      return;
    }
    errorResponse(res, 500, 'ROOM_CONDITION_CHANGE_FAILED', 'Unable to change physical room condition.');
  }
}