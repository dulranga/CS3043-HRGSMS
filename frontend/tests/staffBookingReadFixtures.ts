import { BookingPage, StaffBookingDetail, StaffBookingListItem, StaffBookingReadSession, summarizeLines } from '../src/lib/staffBookingRead';
import { id } from './availabilityFixtures';
export const readSession: StaffBookingReadSession = { role: 'FRONT_DESK', branchId: id(1) };
const createdAt = '2027-05-01T00:00:00Z', checkedIn = '2027-06-01T08:00:00Z', movedAt = '2027-06-02T08:00:00Z';
export const bookingDetail: StaffBookingDetail = {
  bookingId: id(30), bookingRef: 'SN-SAMPLE-MULTI', bookingChannel: 'FRONT_DESK', createdAt, updatedAt: movedAt, createdBy: id(26),
  guest: { guestId: id(25), fullName: 'Sample Guest' },
  lines: [
    { lineId: id(10), checkIn: '2027-06-01', checkOut: '2027-06-04', guestCount: 1, rateSnapshot: '11000.00', status: 'CHECKED_IN', createdAt, updatedAt: movedAt,
      assignments: [
        { assignmentId: id(12), roomId: id(5), roomNumber: '101', branchId: id(1), roomActive: true, operationalStatus: 'READY',
          roomType: { roomTypeId: id(3), name: 'Single', capacity: 1 }, assignedAt: createdAt, unassignedAt: movedAt, occupiedFrom: checkedIn, occupiedTo: movedAt, current: false },
        { assignmentId: id(13), roomId: id(8), roomNumber: '103', branchId: id(1), roomActive: true, operationalStatus: 'READY',
          roomType: { roomTypeId: id(3), name: 'Single', capacity: 1 }, assignedAt: movedAt, unassignedAt: null, occupiedFrom: movedAt, occupiedTo: null, current: true },
      ],
      statusHistory: [
        { historyId: id(15), oldStatus: null, newStatus: 'BOOKED', changedAt: createdAt, changedBy: id(26), reason: 'Created reservation' },
        { historyId: id(16), oldStatus: 'BOOKED', newStatus: 'CHECKED_IN', changedAt: checkedIn, changedBy: id(26), reason: 'Guest arrived' },
      ], revisions: [{ revisionId: id(18), oldValues: { checkIn: '2027-06-01', checkOut: '2027-06-03', guestCount: 1, rateSnapshot: '10000.50' },
        newValues: { checkIn: '2027-06-01', checkOut: '2027-06-04', guestCount: 1, rateSnapshot: '11000.00' },
        changedAt: '2027-05-20T00:00:00Z', changedBy: id(26), reason: 'Guest extended reserved stay before check-in' }],
    },
    { lineId: id(11), checkIn: '2027-06-02', checkOut: '2027-06-06', guestCount: 2, rateSnapshot: '18000.00', status: 'BOOKED', createdAt, updatedAt: createdAt,
      assignments: [{ assignmentId: id(14), roomId: id(7), roomNumber: '102', branchId: id(1), roomActive: true, operationalStatus: 'CLEANING',
        roomType: { roomTypeId: id(4), name: 'Double', capacity: 2 }, assignedAt: createdAt, unassignedAt: null, occupiedFrom: null, occupiedTo: null, current: true }],
      statusHistory: [{ historyId: id(17), oldStatus: null, newStatus: 'BOOKED', changedAt: createdAt, changedBy: id(26), reason: 'Created reservation' }], revisions: [],
    },
  ],
};
export const terminalDetail: StaffBookingDetail = {
  ...bookingDetail, bookingId: id(40), bookingRef: 'SN-SAMPLE-CANCELLED',
  lines: [{ ...bookingDetail.lines[1], status: 'CANCELLED', updatedAt: '2027-05-30T00:00:00Z',
    assignments: [{ ...bookingDetail.lines[1].assignments[0], unassignedAt: '2027-05-30T00:00:00Z', current: false }],
    statusHistory: [...bookingDetail.lines[1].statusHistory, { historyId: id(19), oldStatus: 'BOOKED', newStatus: 'CANCELLED', changedAt: '2027-05-30T00:00:00Z', changedBy: id(26), reason: 'Guest cancelled before arrival' }],
  }],
};
export function listItem(detail = bookingDetail): StaffBookingListItem {
  const { lines, ...header } = detail; return { ...header, lineSummary: summarizeLines(lines) };
}
export const page = (items = [listItem(), listItem(terminalDetail)], limit = 20, offset = 0): BookingPage => ({ items, pagination: { limit, offset, returned: items.length } });
