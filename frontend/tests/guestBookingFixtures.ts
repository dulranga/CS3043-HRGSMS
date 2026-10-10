import { AvailabilityApi } from '../src/lib/availability';
import { GuestBookingApi, GuestBookingInput, GuestBookingQuote, GuestBookingSession, CreatedGuestBooking } from '../src/lib/guestBooking';
import { provisionalBookingTotal } from '../src/lib/staffBooking';
import { id, single, double, options, envelope } from './availabilityFixtures';
import { quoteFor, selections } from './staffBookingFixtures';
export const guestSession: GuestBookingSession = { accountKind: 'guest', mutationHeaders: async () => ({ 'X-Fixture-CSRF': 'sample-only' }) };
export function guestQuoteFor(lines = selections): GuestBookingQuote { return { branchId: id(1), ...quoteFor(lines) }; }
export function guestCreatedFor(input: GuestBookingInput, quote = guestQuoteFor(input.lines)): CreatedGuestBooking {
  const lines = input.lines.map((l, index) => ({ roomId: l.roomId, checkIn: l.checkIn, checkOut: l.checkOut, guestCount: l.guestCount,
    lineId: id(32 + index), roomNumber: l.roomId === single.roomId ? '101' : '102', roomTypeId: l.quotedRoomTypeId,
    roomTypeName: l.quotedRoomTypeId === single.roomType.roomTypeId ? 'Single' : 'Double', rateSnapshot: l.quotedBaseDailyRate, status: 'BOOKED' as const }));
  return { bookingId: id(30), bookingRef: 'SN-GUEST-SAMPLE-001', bookingChannel: 'DIRECT_ONLINE', createdAt: '2026-10-07T00:00:00Z',
    invoice: { invoiceId: id(31), billingPolicyId: input.quotedBillingPolicyId, status: 'DRAFT',
      total: provisionalBookingTotal({ ...quote, lines: quote.lines.map(l => ({ ...l, baseDailyRate: input.lines.find(i => i.roomId === l.roomId && i.checkIn === l.checkIn)!.quotedBaseDailyRate })) }).total }, lines };
}
// In-memory sample only; it never sends a request outside this function.
export function createGuestBookingFixture() {
  const flags = { changed: false, conflict: false, denied: false, unknown: false, noPolicy: false };
  let createdCount = 0;
  const rooms = () => [single, double].filter(r => !flags.conflict || r.roomId !== double.roomId).map(r => ({ ...r,
    roomType: { ...r.roomType, baseDailyRate: flags.changed && r.roomId === single.roomId ? '12000.25' : r.roomType.baseDailyRate } }));
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://fixture.local');
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    const error = (code: string, status = 409) => response({ error: { code, message: 'RAW-ERROR-MUST-NOT-LEAK' } }, status);
    if (url.pathname === '/api/availability/options') return response({ data: options });
    if (url.pathname === '/api/availability') {
      const criteria = { branchId: url.searchParams.get('branchId')!, checkIn: url.searchParams.get('checkIn')!, checkOut: url.searchParams.get('checkOut')!,
        guestCount: Number(url.searchParams.get('guestCount')), roomTypeId: url.searchParams.get('roomTypeId'), immediateCheckIn: url.searchParams.get('immediateCheckIn') === 'true' };
      return response(envelope(rooms().filter(r => r.roomType.capacity >= criteria.guestCount && (!criteria.roomTypeId || r.roomType.roomTypeId === criteria.roomTypeId))
        .map(r => ({ ...r, branchId: criteria.branchId })), criteria));
    }
    if (flags.denied) return error('FORBIDDEN', 403);
    if (flags.noPolicy) return error('POLICY_UNAVAILABLE');
    const body = JSON.parse(String(init?.body));
    if (body.lines.some((l: any) => !rooms().some(r => r.roomId === l.roomId))) return error('INVENTORY_CONFLICT');
    const quote = guestQuoteFor(body.lines); quote.branchId = body.branchId;
    if (flags.changed) { quote.billingPolicy.billingPolicyId = id(21); quote.billingPolicy.taxPercent = '15.00'; quote.billingPolicy.createdAt = '2026-10-07T00:00:00Z'; }
    quote.lines = quote.lines.map(l => ({ ...l, baseDailyRate: rooms().find(r => r.roomId === l.roomId)!.roomType.baseDailyRate }));
    if (url.pathname.endsWith('/quote')) return response({ data: quote });
    if (flags.unknown) throw new TypeError('Sample unknown confirmation');
    if (body.quotedBillingPolicyId !== quote.billingPolicy.billingPolicyId || body.lines.some((l: any) => !quote.lines.some(q => q.roomId === l.roomId && q.baseDailyRate === l.quotedBaseDailyRate && q.roomTypeId === l.quotedRoomTypeId))) return error('REQUOTE_REQUIRED');
    createdCount++;
    return response({ data: { ...guestCreatedFor(body, quote), guestId: id(42), createdBy: id(43), nic: 'HIDDEN-SAMPLE-NIC' } }, 201);
  };
  return { flags, transport, availability: new AvailabilityApi(transport), bookings: new GuestBookingApi(guestSession, transport), createdCount: () => createdCount };
}
