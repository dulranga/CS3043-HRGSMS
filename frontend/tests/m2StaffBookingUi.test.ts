import assert from 'node:assert/strict';
import test from 'node:test';
import { StaffBookingApi, StaffBookingClient, StaffBookingError, StaffBookingModel, StaffBookingInput,
  canCreateStaffBooking, parseBookingQuote, parseCreatedBooking, provisionalBookingTotal, validateStaffLines } from '../src/lib/staffBooking.ts';
import { id, search, single } from './availabilityFixtures.ts';
import { createdFor, quoteFor, selected, selections, session } from './staffBookingFixtures.ts';
const api: StaffBookingClient = { quote: async lines => quoteFor(lines), create: async input => createdFor(input) };
async function ready(client = api) {
  const model = new StaffBookingModel(session, client); model.setLines(selected); model.setGuest(id(25));
  await model.requestQuote(); model.acknowledge(); return model;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('two-room validation preserves separate dates/guests, capacity, own branch and half-open overlap rules', () => {
  assert.deepEqual(validateStaffLines(selected, id(1)), selections);
  assert.throws(() => validateStaffLines([], id(1)), /at least one/);
  assert.throws(() => validateStaffLines(selected, id(2)), /assigned branch/);
  assert.throws(() => validateStaffLines([{ ...selected[0], search: { ...search, guestCount: 2 } }], id(1)), /accommodate/);
  for (const patch of [{ checkOut: search.checkIn }, { checkIn: '2027-02-29' }, { guestCount: 0 }]) assert.throws(() => validateStaffLines([{ ...selected[0], search: { ...search, ...patch } }], id(1)));
  assert.throws(() => validateStaffLines([selected[0], { ...selected[0], selectionId: 'c' }], id(1)), /overlapping/);
  assert.equal(validateStaffLines([selected[0], { ...selected[0], selectionId: 'c', search: { ...search, checkIn: search.checkOut, checkOut: '2027-06-05' } }], id(1)).length, 2);
  assert.throws(() => validateStaffLines([{ ...selected[0], check: 'unavailable' }], id(1)), /Recheck/);
});
test('only verified Front Desk branch context with a mutation adapter permits calls', async () => {
  let calls = 0;
  for (const candidate of [null, { ...session, role: 'CHAIN_MANAGER' }, { ...session, branchId: 'invalid' }, { ...session, mutationHeaders: undefined }]) {
    assert.equal(canCreateStaffBooking(candidate as any), false);
    const client = new StaffBookingApi(candidate as any, async () => { calls++; return new Response(); });
    await assert.rejects(client.quote(selections), /Sign in/);
    const model = new StaffBookingModel(candidate as any, api); model.setLines(selected); await model.requestQuote(); assert.equal(model.getSnapshot().quote, null);
  }
  assert.equal(calls, 0);
});
test('quote parser rejects wrong dates/rooms, duplicate lines, impossible policy and same-type inconsistent rates', () => {
  const quote = quoteFor(); assert.deepEqual(parseBookingQuote({ data: quote }, selections), quote);
  for (const broken of [
    { ...quote, lines: [quote.lines[0], quote.lines[0]] },
    { ...quote, lines: [{ ...quote.lines[0], checkIn: '2027-06-02' }, quote.lines[1]] },
    { ...quote, lines: [{ ...quote.lines[0], baseDailyRate: 'NaN' }, quote.lines[1]] },
    { ...quote, lines: [{ ...quote.lines[0], capacity: 0 }, quote.lines[1]] },
    { ...quote, lines: [quote.lines[0], { ...quote.lines[1], roomTypeId: single.roomType.roomTypeId }] },
    quoteFor(selections, { taxPercent: '101.00' }), quoteFor(selections, { noShowGraceDays: 0 }),
  ]) assert.throws(() => parseBookingQuote({ data: broken }, selections), /inconsistent/);
});
test('combined estimate uses exact decimal multiplication and separately rounded service charge then tax', () => {
  const totals = provisionalBookingTotal(quoteFor());
  assert.deepEqual(totals, { roomAmounts: ['30001.50', '72000.00'], roomSubtotal: '102001.50', serviceCharge: '10200.15', tax: '13464.20', total: '125665.85' });
  const half = quoteFor([selections[0]], { serviceChargePercent: '10.00', taxPercent: '10.00' }); half.lines[0].baseDailyRate = '0.05'; half.lines[0].checkOut = '2027-06-02';
  assert.deepEqual(provisionalBookingTotal(half), { roomAmounts: ['0.05'], roomSubtotal: '0.05', serviceCharge: '0.01', tax: '0.01', total: '0.07' });
});
test('two same-type rooms share the quoted rate while retaining separate physical-room selections', () => {
  const lines = [selected[0], { ...selected[0], selectionId: 'second-single', room: { ...single, roomId: id(8), roomNumber: '103' } }];
  const selections = validateStaffLines(lines, id(1));
  const quote = quoteFor([selections[0]]); quote.lines.push({ ...quote.lines[0], ...selections[1], roomNumber: '103' });
  const parsed = parseBookingQuote({ data: quote }, selections);
  assert.equal(parsed.lines[0].baseDailyRate, parsed.lines[1].baseDailyRate); assert.notEqual(parsed.lines[0].roomId, parsed.lines[1].roomId);
  assert.equal(provisionalBookingTotal(parsed).roomSubtotal, '60003.00');
});
test('transport uses POST quote/create contracts, opaque CSRF adapter and credentials without actor/branch fields', async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const client = new StaffBookingApi({ ...session, mutationHeaders: async () => ({ 'X-Test-CSRF': 'fixture' }) }, async (input, init) => {
    calls.push({ path: String(input), init: init! });
    const body = JSON.parse(init!.body as string);
    return new Response(JSON.stringify({ data: String(input).endsWith('/quote') ? quoteFor(body.lines) : createdFor(body) }), { status: String(input).endsWith('/quote') ? 200 : 201 });
  });
  const model = await ready(client); await model.confirm();
  assert.equal(calls[0].path, '/api/bookings/quote'); assert.deepEqual(JSON.parse(calls[0].init.body as string), { lines: selections });
  const input = JSON.parse(calls[1].init.body as string); assert.deepEqual(Object.keys(input).sort(), ['bookingChannel', 'guestId', 'lines', 'quotedBillingPolicyId'].sort());
  assert.equal(input.lines[0].quotedBaseDailyRate, '10000.50'); assert.equal(input.lines[1].quotedBaseDailyRate, '18000.00'); assert.equal(input.lines[1].guestCount, 2);
  for (const call of calls) { assert.equal(call.init.method, 'POST'); assert.equal(call.init.credentials, 'same-origin'); assert.equal(new Headers(call.init.headers).get('X-Test-CSRF'), 'fixture'); assert.equal(new Headers(call.init.headers).has('x-user-id'), false); }
});
test('editing selection invalidates quote and acknowledgement; late quotes cannot overwrite a new draft', async () => {
  const pending = deferred<ReturnType<typeof quoteFor>>();
  const model = await ready(); model.setLines([selected[0]]); assert.equal(model.getSnapshot().quote, null); assert.equal(model.getSnapshot().acknowledged, false);
  const slow = new StaffBookingModel(session, { ...api, quote: () => pending.promise }); slow.setLines(selected);
  const request = slow.requestQuote(); slow.setLines([selected[0]]); pending.resolve(quoteFor()); await request;
  assert.equal(slow.getSnapshot().quote, null); assert.equal(slow.getSnapshot().lines.length, 1); assert.equal(slow.getSnapshot().quoting, false);
});
test('confirmation requires primary guest plus explicit review and preserves successful per-line server snapshots', async () => {
  let count = 0;
  const model = await ready({ ...api, create: async input => { count++; return createdFor(input); } });
  model.setGuest('bad'); await model.confirm(); assert.equal(count, 0);
  model.setGuest(id(25)); await model.confirm(); assert.equal(count, 0); model.acknowledge(); await model.confirm(); await model.confirm();
  assert.equal(count, 1); assert.equal(model.getSnapshot().created?.lines.length, 2); assert.equal(model.getSnapshot().created?.invoice.status, 'DRAFT');
});
test('rate/policy conflict retains draft, clears quote and requires new review without automatic resubmission', async () => {
  let count = 0, version = false;
  const model = await ready({ quote: async lines => { const quote = quoteFor(lines, version ? { billingPolicyId: id(21), taxPercent: '15.00' } : {}); if (version) quote.lines[0].baseDailyRate = '11000.00'; return quote; },
    create: async input => { count++; if (!version) throw new StaffBookingError('Rate or policy changed.', 'REQUOTE_REQUIRED', 409); return createdFor(input); } });
  await model.confirm(); assert.equal(model.getSnapshot().quote, null); assert.equal(model.getSnapshot().lines.length, 2); assert.equal(model.getSnapshot().guestId, id(25));
  version = true; await model.requestQuote(); assert.equal(count, 1); assert.equal(model.getSnapshot().acknowledged, false); assert.match(model.getSnapshot().notice, /Catalogue values changed/);
  await model.confirm(); assert.equal(count, 1); model.acknowledge(); await model.confirm(); assert.equal(count, 2); assert.equal(model.getSnapshot().created?.invoice.billingPolicyId, id(21));
});
test('inventory/policy/concurrency rejection retains lines and requires fresh quote; policy absence yields no confirmable quote', async () => {
  for (const code of ['INVENTORY_CONFLICT', 'POLICY_UNAVAILABLE', 'RETRY_TRANSACTION', 'FORBIDDEN']) {
    const model = await ready({ ...api, create: async () => { throw new StaffBookingError('Resolve issue.', code, code === 'FORBIDDEN' ? 403 : 409); } }); await model.confirm();
    assert.equal(model.getSnapshot().quote, null); assert.equal(model.getSnapshot().lines.length, 2); assert.equal(model.getSnapshot().uncertain, false);
  }
  const model = new StaffBookingModel(session, { ...api, quote: async () => { throw new StaffBookingError('No policy.', 'POLICY_UNAVAILABLE', 409); } }); model.setLines(selected); await model.requestQuote(); assert.equal(model.getSnapshot().quote, null);
});
test('pending create disables mutations and double submissions; lost/invalid responses block blind retries', async () => {
  const pending = deferred<ReturnType<typeof createdFor>>(); let calls = 0, input!: StaffBookingInput;
  const model = await ready({ ...api, create: value => { calls++; input = value; return pending.promise; } });
  const request = model.confirm(); model.setLines([]); model.setGuest(id(99)); model.setChannel('PHONE'); await model.confirm();
  assert.equal(calls, 1); assert.equal(model.getSnapshot().guestId, id(25)); assert.equal(model.getSnapshot().lines.length, 2);
  pending.resolve(createdFor(input)); await request;
  for (const err of [new StaffBookingError('Lost response.', 'NETWORK_ERROR'), new StaffBookingError('Bad response.', 'INVALID_RESPONSE', 502)]) {
    let attempts = 0; const uncertain = await ready({ ...api, create: async () => { attempts++; throw err; } }); await uncertain.confirm(); await uncertain.requestQuote(); await uncertain.confirm();
    assert.equal(attempts, 1); assert.equal(uncertain.getSnapshot().uncertain, true); assert.match(uncertain.getSnapshot().notice, /Check booking records/);
  }
});
test('created response must match guest, policy and all quoted room lines without trusting malformed success', async () => {
  let input!: StaffBookingInput; const model = await ready({ ...api, create: async value => { input = value; return createdFor(value); } }); await model.confirm();
  const created = createdFor(input);
  for (const broken of [{ ...created, guestId: id(99) }, { ...created, lines: [created.lines[0], created.lines[0]] },
    { ...created, invoice: { ...created.invoice, billingPolicyId: id(99) } }, { ...created, lines: [{ ...created.lines[0], rateSnapshot: '0.00' }, created.lines[1]] }]) assert.throws(() => parseCreatedBooking({ data: broken }, input));
});
test('API maps safe actionable errors, never leaks server details and binds default browser fetch correctly', async () => {
  const client = new StaffBookingApi(session, async () => new Response(JSON.stringify({ error: { code: 'REQUOTE_REQUIRED', message: 'secret SQL' } }), { status: 409 }));
  await assert.rejects(client.quote(selections), (error: StaffBookingError) => error.code === 'REQUOTE_REQUIRED' && /fresh quote/.test(error.message) && !/secret/.test(error.message));
  const original = globalThis.fetch;
  try { globalThis.fetch = async function(this: unknown) { assert.equal(this, undefined); return new Response(JSON.stringify({ data: quoteFor() })); }; await new StaffBookingApi(session).quote(selections); }
  finally { globalThis.fetch = original; }
});
test('expired mutation adapter fails before sending and a canonical guest UUID matches server responses', async () => {
  let calls = 0;
  const client = new StaffBookingApi({ ...session, mutationHeaders: async () => { throw new Error('expired'); } }, async () => { calls++; return new Response(); });
  await assert.rejects(client.quote(selections), (err: StaffBookingError) => err.status === 401);
  assert.equal(calls, 0);
  const model = await ready(); model.setGuest(' ' + id(25).toUpperCase() + ' '); model.acknowledge(); await model.confirm();
  assert.equal(model.getSnapshot().created?.guestId, id(25));
});
