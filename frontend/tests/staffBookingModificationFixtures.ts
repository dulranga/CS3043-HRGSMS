import { AvailabilityApi, AvailableRoom } from '../src/lib/availability';
import { BookingModificationApi, ModificationResult, ModificationReview } from '../src/lib/staffBookingModification';
import { StaffBookingSession } from '../src/lib/staffBooking';
import { StaffBookingReadApi } from '../src/lib/staffBookingRead';
import { bookingDetail, readSession } from './staffBookingReadFixtures';
import { id, single, double, envelope } from './availabilityFixtures';

export const modificationSession: StaffBookingSession = { ...readSession, mutationHeaders: async () => ({ 'X-Fixture-CSRF': 'sample-only' }) };
export const targetSingle: AvailableRoom = { ...single, roomId: id(9), roomNumber: '105' };
export const targetDouble: AvailableRoom = { ...double, roomId: id(20), roomNumber: '106', operationalStatus: 'READY' };
export function mutationResult(review: ModificationReview, credit = false): ModificationResult {
  return { bookingId: review.bookingId, line: { lineId: review.lineId ?? id(50), checkIn: review.checkIn, checkOut: review.checkOut,
    guestCount: review.guestCount, rateSnapshot: review.agreedRate, status: review.originalStatus,
    currentAssignment: { assignmentId: id(51), roomId: review.roomId, roomNumber: review.roomNumber,
      roomTypeId: review.input.quotedRoomTypeId, roomTypeName: review.input.quotedRoomTypeId === id(3) ? 'Single' : 'Double',
      assignedAt: '2027-06-02T10:00:00Z', occupiedFrom: review.originalStatus === 'CHECKED_IN' ? '2027-06-02T10:00:00Z' : null } },
    invoice: { invoiceId: id(41), total: '100000.00', balance: credit ? '-1234.50' : '100000.00', isCredit: credit, creditAmount: credit ? '1234.50' : '0.00' } };
}
// In-memory dev/test server only. No transport escapes this function.
export function createModificationFixture() {
  let booking = structuredClone(bookingDetail), sequence = 50;
  const flags = { error: '', unknown: false, credit: false, refreshFailure: false, changedRate: false };
  const next = () => id(sequence++), at = '2027-06-02T10:00:00Z';
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://fixture.local'), method = init?.method ?? 'GET';
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (flags.error === 'FORBIDDEN') return response({ error: { code: flags.error } }, 403);
    if (method === 'GET' && url.pathname.startsWith('/api/room-types/')) {
      const room = url.pathname.endsWith(id(3)) ? targetSingle : targetDouble;
      return response({ data: { ...room.roomType, active: true } });
    }
    if (url.pathname === '/api/availability') {
      const criteria = { branchId: url.searchParams.get('branchId')!, checkIn: url.searchParams.get('checkIn')!, checkOut: url.searchParams.get('checkOut')!,
        guestCount: Number(url.searchParams.get('guestCount')), roomTypeId: null, immediateCheckIn: url.searchParams.get('immediateCheckIn') === 'true' };
      const rooms = [targetSingle, targetDouble].filter(r => r.roomType.capacity >= criteria.guestCount).map(r => flags.changedRate ? { ...r, roomType: { ...r.roomType, baseDailyRate: '19000.50' } } : r);
      return response(envelope(rooms, criteria));
    }
    if (method === 'GET') {
      if (flags.refreshFailure) return response({ error: { code: 'INTERNAL_ERROR' } }, 500);
      return response({ data: booking });
    }
    if (flags.unknown) throw new TypeError('Sample unknown network result');
    if (flags.error) return response({ error: { code: flags.error, message: 'DO-NOT-DISPLAY-RAW-ERROR' } }, 409);
    const body = JSON.parse(String(init?.body)), parts = url.pathname.split('/');
    const kind = method === 'PATCH' ? 'change' : parts.at(-1) === 'move' ? 'move' : 'add';
    const line = kind === 'add' ? undefined : booking.lines.find(l => l.lineId === parts[5])!;
    const current = line?.assignments.find(a => a.current);
    const target = kind === 'change' ? { ...targetDouble, roomId: current!.roomId, roomNumber: current!.roomNumber }
      : [targetSingle, targetDouble].find(r => r.roomId === body.roomId)!;
    const review: ModificationReview = { kind, bookingId: booking.bookingId, lineId: line?.lineId, roomId: target.roomId, roomNumber: target.roomNumber,
      checkIn: kind === 'move' ? line!.checkIn : body.checkIn, checkOut: kind === 'move' ? line!.checkOut : body.checkOut,
      guestCount: kind === 'move' ? line!.guestCount : body.guestCount, catalogueRate: body.quotedBaseDailyRate,
      agreedRate: kind === 'move' && line!.status === 'CHECKED_IN' ? line!.rateSnapshot : body.quotedBaseDailyRate,
      originalStatus: kind === 'move' ? line!.status as 'BOOKED' | 'CHECKED_IN' : 'BOOKED', input: body };
    const result = mutationResult(review, flags.credit);
    result.line.lineId = line?.lineId ?? next();
    result.line.currentAssignment.assignmentId = kind === 'change' ? current!.assignmentId : next();
    const assignment = { assignmentId: result.line.currentAssignment.assignmentId, roomId: target.roomId, roomNumber: target.roomNumber, branchId: readSession.branchId,
      roomActive: true, operationalStatus: target.operationalStatus, roomType: { roomTypeId: target.roomType.roomTypeId, name: target.roomType.name, capacity: target.roomType.capacity },
      assignedAt: at, unassignedAt: null, occupiedFrom: result.line.currentAssignment.occupiedFrom, occupiedTo: null, current: true };
    if (!line) booking.lines.push({ lineId: result.line.lineId, checkIn: review.checkIn, checkOut: review.checkOut, guestCount: review.guestCount,
      rateSnapshot: review.agreedRate, status: 'BOOKED', createdAt: at, updatedAt: at, assignments: [assignment], revisions: [],
      statusHistory: [{ historyId: next(), oldStatus: null, newStatus: 'BOOKED', changedAt: at, changedBy: id(26), reason: body.reason }] });
    else {
      if (kind === 'change' || (line.status === 'BOOKED' && line.rateSnapshot !== review.agreedRate)) line.revisions.push({ revisionId: next(),
        oldValues: { checkIn: line.checkIn, checkOut: line.checkOut, guestCount: line.guestCount, rateSnapshot: line.rateSnapshot },
        newValues: { checkIn: review.checkIn, checkOut: review.checkOut, guestCount: review.guestCount, rateSnapshot: review.agreedRate }, changedAt: at, changedBy: id(26), reason: body.reason });
      if (kind === 'move') { current!.current = false; current!.unassignedAt = at; if (current!.occupiedFrom) current!.occupiedTo = at; line.assignments.push(assignment); }
      Object.assign(line, { checkIn: review.checkIn, checkOut: review.checkOut, guestCount: review.guestCount, rateSnapshot: review.agreedRate, updatedAt: at });
    }
    booking.updatedAt = at;
    return response({ data: result }, kind === 'add' ? 201 : 200);
  };
  return { flags, transport, read: new StaffBookingReadApi(modificationSession, transport), availability: new AvailabilityApi(transport),
    modifications: new BookingModificationApi(modificationSession, transport), snapshot: () => structuredClone(booking) };
}
