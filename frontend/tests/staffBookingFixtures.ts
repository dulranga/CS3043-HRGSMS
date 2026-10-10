import type { SelectedRoomLine } from '../src/lib/availability';
import type { BookingQuote, BookingSelection, CreatedStaffBooking, StaffBookingInput, StaffBookingSession } from '../src/lib/staffBooking';
import { double, id, search, single } from './availabilityFixtures';
export const session: StaffBookingSession = { role: 'FRONT_DESK', branchId: id(1), mutationHeaders: async () => ({}) };
export const selected: SelectedRoomLine[] = [
  { selectionId: 'a', room: single, search, check: 'available', issue: null },
  { selectionId: 'b', room: double, search: { ...search, checkIn: '2027-06-02', checkOut: '2027-06-06', guestCount: 2 }, check: 'available', issue: null },
];
export const selections: BookingSelection[] = selected.map(line => ({ roomId: line.room.roomId, checkIn: line.search.checkIn, checkOut: line.search.checkOut, guestCount: line.search.guestCount }));
export function quoteFor(lines = selections, patch: Partial<BookingQuote['billingPolicy']> = {}): BookingQuote {
  return { billingPolicy: { billingPolicyId: id(20), effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00Z',
    taxPercent: '12.00', serviceChargePercent: '10.00', maxDiscountPercent: '5.00', cancellationFee: '500.00', noShowFee: '700.00', lateCheckoutFee: '1000.00', noShowGraceDays: 1, ...patch },
    lines: lines.map(line => {
      const room = line.roomId === single.roomId ? single : double;
      return { ...line, roomNumber: room.roomNumber, roomTypeId: room.roomType.roomTypeId, roomTypeName: room.roomType.name, capacity: room.roomType.capacity, baseDailyRate: room.roomType.baseDailyRate };
    }) };
}
export function createdFor(input: StaffBookingInput): CreatedStaffBooking {
  return { bookingId: id(30), bookingRef: 'SN-SAMPLE-001', guestId: input.guestId, bookingChannel: input.bookingChannel, createdAt: '2026-10-06T00:00:00Z',
    invoice: { invoiceId: id(31), billingPolicyId: input.quotedBillingPolicyId, status: 'DRAFT', total: '125665.85' },
    lines: input.lines.map((line, index) => ({ roomId: line.roomId, checkIn: line.checkIn, checkOut: line.checkOut, guestCount: line.guestCount,
      lineId: id(32 + index), roomNumber: line.roomId === single.roomId ? '101' : '102', roomTypeId: line.quotedRoomTypeId,
      roomTypeName: line.roomId === single.roomId ? 'Single' : 'Double', rateSnapshot: line.quotedBaseDailyRate, status: 'BOOKED' })) };
}
