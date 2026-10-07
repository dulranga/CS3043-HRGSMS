import { bookingDetail, terminalDetail } from './staffBookingReadFixtures';
import { id } from './availabilityFixtures';
import { GuestBookingDetail, GuestBookingListItem, GuestBookingPage, GuestBookingReadSession, parseGuestBookingDetail } from '../src/lib/guestBookingRead';

export const guestReadSession: GuestBookingReadSession = { accountKind: 'guest' };
// Test data only; the guest endpoint shape has no staff/owner identity fields.
export const guestReadDetail = parseGuestBookingDetail({ data: bookingDetail }, bookingDetail.bookingId);
export const guestEndedDetail: GuestBookingDetail = {
  ...parseGuestBookingDetail({ data: terminalDetail }, terminalDetail.bookingId), bookingRef: 'SN-SAMPLE-ENDED',
};
export function guestListItem(detail = guestReadDetail): GuestBookingListItem {
  const tally = (s: string) => detail.lines.filter(l => l.status === s).length;
  const { lines, ...header } = detail;
  return { ...header, lineSummary: { total: lines.length, booked: tally('BOOKED'), checkedIn: tally('CHECKED_IN'), checkedOut: tally('CHECKED_OUT'), cancelled: tally('CANCELLED'), noShow: tally('NO_SHOW'),
    firstStayDate: lines.map(l => l.checkIn).sort()[0], lastStayDate: lines.map(l => l.checkOut).sort().at(-1)! } };
}
export const guestReadPage = (items = [guestListItem(), guestListItem(guestEndedDetail)], limit = 20, offset = 0): GuestBookingPage => ({ items, pagination: { limit, offset, returned: items.length } });
export const guestUnknownId = id(98), guestOtherOwnerId = id(99);
export function guestAllStatesDetail(): GuestBookingDetail {
  const result = structuredClone(guestReadDetail), released = '2027-06-06T08:00:00Z';
  const ended = ['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const;
  result.lines.push(...ended.map((status, index) => ({ ...structuredClone(guestReadDetail.lines[1]), lineId: id(75 + index), status,
    assignments: [{ ...structuredClone(guestReadDetail.lines[1].assignments[0]), assignmentId: id(80 + index), roomNumber: String(104 + index), unassignedAt: released, current: false,
      occupiedFrom: status === 'CHECKED_OUT' ? '2027-06-02T08:00:00Z' : null, occupiedTo: status === 'CHECKED_OUT' ? released : null }],
    statusHistory: [{ historyId: id(85 + index), oldStatus: status === 'CHECKED_OUT' ? 'CHECKED_IN' as const : 'BOOKED' as const, newStatus: status, changedAt: released }], revisions: [],
  })));
  return result;
}
export function createGuestReadFixture() {
  const flags = { denied: false, expired: false, offline: false, empty: false, many: false, allStates: false };
  let requests = 0;
  const transport: typeof fetch = async (input, init) => {
    requests++;
    if (init?.method !== 'GET') throw new Error('The own-booking fixture is read only.');
    if (flags.denied || flags.expired) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'PRIVATE INTERNAL MESSAGE' } }), { status: flags.expired ? 401 : 403 });
    if (flags.offline) throw new TypeError('Sample offline');
    const url = new URL(String(input), 'http://fixture.local');
    const details = [flags.allStates ? guestAllStatesDetail() : guestReadDetail, guestEndedDetail,
      ...(flags.many ? Array.from({ length: 19 }, (_, index) => ({ ...guestEndedDetail, bookingId: id(50 + index), bookingRef: `SN-SAMPLE-HISTORY-${index + 1}` })) : [])];
    if (url.pathname === '/api/guest/bookings') {
      const limit = Number(url.searchParams.get('limit')), offset = Number(url.searchParams.get('offset'));
      return new Response(JSON.stringify({ data: guestReadPage(flags.empty ? [] : details.slice(offset, offset + limit).map(d => guestListItem(d)), limit, offset) }));
    }
    const detail = details.find(d => d.bookingId === url.pathname.split('/').at(-1));
    if (!detail) return new Response(JSON.stringify({ error: { code: 'BOOKING_NOT_FOUND' } }), { status: 404 });
    return new Response(JSON.stringify({ data: { ...detail, guestId: id(25), createdBy: id(26), nic: 'SAMPLE-DO-NOT-RETAIN' } }));
  };
  return { flags, transport, requestCount: () => requests };
}
