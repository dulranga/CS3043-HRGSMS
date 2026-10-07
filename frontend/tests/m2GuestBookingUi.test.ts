import assert from 'node:assert/strict';
import test from 'node:test';
import { GuestBookingApi, GuestBookingError, GuestBookingModel, GuestBookingInput, parseCreatedGuestBooking, parseGuestBookingQuote, validateGuestLines } from '../src/lib/guestBooking.ts';
import { AvailabilityModel } from '../src/lib/availability.ts';
import { provisionalBookingTotal } from '../src/lib/staffBooking.ts';
import { guestSession, guestQuoteFor, guestCreatedFor, createGuestBookingFixture } from './guestBookingFixtures.ts';
import { selected, selections } from './staffBookingFixtures.ts';
import { id, single, search } from './availabilityFixtures.ts';
const inputFor = (quote = guestQuoteFor()): GuestBookingInput => ({ branchId: quote.branchId, quotedBillingPolicyId: quote.billingPolicy.billingPolicyId,
  lines: quote.lines.map(l => ({ roomId: l.roomId, checkIn: l.checkIn, checkOut: l.checkOut, guestCount: l.guestCount, quotedRoomTypeId: l.roomTypeId, quotedBaseDailyRate: l.baseDailyRate })) });
async function setup() { const fixture = createGuestBookingFixture(), model = new GuestBookingModel(guestSession, fixture.bookings); model.setLines(selected); await model.requestQuote(); return { model, fixture }; }

test('two independently dated rooms quote exact per-line rates and combined policy calculation', async () => {
  const { model } = await setup(), q = model.getSnapshot().quote!;
  assert.equal(q.lines[0].baseDailyRate, '10000.50'); assert.equal(q.lines[1].baseDailyRate, '18000.00');
  assert.equal(q.lines[1].checkIn, '2027-06-02'); assert.equal(q.lines[1].guestCount, 2);
  assert.deepEqual(provisionalBookingTotal(q), { roomAmounts: ['30001.50', '72000.00'], roomSubtotal: '102001.50', serviceCharge: '10200.15', tax: '13464.20', total: '125665.85' });
});
test('explicit acknowledgement is required and success contains all server-agreed lines under one direct booking', async () => {
  const { model, fixture } = await setup(); await model.confirm(); assert.equal(fixture.createdCount(), 0);
  model.acknowledge(); await model.confirm(); assert.equal(fixture.createdCount(), 1); assert.equal(model.getSnapshot().created?.lines.length, 2);
  assert.equal(model.getSnapshot().created?.bookingChannel, 'DIRECT_ONLINE'); assert.equal(model.getSnapshot().created?.invoice.status, 'DRAFT');
  await model.confirm(); model.setLines([]); assert.equal(fixture.createdCount(), 1); assert.ok(model.getSnapshot().created);
});
test('a changed rate or same-date corrected policy requires a fresh quote and renewed confirmation', async () => {
  const { model, fixture } = await setup(); model.acknowledge(); fixture.flags.changed = true; await model.confirm();
  assert.equal(fixture.createdCount(), 0); assert.equal(model.getSnapshot().failure?.code, 'REQUOTE_REQUIRED');
  assert.equal(model.getSnapshot().quote, null); assert.equal(model.getSnapshot().acknowledged, false); assert.deepEqual(model.getSnapshot().lines, selected);
  await model.requestQuote(); assert.equal(model.getSnapshot().quote?.billingPolicy.billingPolicyId, id(21)); assert.equal(model.getSnapshot().quote?.lines[0].baseDailyRate, '12000.25');
  assert.match(model.getSnapshot().notice, /prices changed/); await model.confirm(); assert.equal(fixture.createdCount(), 0);
  model.acknowledge(); await model.confirm(); assert.equal(fixture.createdCount(), 1); assert.equal(model.getSnapshot().created?.invoice.billingPolicyId, id(21));
});
test('one unavailable room rejects the whole booking and rechecking all lines preserves the draft for correction', async () => {
  const { model, fixture } = await setup(); fixture.flags.conflict = true; model.acknowledge(); await model.confirm();
  assert.equal(fixture.createdCount(), 0); assert.equal(model.getSnapshot().created, null); assert.equal(model.getSnapshot().lines.length, 2); assert.match(model.getSnapshot().failure!.message, /No part/);
  const availability = new AvailabilityModel(fixture.availability); await availability.loadOptions();
  for (const l of selected) { availability.setDraft({ ...l.search, guestCount: String(l.search.guestCount), roomTypeId: '' });
    // Restore inventory while selecting, then remove it before the recheck.
    fixture.flags.conflict = false; await availability.search(); availability.add(l.room.roomId);
  }
  fixture.flags.conflict = true; await availability.recheck(); model.setLines(availability.getSnapshot().selected);
  assert.equal(model.getSnapshot().lines[1].check, 'unavailable'); assert.equal(model.getSnapshot().failure?.code, 'INVENTORY_CONFLICT');
  await model.requestQuote(); assert.equal(model.getSnapshot().quote, null); assert.equal(fixture.createdCount(), 0);
});
test('selection edits or removals invalidate quote/acknowledgement without cancelling an existing booking', async () => {
  const { model } = await setup(); model.acknowledge(); model.setLines([selected[0]]);
  assert.equal(model.getSnapshot().quote, null); assert.equal(model.getSnapshot().acknowledged, false); await model.requestQuote(); assert.equal(model.getSnapshot().quote?.lines.length, 1);
});
test('selection validation rejects mixed branches, invalid dates/capacity, unverified rooms and overlap but accepts adjacent stays', () => {
  for (const lines of [[], [{ ...selected[0], search: { ...search, checkIn: '2027-02-30' } }], [{ ...selected[0], search: { ...search, guestCount: 2 } }],
    [selected[0], { ...selected[1], search: { ...selected[1].search, branchId: id(2) } }], [selected[0], selected[0]], [{ ...selected[0], check: 'unverified' as const }]]) assert.throws(() => validateGuestLines(lines), GuestBookingError);
  assert.equal(validateGuestLines([selected[0], { ...selected[0], selectionId: 'later', search: { ...search, checkIn: search.checkOut, checkOut: '2027-06-06' } }]).lines.length, 2);
});
test('two rooms of the same type keep the same rate in a shared quote', () => {
  const second = { ...selected[0], selectionId: 'second', room: { ...single, roomId: id(8), roomNumber: '103' } }, chosen = validateGuestLines([selected[0], second]);
  const quote = guestQuoteFor(chosen.lines); quote.lines[1] = { ...quote.lines[0], ...chosen.lines[1], roomNumber: '103' };
  assert.equal(parseGuestBookingQuote({ data: quote }, id(1), chosen.lines).lines[1].baseDailyRate, '10000.50');
  quote.lines[1].baseDailyRate = '0.00'; assert.throws(() => parseGuestBookingQuote({ data: quote }, id(1), chosen.lines), GuestBookingError);
});
test('guest API uses only guest paths, credentials and verified CSRF headers with no owner/channel/actor overrides', async () => {
  const requests: any[] = [], input = inputFor();
  const api = new GuestBookingApi(guestSession, async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify({ data: String(url).endsWith('/quote') ? guestQuoteFor() : guestCreatedFor(input) })); });
  await api.quote(id(1), selections.map(l => ({ ...l, guestId: id(99) })) as any);
  await api.create({ ...input, guestId: id(99), authenticatedUserId: id(98), bookingChannel: 'FRONT_DESK', createdBy: id(97) } as any);
  assert.deepEqual(requests.map(r => r.url), ['/api/guest/bookings/quote', '/api/guest/bookings']);
  for (const r of requests) {
    assert.equal(r.init.method, 'POST'); assert.equal(r.init.credentials, 'same-origin'); assert.equal(new Headers(r.init.headers).get('X-Fixture-CSRF'), 'sample-only');
    assert.doesNotMatch(r.init.body, /guestId|authenticatedUserId|bookingChannel|createdBy|rateSnapshot/);
  }
  assert.deepEqual(Object.keys(JSON.parse(requests[1].init.body)).sort(), ['branchId', 'quotedBillingPolicyId', 'lines'].sort());
});
test('guest DTO drops identifiers and sensitive extras and rejects wrong channel, policy, line/rate or branch responses', () => {
  const input = inputFor(), created = guestCreatedFor(input);
  const parsed = parseCreatedGuestBooking({ data: { ...created, guestId: id(42), createdBy: id(43), nic: 'PRIVATE', email: 'PRIVATE' } }, input);
  assert.doesNotMatch(JSON.stringify(parsed), /guestId|createdBy|nic|email|PRIVATE/);
  for (const mutate of [(d: any) => { d.bookingChannel = 'FRONT_DESK'; }, (d: any) => { d.invoice.billingPolicyId = id(99); }, (d: any) => { d.lines[0].rateSnapshot = '1.00'; },
    (d: any) => { d.lines[1].lineId = d.lines[0].lineId; }, (d: any) => { d.lines.pop(); }, (d: any) => { d.lines[0].roomId = null; }]) { const bad = structuredClone(created); mutate(bad); assert.throws(() => parseCreatedGuestBooking({ data: bad }, input), GuestBookingError); }
  assert.throws(() => parseGuestBookingQuote({ data: { ...guestQuoteFor(), branchId: id(2) } }, id(1), selections), GuestBookingError);
});
test('missing/staff/missing-CSRF sessions make no guest requests; denial clears all quote and draft data', async () => {
  let calls = 0;
  for (const session of [null, { ...guestSession, accountKind: 'staff' }, { accountKind: 'guest' } as any]) {
    const api = new GuestBookingApi(session, async () => { calls++; return new Response(); }); await assert.rejects(api.quote(id(1), selections), GuestBookingError);
    const model = new GuestBookingModel(session, api); model.setLines(selected); await model.requestQuote(); assert.equal(model.getSnapshot().denied, true); assert.deepEqual(model.getSnapshot().lines, []);
  }
  assert.equal(calls, 0);
  const { model, fixture } = await setup(); fixture.flags.denied = true; model.acknowledge(); await model.confirm();
  assert.equal(model.getSnapshot().denied, true); assert.equal(model.getSnapshot().quote, null); assert.deepEqual(model.getSnapshot().lines, []);
  fixture.flags.denied = false; await model.requestQuote(); assert.equal(model.getSnapshot().quote, null);
});
test('CSRF preparation failure makes no network request and requires a new session', async () => {
  let calls = 0; const api = new GuestBookingApi({ ...guestSession, async mutationHeaders() { throw new Error('secret'); } }, async () => { calls++; return new Response(); });
  await assert.rejects(api.create(inputFor()), (e: GuestBookingError) => e.status === 401 && !e.uncertain && !e.message.includes('secret')); assert.equal(calls, 0);
});
test('unknown confirmation blocks subsequent attempts; malformed success/server error/network loss stay uncertain', async () => {
  const { model, fixture } = await setup(); fixture.flags.unknown = true; model.acknowledge(); await model.confirm(); assert.equal(model.getSnapshot().uncertain, true);
  fixture.flags.unknown = false; model.setLines([]); await model.requestQuote(); await model.confirm(); assert.equal(fixture.createdCount(), 0); assert.equal(model.getSnapshot().lines.length, 2);
  for (const transport of [async () => new Response('bad'), async () => new Response('{}', { status: 500 }), async () => { throw new TypeError(); }]) {
    const api = new GuestBookingApi(guestSession, transport); await assert.rejects(api.create(inputFor()), (e: GuestBookingError) => e.uncertain);
  }
});
test('policy unavailable and concurrency failures are safe, clear old quotes and never expose raw server errors', async () => {
  for (const code of ['POLICY_UNAVAILABLE', 'RETRY_TRANSACTION', 'BOOKING_CONFLICT', 'NOT_FOUND']) {
    const api = new GuestBookingApi(guestSession, async url => new Response(JSON.stringify(String(url).endsWith('/quote') ? { data: guestQuoteFor() } : { error: { code, message: 'RAW-SECRET' } }), { status: String(url).endsWith('/quote') ? 200 : 409 }));
    const model = new GuestBookingModel(guestSession, api); model.setLines(selected); await model.requestQuote(); model.acknowledge(); await model.confirm();
    assert.equal(model.getSnapshot().quote, null); assert.equal(model.getSnapshot().uncertain, false); assert.doesNotMatch(model.getSnapshot().failure!.message, /RAW-SECRET/);
  }
});
test('late quotes and abandoned confirmation responses cannot restore old account/selection data', async () => {
  let resolve!: (value: any) => void; const pending = new Promise<any>(r => { resolve = r; });
  const model = new GuestBookingModel(guestSession, { async quote() { return pending; }, async create(input) { return guestCreatedFor(input); } });
  model.setLines(selected); const quoting = model.requestQuote(); model.setLines([selected[0]]); resolve(guestQuoteFor()); await quoting;
  assert.equal(model.getSnapshot().quote, null); assert.equal(model.getSnapshot().lines.length, 1);
  let finish!: (value: any) => void; const creating = new Promise<any>(r => { finish = r; });
  const second = new GuestBookingModel(guestSession, { async quote() { return guestQuoteFor(); }, async create() { return creating; } });
  second.setLines(selected); await second.requestQuote(); second.acknowledge(); const confirmation = second.confirm(); second.cancelPending(); finish(guestCreatedFor(inputFor())); await confirmation;
  assert.equal(second.getSnapshot().created, null);
});
test('pending confirmation is sent once and prevents selection edits or a second submission', async () => {
  let calls = 0, finish!: (value: any) => void; const pending = new Promise<any>(r => { finish = r; });
  const model = new GuestBookingModel(guestSession, { async quote() { return guestQuoteFor(); }, async create() { calls++; return pending; } });
  model.setLines(selected); await model.requestQuote(); model.acknowledge(); const confirmation = model.confirm(); await model.confirm(); model.setLines([]);
  assert.equal(calls, 1); assert.equal(model.getSnapshot().lines.length, 2); finish(guestCreatedFor(inputFor())); await confirmation; assert.ok(model.getSnapshot().created);
});
