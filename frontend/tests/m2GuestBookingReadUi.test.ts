import assert from 'node:assert/strict';
import test from 'node:test';
import { GuestBookingReadApi, GuestBookingReadClient, GuestBookingReadError, GuestBookingReadModel, parseGuestBookingDetail, parseGuestBookingPage } from '../src/lib/guestBookingRead';
import { guestReadDetail, guestReadPage, guestReadSession, guestUnknownId, guestOtherOwnerId, guestAllStatesDetail, createGuestReadFixture } from './guestBookingReadFixtures';
import { bookingDetail } from './staffBookingReadFixtures';
import { id } from './availabilityFixtures';

function setup() { const fixture = createGuestReadFixture(), api = new GuestBookingReadApi(guestReadSession, fixture.transport); return { fixture, api, model: new GuestBookingReadModel(guestReadSession, api) }; }
test('guest reads use only scoped GET endpoints, same-origin credentials and bounded pagination without authority overrides', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = new GuestBookingReadApi(guestReadSession, async (input, init) => {
    calls.push({ url: String(input), init }); return new Response(JSON.stringify({ data: String(input).includes('?') ? guestReadPage() : guestReadDetail }));
  });
  await api.list(20, 0); await api.detail(guestReadDetail.bookingId);
  assert.equal(calls[0].url, '/api/guest/bookings?limit=20&offset=0'); assert.equal(calls[1].url, `/api/guest/bookings/${guestReadDetail.bookingId}`);
  for (const c of calls) { assert.equal(c.init?.method, 'GET'); assert.equal(c.init?.credentials, 'same-origin'); assert.equal(c.init?.body, undefined); assert.equal(c.init?.headers, undefined); }
  assert.doesNotMatch(JSON.stringify(calls), /x-user-id|guestId|actor|branchId|\/api\/bookings/);
});
test('both unknown and another owner guessed UUID return exactly the same safe error without any detail', async () => {
  const { model } = setup(); await model.open(guestReadDetail.bookingId); assert.ok(model.getSnapshot().detail);
  await model.open(guestUnknownId); const unknown = model.getSnapshot().detailFailure;
  assert.equal(model.getSnapshot().detail, null); assert.equal(unknown?.status, 404);
  await model.open(guestOtherOwnerId); const foreign = model.getSnapshot().detailFailure;
  assert.equal(foreign?.message, unknown?.message); assert.equal(foreign?.code, unknown?.code); assert.equal(model.getSnapshot().detail, null);
});
test('guest detail preserves separately dated/priced lines, previous room moves, occupancy and revisions', () => {
  const d = parseGuestBookingDetail({ data: bookingDetail }, bookingDetail.bookingId);
  assert.equal(d.lines.length, 2); assert.equal(d.lines[0].rateSnapshot, '11000.00'); assert.equal(d.lines[1].rateSnapshot, '18000.00');
  assert.equal(d.lines[0].checkOut, '2027-06-04'); assert.equal(d.lines[1].checkOut, '2027-06-06');
  assert.deepEqual(d.lines[0].assignments.map(a => a.roomNumber), ['101', '103']); assert.equal(d.lines[0].assignments[0].occupiedTo, d.lines[0].assignments[1].occupiedFrom);
  assert.equal(d.lines[0].revisions[0].oldValues.rateSnapshot, '10000.50'); assert.equal(d.lines[0].revisions[0].newValues.rateSnapshot, '11000.00');
  assert.equal(d.bookingChannel, 'FRONT_DESK'); // Own staff-assisted records also belong in this history.
});
test('all five room states remain in a single owned booking; closed histories are retained', () => {
  const d = parseGuestBookingDetail({ data: guestAllStatesDetail() }, guestReadDetail.bookingId);
  assert.deepEqual(d.lines.map(l => l.status), ['CHECKED_IN', 'BOOKED', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']); assert.equal(d.lines[4].assignments[0].current, false);
});
test('projection excludes NIC/contact/guest/staff identifiers, operational metadata and free-text staff reasons', () => {
  const d = structuredClone(bookingDetail) as any; d.guest.nic = 'SECRET-NIC'; d.guest.phone = 'SECRET-PHONE'; d.lines[0].statusHistory[0].reason = 'SECRET-NOTE';
  const parsed = parseGuestBookingDetail({ data: d }, d.bookingId); const list = parseGuestBookingPage({ data: { ...guestReadPage(), pagination: { limit: 20, offset: 0, returned: 1 }, items: [{ ...guestReadPage().items[0], guest: d.guest, createdBy: d.createdBy }] } }, 20, 0);
  assert.doesNotMatch(JSON.stringify(parsed), /SECRET|changedBy|createdBy|guestId|roomActive|branchId|operationalStatus|reason/);
  assert.doesNotMatch(JSON.stringify(list), /SECRET|createdBy|guestId/);
});
test('invalid identity, page sizes, offsets or malformed deep-link IDs do not reach the network', async () => {
  let requests = 0; const transport: typeof fetch = async () => { requests++; throw new Error('Unexpected request'); };
  for (const session of [null, { accountKind: 'staff' }, { accountKind: 'other' }]) {
    const model = new GuestBookingReadModel(session, new GuestBookingReadApi(session, transport)); await model.loadList(); assert.equal(model.getSnapshot().denied, true);
  }
  const api = new GuestBookingReadApi(guestReadSession, transport);
  for (const [limit, offset] of [[0, 0], [101, 0], [20, -1], [20, 1.5]]) await assert.rejects(api.list(limit, offset));
  await assert.rejects(api.detail('not-an-id')); assert.equal(requests, 0);
});
test('bounded pagination, empty final page and previous-page recovery use the server returned count', async () => {
  const { fixture, model } = setup(); fixture.flags.many = true; await model.loadList(); assert.equal(model.getSnapshot().page?.items.length, 20);
  await model.next(); assert.equal(model.getSnapshot().offset, 20); assert.equal(model.getSnapshot().page?.items.length, 1);
  await model.next(); assert.equal(model.getSnapshot().offset, 20);
  await model.previous(); assert.equal(model.getSnapshot().page?.items.length, 20); await model.previous(); assert.equal(model.getSnapshot().offset, 0);
  fixture.flags.empty = true; await model.loadList(); assert.equal(model.getSnapshot().page?.items.length, 0);
});
test('expired or denied reads clear both list and detail and block further reads in that session model', async () => {
  for (const flag of ['denied', 'expired'] as const) {
    const { fixture, model } = setup(); await model.loadList(); await model.open(guestReadDetail.bookingId); fixture.flags[flag] = true; await model.open(guestReadDetail.bookingId);
    const state = model.getSnapshot(); assert.equal(state.page, null); assert.equal(state.detail, null); assert.equal(state.selectedId, null); assert.equal(state.denied, true);
    const count = fixture.requestCount(); await model.loadList(); await model.open(guestReadDetail.bookingId); assert.equal(fixture.requestCount(), count);
    assert.doesNotMatch(state.detailFailure!.message, /PRIVATE INTERNAL/);
  }
});
test('failed reads clear stale display data and can be reloaded after connection recovery', async () => {
  const { fixture, model } = setup(); await model.loadList(); fixture.flags.offline = true; await model.loadList(); assert.equal(model.getSnapshot().page, null);
  assert.equal(model.getSnapshot().listFailure?.code, 'NETWORK_ERROR'); fixture.flags.offline = false; await model.loadList(); assert.ok(model.getSnapshot().page);
  await model.open(guestReadDetail.bookingId); fixture.flags.offline = true; await model.open(guestReadDetail.bookingId); assert.equal(model.getSnapshot().detail, null);
});
test('mismatched IDs, duplicate lines/history, invalid dates/rates/states or inconsistent assignments are rejected', () => {
  for (const mutate of [
    (d: any) => { d.bookingId = id(90); }, (d: any) => { d.lines.push(d.lines[0]); }, (d: any) => { d.lines[0].checkOut = d.lines[0].checkIn; },
    (d: any) => { d.lines[0].rateSnapshot = 'NaN'; }, (d: any) => { d.lines[0].status = 'RESERVED'; }, (d: any) => { d.lines[0].assignments[0].current = true; },
    (d: any) => { d.lines[0].assignments[1].occupiedFrom = null; }, (d: any) => { d.lines[0].statusHistory.push(d.lines[0].statusHistory[0]); },
  ]) { const d = structuredClone(guestReadDetail); mutate(d); assert.throws(() => parseGuestBookingDetail({ data: d }, guestReadDetail.bookingId), GuestBookingReadError); }
  const p = guestReadPage(); p.items[0].lineSummary.booked = 50; assert.throws(() => parseGuestBookingPage({ data: p }, 20, 0));
  assert.throws(() => parseGuestBookingPage({ data: guestReadPage() }, 20, 20));
});
test('late detail responses and abandoned reads cannot repopulate a different booking or closed detail', async () => {
  let resolveFirst!: (d: typeof guestReadDetail) => void;
  const delayed = new Promise<typeof guestReadDetail>(resolve => { resolveFirst = resolve; });
  const client: GuestBookingReadClient = { list: async () => guestReadPage(), detail: async key => key === guestReadDetail.bookingId ? delayed : Promise.reject(new GuestBookingReadError('Booking not found.', 'BOOKING_NOT_FOUND', 404)) };
  const model = new GuestBookingReadModel(guestReadSession, client), first = model.open(guestReadDetail.bookingId); await model.open(guestOtherOwnerId);
  resolveFirst(guestReadDetail); await first; assert.equal(model.getSnapshot().detail, null); assert.equal(model.getSnapshot().selectedId, guestOtherOwnerId);
  let resolveLast!: (d: typeof guestReadDetail) => void; const model2 = new GuestBookingReadModel(guestReadSession, { ...client, detail: () => new Promise(resolve => { resolveLast = resolve; }) });
  const pending = model2.open(guestReadDetail.bookingId); model2.back(); resolveLast(guestReadDetail); await pending; assert.equal(model2.getSnapshot().detail, null); assert.equal(model2.getSnapshot().selectedId, null);
});
test('a denied concurrent list invalidates an in-flight detail response and clears private state', async () => {
  let resolve!: (d: typeof guestReadDetail) => void;
  const client: GuestBookingReadClient = { list: async () => { throw new GuestBookingReadError('Sign in again.', 'FORBIDDEN', 403); }, detail: () => new Promise(r => { resolve = r; }) };
  const model = new GuestBookingReadModel(guestReadSession, client), pending = model.open(guestReadDetail.bookingId); await model.loadList(); resolve(guestReadDetail); await pending;
  assert.equal(model.getSnapshot().denied, true); assert.equal(model.getSnapshot().detail, null);
});
