import assert from 'node:assert/strict';
import test from 'node:test';
import {
  StaffBookingReadApi, StaffBookingReadClient, StaffBookingReadError, StaffBookingReadModel, canReadStaffBookings,
  parseBookingPage, parseStaffBookingDetail, progressLabel, summarizeLines, hotelTime,
} from '../src/lib/staffBookingRead.ts';
import { id } from './availabilityFixtures.ts';
import { bookingDetail, listItem, page, readSession, terminalDetail } from './staffBookingReadFixtures.ts';
const client: StaffBookingReadClient = { list: async (limit, offset) => page(offset ? [] : [listItem(), listItem(terminalDetail)], limit, offset), detail: async id => id === terminalDetail.bookingId ? terminalDetail : bookingDetail };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
test('one booking remains one list item with correct mixed-state per-line counts', () => {
  const result = parseBookingPage({ data: page() }, 20, 0);
  assert.equal(result.items.length, 2); assert.equal(result.items[0].lineSummary.total, 2);
  assert.equal(result.items[0].lineSummary.checkedIn, 1); assert.equal(result.items[0].lineSummary.booked, 1);
  assert.equal(progressLabel(result.items[0].lineSummary), 'Mixed line states');
  assert.equal(progressLabel(result.items[1].lineSummary), 'All lines CANCELLED');
  assert.throws(() => parseBookingPage({ data: page([listItem(), listItem()]) }, 20, 0), /inconsistent/);
  const broken = page(); broken.items[0].lineSummary = { ...broken.items[0].lineSummary, total: 1 };
  assert.throws(() => parseBookingPage({ data: broken }, 20, 0));
  assert.throws(() => parseBookingPage({ data: page() }, 20, 20));
});
test('detail preserves two rooms, prior assignments, occupancy instants and old/new line revisions', () => {
  const detail = parseStaffBookingDetail({ data: bookingDetail }, id(30), id(1));
  assert.deepEqual(detail, bookingDetail); assert.deepEqual(summarizeLines(detail.lines), listItem().lineSummary);
  assert.equal(detail.lines[0].assignments[0].roomNumber, '101'); assert.equal(detail.lines[0].assignments[1].roomNumber, '103');
  assert.equal(detail.lines[0].assignments[0].occupiedTo, detail.lines[0].assignments[1].occupiedFrom);
  assert.equal(detail.lines[0].revisions[0].oldValues.rateSnapshot, '10000.50');
  assert.equal(parseStaffBookingDetail({ data: terminalDetail }, id(40), id(1)).lines[0].assignments[0].current, false);
  assert.match(hotelTime('2027-06-01T08:00:00Z'), /13:30:00/);
});
test('guest NIC/contact data and extra server metadata are not stored in the screen DTO', () => {
  const payload = { ...bookingDetail, guest: { ...bookingDetail.guest, nic: 'PRIVATE-IDENTITY', email: 'private@example.test', phone: 'PRIVATE-PHONE' }, internal: 'PRIVATE-METADATA' };
  const detail = parseStaffBookingDetail({ data: payload }, id(30), id(1));
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE|private@example/);
  const item = { ...listItem(), guest: payload.guest }; assert.doesNotMatch(JSON.stringify(parseBookingPage({ data: page([item]) }, 20, 0)), /PRIVATE|private@example/);
});
test('branch mismatch, wrong booking, duplicate lines/assignments and inconsistent lifecycle responses are rejected', () => {
  for (const mutate of [
    (d: typeof bookingDetail) => { d.lines[0].assignments[0].branchId = id(2); },
    (d: typeof bookingDetail) => { d.bookingId = id(99); },
    (d: typeof bookingDetail) => { d.lines[1].lineId = d.lines[0].lineId; },
    (d: typeof bookingDetail) => { d.lines[0].assignments[0].assignmentId = d.lines[0].assignments[1].assignmentId; },
    (d: typeof bookingDetail) => { d.lines[0].assignments[0].current = true; },
    (d: typeof bookingDetail) => { d.lines[1].rateSnapshot = 'NaN'; },
    (d: typeof bookingDetail) => { d.lines[1].checkOut = d.lines[1].checkIn; },
    (d: typeof bookingDetail) => { d.lines[0].assignments[1].occupiedFrom = null; },
  ]) { const broken = structuredClone(bookingDetail); mutate(broken); assert.throws(() => parseStaffBookingDetail({ data: broken }, id(30), id(1))); }
});
test('historical room metadata may change without invalidating agreed rates or past guest capacity', () => {
  const past = structuredClone(terminalDetail); past.lines[0].assignments[0].roomType.capacity = 1; past.lines[0].assignments[0].roomActive = false;
  const parsed = parseStaffBookingDetail({ data: past }, id(40), id(1)); assert.equal(parsed.lines[0].guestCount, 2); assert.equal(parsed.lines[0].rateSnapshot, '18000.00');
});
test('GET adapter sends only bounded pagination and ID paths with credentials, no actor/branch overrides', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api = new StaffBookingReadApi(readSession, async (input, init) => {
    calls.push({ path: String(input), init }); return new Response(JSON.stringify({ data: String(input).includes('?') ? page() : bookingDetail }));
  });
  await api.list(20, 0); await api.detail(id(30).toUpperCase());
  assert.equal(calls[0].path, '/api/bookings?limit=20&offset=0'); assert.equal(calls[1].path, `/api/bookings/${id(30)}`);
  for (const call of calls) { assert.equal(call.init?.method, 'GET'); assert.equal(call.init?.credentials, 'same-origin'); assert.equal(call.init?.body, undefined); assert.equal(call.init?.headers, undefined); }
});
test('absent/wrong role or malformed branch never makes requests, including model calls', async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; return new Response(); };
  for (const session of [null, { ...readSession, role: 'BRANCH_MANAGER' }, { ...readSession, branchId: 'invalid' }]) {
    assert.equal(canReadStaffBookings(session), false); const api = new StaffBookingReadApi(session, transport);
    await assert.rejects(api.list(20, 0), /Sign in/); await assert.rejects(api.detail(id(30)), /Sign in/);
    const model = new StaffBookingReadModel(session, api); await model.loadList(); await model.open(id(30)); assert.equal(model.getSnapshot().page, null); assert.equal(model.getSnapshot().detail, null);
  }
  assert.equal(calls, 0);
});
test('unknown and out-of-branch requests get identical safe 404 messages without leaking server errors', async () => {
  for (const responseStatus of [401, 403, 404, 500]) {
    const api = new StaffBookingReadApi(readSession, async () => new Response(JSON.stringify({ error: { message: 'SQL secret path PRIVATE' } }), { status: responseStatus }));
    await assert.rejects(api.detail(id(30)), (err: StaffBookingReadError) => err.status === responseStatus && !/SQL|PRIVATE/.test(err.message));
  }
  const api = new StaffBookingReadApi(readSession, async () => new Response('{}', { status: 404 }));
  const messages = []; for (const bookingId of [id(30), id(99)]) { try { await api.detail(bookingId); } catch (error) { messages.push((error as Error).message); } }
  assert.equal(messages[0], messages[1]);
});
test('pagination follows returned/limit without inventing a total count; back retains the loaded page', async () => {
  const calls: number[] = [];
  const model = new StaffBookingReadModel(readSession, { ...client, list: async (limit, offset) => { calls.push(offset); return page(offset ? [] : Array.from({ length: 20 }, (_, i) => ({ ...listItem(), bookingId: id(50 + i), bookingRef: `SN-${i}` })), limit, offset); } });
  await model.loadList(); await model.next(); assert.equal(model.getSnapshot().offset, 20); await model.next(); assert.deepEqual(calls, [0, 20]);
  await model.previous(); await model.open(id(30)); model.back(); assert.equal(model.getSnapshot().page?.items.length, 20); assert.equal(model.getSnapshot().selectedId, null);
});
test('late list/detail responses and cancelled views cannot overwrite newer results', async () => {
  const pending = deferred<typeof bookingDetail>();
  const model = new StaffBookingReadModel(readSession, { ...client, detail: id => id === bookingDetail.bookingId ? pending.promise : Promise.resolve(terminalDetail) });
  const old = model.open(id(30)); await model.open(id(40)); pending.resolve(bookingDetail); await old; assert.equal(model.getSnapshot().detail?.bookingId, id(40));
  const slowPage = deferred<ReturnType<typeof page>>(); let first = true;
  const pages = new StaffBookingReadModel(readSession, { ...client, list: (limit, offset) => first ? (first = false, slowPage.promise) : Promise.resolve(page([], limit, offset)) });
  const load = pages.loadList(); await pages.loadList(20); slowPage.resolve(page()); await load; assert.equal(pages.getSnapshot().offset, 20); assert.equal(pages.getSnapshot().page?.items.length, 0);
  const cancel = new StaffBookingReadModel(readSession, { ...client, detail: () => pending.promise }); const request = cancel.open(id(30)); cancel.back(); await request; assert.equal(cancel.getSnapshot().detail, null);
});
test('failed or denied detail clears prior booking; authorization failure clears both list and detail', async () => {
  let denied = false;
  const model = new StaffBookingReadModel(readSession, { ...client, detail: async () => { if (denied) throw new StaffBookingReadError('Denied', 'FORBIDDEN', 403); return bookingDetail; } });
  await model.loadList(); await model.open(id(30)); denied = true; await model.open(id(99));
  assert.equal(model.getSnapshot().detail, null); assert.equal(model.getSnapshot().page, null); assert.equal(model.getSnapshot().detailFailure?.status, 403);
  const missing = new StaffBookingReadModel(readSession, { ...client, detail: async () => { throw new StaffBookingReadError('Not found', 'BOOKING_NOT_FOUND', 404); } });
  await missing.open(id(99)); assert.equal(missing.getSnapshot().detail, null);
});
test('default native fetch binding works; malformed JSON, network errors and invalid pagination are rejected', async () => {
  const original = globalThis.fetch;
  try { globalThis.fetch = async function(this: unknown) { assert.equal(this, undefined); return new Response(JSON.stringify({ data: page() })); }; await new StaffBookingReadApi(readSession).list(20, 0); }
  finally { globalThis.fetch = original; }
  for (const transport of [async () => new Response('bad json'), async () => { throw new Error('PRIVATE network details'); }]) await assert.rejects(new StaffBookingReadApi(readSession, transport).list(20, 0));
  let calls = 0; const api = new StaffBookingReadApi(readSession, async () => { calls++; return new Response(); });
  await assert.rejects(api.list(101, 0)); await assert.rejects(api.list(20, -1)); await assert.rejects(api.detail('not-a-uuid')); assert.equal(calls, 0);
});
