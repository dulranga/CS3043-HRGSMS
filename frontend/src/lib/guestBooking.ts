import { SelectedRoomLine, selectionIssue, validDate } from './availability';
import { BookingPolicy, BookingQuote, BookingSelection, QuotedLine, parseBookingQuote } from './staffBooking';
import { toMoneyString } from './money';

// Member 1 supplies this verified guest-session adapter; it is not form/storage data.
// No guest/user identifier is needed or submitted by this screen.
export interface GuestBookingSession { accountKind: string; mutationHeaders(): Promise<HeadersInit> }
export interface GuestBookingQuote extends BookingQuote { branchId: string }
export interface GuestBookingInput {
  branchId: string; quotedBillingPolicyId: string;
  lines: (BookingSelection & { quotedRoomTypeId: string; quotedBaseDailyRate: string })[];
}
export interface CreatedGuestBooking {
  bookingId: string; bookingRef: string; bookingChannel: 'DIRECT_ONLINE'; createdAt: string;
  invoice: { invoiceId: string; billingPolicyId: string; status: 'DRAFT'; total: string };
  lines: (BookingSelection & { lineId: string; roomNumber: string; roomTypeId: string; roomTypeName: string; rateSnapshot: string; status: 'BOOKED' })[];
}
export class GuestBookingError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly status = 0, readonly uncertain = false) { super(message); }
}
export interface GuestBookingClient {
  quote(branchId: string, lines: BookingSelection[], signal?: AbortSignal): Promise<GuestBookingQuote>;
  create(input: GuestBookingInput): Promise<CreatedGuestBooking>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const TOTAL = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
export function canCreateGuestBooking(session: GuestBookingSession | null): session is GuestBookingSession {
  return session?.accountKind === 'guest' && typeof session.mutationHeaders === 'function';
}
const key = (line: BookingSelection) => `${line.roomId.toLowerCase()}|${line.checkIn}|${line.checkOut}|${line.guestCount}`;
const selection = (line: SelectedRoomLine): BookingSelection => ({ roomId: line.room.roomId, checkIn: line.search.checkIn, checkOut: line.search.checkOut, guestCount: line.search.guestCount });
function validateSelections(branchId: string, lines: BookingSelection[]) {
  if (!UUID.test(branchId) || !Array.isArray(lines) || !lines.length || lines.some(l => !UUID.test(l.roomId)
    || !validDate(l.checkIn) || !validDate(l.checkOut) || l.checkOut <= l.checkIn || !Number.isInteger(l.guestCount) || l.guestCount < 1 || l.guestCount > 32767)) {
    throw new GuestBookingError('Choose a branch and valid dates and guests for every room.', 'VALIDATION_ERROR', 400);
  }
  if (lines.some((l, index) => lines.slice(0, index).some(other => other.roomId.toLowerCase() === l.roomId.toLowerCase() && other.checkIn < l.checkOut && l.checkIn < other.checkOut))) {
    throw new GuestBookingError('The same room cannot be selected for overlapping stays.', 'VALIDATION_ERROR', 400);
  }
}
export function validateGuestLines(lines: SelectedRoomLine[]): { branchId: string; lines: BookingSelection[] } {
  if (!lines.length) throw new GuestBookingError('Add at least one room to request your quote.', 'VALIDATION_ERROR', 400);
  const branchId = lines[0].search.branchId;
  const selections = lines.map(selection); validateSelections(branchId, selections);
  lines.forEach((line, index) => {
    if (line.search.branchId !== branchId || line.room.branchId !== branchId) throw new GuestBookingError('Choose rooms from one SkyNest branch for this booking.', 'VALIDATION_ERROR', 400);
    const issue = selectionIssue(line.room, line.search, lines.slice(0, index));
    if (issue) throw new GuestBookingError(issue, 'VALIDATION_ERROR', 400);
    if (line.check === 'unavailable' || line.check === 'unverified') throw new GuestBookingError('Recheck or replace rooms that need attention before requesting a quote.', 'INVENTORY_CONFLICT', 409);
  });
  return { branchId, lines: selections };
}
const requireValue = (ok: boolean) => { if (!ok) throw new GuestBookingError('The hotel returned inconsistent booking data. Request a fresh quote.', 'INVALID_RESPONSE', 502); };
const object = (v: unknown): Record<string, any> => { requireValue(!!v && typeof v === 'object' && !Array.isArray(v)); return v as Record<string, any>; };
const uuid = (v: unknown) => typeof v === 'string' && UUID.test(v);
const text = (v: unknown) => typeof v === 'string' && !!v.trim();
const instant = (v: unknown) => typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
export function parseGuestBookingQuote(payload: unknown, branchId: string, lines: BookingSelection[]): GuestBookingQuote {
  const data = object(object(payload).data); requireValue(data.branchId === branchId && instant(object(data.billingPolicy).createdAt));
  try { return { branchId, ...parseBookingQuote(payload, lines) }; }
  catch { throw new GuestBookingError('The hotel returned inconsistent prices or policy. Request a fresh quote.', 'INVALID_RESPONSE', 502); }
}
export function parseCreatedGuestBooking(payload: unknown, input: GuestBookingInput): CreatedGuestBooking {
  const d = object(object(payload).data), i = object(d.invoice);
  requireValue(uuid(d.bookingId) && text(d.bookingRef) && d.bookingChannel === 'DIRECT_ONLINE' && instant(d.createdAt)
    && uuid(i.invoiceId) && i.billingPolicyId === input.quotedBillingPolicyId && i.status === 'DRAFT'
    && typeof i.total === 'string' && TOTAL.test(i.total) && Array.isArray(d.lines) && d.lines.length === input.lines.length);
  const pending = new Map(input.lines.map(l => [key(l), l])), ids = new Set<string>();
  requireValue(pending.size === input.lines.length);
  const lines: CreatedGuestBooking['lines'] = d.lines.map((value: unknown) => {
    const l = object(value); requireValue(uuid(l.roomId)); const expected = pending.get(key(l as BookingSelection));
    requireValue(!!expected && uuid(l.lineId) && !ids.has(l.lineId.toLowerCase()) && l.status === 'BOOKED' && l.roomTypeId === expected!.quotedRoomTypeId
      && typeof l.rateSnapshot === 'string' && RATE.test(l.rateSnapshot) && toMoneyString(l.rateSnapshot) === toMoneyString(expected!.quotedBaseDailyRate)
      && text(l.roomNumber) && text(l.roomTypeName));
    pending.delete(key(l as BookingSelection)); ids.add(l.lineId.toLowerCase());
    return { roomId: expected!.roomId, checkIn: expected!.checkIn, checkOut: expected!.checkOut, guestCount: expected!.guestCount,
      lineId: l.lineId, roomNumber: l.roomNumber, roomTypeId: l.roomTypeId, roomTypeName: l.roomTypeName, rateSnapshot: toMoneyString(l.rateSnapshot), status: 'BOOKED' };
  });
  // Drop backend guest/actor IDs, NIC/contact details and unrelated metadata.
  return { bookingId: d.bookingId, bookingRef: d.bookingRef, bookingChannel: 'DIRECT_ONLINE', createdAt: d.createdAt,
    invoice: { invoiceId: i.invoiceId, billingPolicyId: i.billingPolicyId, status: 'DRAFT', total: toMoneyString(i.total) }, lines };
}
export class GuestBookingApi implements GuestBookingClient {
  constructor(private readonly session: GuestBookingSession | null, private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  private async post(path: string, body: unknown, creation: boolean, signal?: AbortSignal): Promise<unknown> {
    if (!canCreateGuestBooking(this.session)) throw new GuestBookingError('Sign in to your SkyNest guest account to book rooms.', 'FORBIDDEN', 403);
    let headers: Headers;
    try { headers = new Headers(await this.session.mutationHeaders()); }
    catch { throw new GuestBookingError('Your session could not prepare the request. Sign in again.', 'SESSION_UNAVAILABLE', 401); }
    headers.set('Content-Type', 'application/json'); let response: Response;
    try { response = await this.transport(path, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body), signal }); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new GuestBookingError(creation ? 'Confirmation status is unknown. Contact the hotel before trying another booking.' : 'Unable to reach the hotel for a quote. Try again.', 'NETWORK_ERROR', 0, creation);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = typeof payload?.error?.code === 'string' ? payload.error.code : 'REQUEST_FAILED';
      const known = ['REQUOTE_REQUIRED', 'POLICY_UNAVAILABLE', 'INVENTORY_CONFLICT', 'RETRY_TRANSACTION', 'BOOKING_CONFLICT', 'VALIDATION_ERROR', 'NOT_FOUND'];
      const uncertain = creation && response.status !== 401 && response.status !== 403 && !(response.status < 500 && known.includes(code));
      const messages: Record<string, string> = {
        REQUOTE_REQUIRED: 'Room prices or booking terms changed. Get a fresh quote, review it and confirm again.',
        POLICY_UNAVAILABLE: 'Booking terms are temporarily unavailable. Please contact the hotel.',
        INVENTORY_CONFLICT: 'At least one room is no longer available. No part of this booking was created. Recheck your rooms.',
        RETRY_TRANSACTION: 'Room availability changed during confirmation. No booking was created. Recheck every room and get a fresh quote.',
        BOOKING_CONFLICT: 'Your rooms conflict with current hotel records. No booking was created. Recheck your selection.',
        VALIDATION_ERROR: 'Check the branch, dates and guest count for each room.', NOT_FOUND: 'A selected room is no longer available. Search again.',
      };
      throw new GuestBookingError(response.status === 401 ? 'Your session expired. Sign in again.' : response.status === 403 ? 'Sign in with an active SkyNest guest account to make this reservation.'
        : uncertain ? 'Confirmation status is unknown. Contact the hotel before trying another booking.' : messages[code] ?? 'The quote could not be loaded. Try again.', code, response.status, uncertain);
    }
    return payload;
  }
  async quote(branchId: string, lines: BookingSelection[], signal?: AbortSignal) {
    validateSelections(branchId, lines);
    return parseGuestBookingQuote(await this.post('/api/guest/bookings/quote', { branchId, lines: lines.map(l => ({ roomId: l.roomId, checkIn: l.checkIn, checkOut: l.checkOut, guestCount: l.guestCount })) }, false, signal), branchId, lines);
  }
  async create(input: GuestBookingInput) {
    validateSelections(input.branchId, input.lines);
    if (!UUID.test(input.quotedBillingPolicyId) || input.lines.some(l => !UUID.test(l.quotedRoomTypeId) || typeof l.quotedBaseDailyRate !== 'string' || !RATE.test(l.quotedBaseDailyRate))) throw new GuestBookingError('Request a fresh quote before confirming.', 'VALIDATION_ERROR', 400);
    const body = { branchId: input.branchId, quotedBillingPolicyId: input.quotedBillingPolicyId,
      lines: input.lines.map(l => ({ roomId: l.roomId, checkIn: l.checkIn, checkOut: l.checkOut, guestCount: l.guestCount, quotedRoomTypeId: l.quotedRoomTypeId, quotedBaseDailyRate: l.quotedBaseDailyRate })) };
    const payload = await this.post('/api/guest/bookings', body, true);
    try { return parseCreatedGuestBooking(payload, input); }
    catch { throw new GuestBookingError('The confirmation response could not be verified. Contact the hotel before trying another booking.', 'INVALID_RESPONSE', 502, true); }
  }
}
export interface GuestBookingState {
  lines: SelectedRoomLine[]; quote: GuestBookingQuote | null; acknowledged: boolean; quoting: boolean; creating: boolean;
  created: CreatedGuestBooking | null; failure: GuestBookingError | null; notice: string; uncertain: boolean; denied: boolean;
}
export const initialGuestBookingState = (): GuestBookingState => ({ lines: [], quote: null, acknowledged: false, quoting: false, creating: false,
  created: null, failure: null, notice: '', uncertain: false, denied: false });
const failure = (error: unknown) => error instanceof GuestBookingError ? error : new GuestBookingError('The hotel request could not be completed.', 'REQUEST_FAILED', 0);
export class GuestBookingModel {
  private state = initialGuestBookingState(); private listeners = new Set<() => void>(); private quoteToken = 0; private createToken = 0; private abort?: AbortController;
  constructor(private readonly session: GuestBookingSession | null, private readonly client: GuestBookingClient) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<GuestBookingState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  cancelPending = () => { this.quoteToken++; this.createToken++; this.abort?.abort(); };
  private locked() { return this.state.creating || !!this.state.created || this.state.uncertain || this.state.denied; }
  private fail(error: unknown, patch: Partial<GuestBookingState> = {}) {
    const err = failure(error);
    if (err.status === 401 || err.status === 403) { this.cancelPending(); this.publish({ ...initialGuestBookingState(), denied: true, failure: err }); }
    else this.publish({ ...patch, failure: err });
  }
  setLines(lines: SelectedRoomLine[]) {
    if (this.locked() || JSON.stringify(lines) === JSON.stringify(this.state.lines)) return;
    this.quoteToken++; this.abort?.abort();
    this.publish({ lines: structuredClone(lines), quote: null, acknowledged: false, quoting: false, notice: 'Your selection changed. Get a fresh combined quote.' });
  }
  acknowledge() { if (!this.locked() && this.state.quote && !this.state.quoting) this.publish({ acknowledged: !this.state.acknowledged }); }
  private selections() {
    if (!canCreateGuestBooking(this.session)) throw new GuestBookingError('Sign in to your SkyNest guest account to book rooms.', 'FORBIDDEN', 403);
    return validateGuestLines(this.state.lines);
  }
  async requestQuote() {
    if (this.locked()) return;
    const token = ++this.quoteToken; this.abort?.abort(); this.abort = new AbortController();
    this.publish({ quoting: true, quote: null, acknowledged: false, failure: null, notice: '' });
    try {
      const input = this.selections(); const quote = parseGuestBookingQuote({ data: await this.client.quote(input.branchId, input.lines, this.abort.signal) }, input.branchId, input.lines);
      if (token !== this.quoteToken) return;
      const changed = quote.lines.some(l => { const old = this.state.lines.find(s => key(selection(s)) === key(l))!;
        return old.room.roomType.roomTypeId !== l.roomTypeId || toMoneyString(old.room.roomType.baseDailyRate) !== l.baseDailyRate; });
      this.publish({ quote, quoting: false, notice: changed ? 'Room prices changed since your search. Review the new rates and terms before confirming.' : 'Your fresh quote is ready. Review every room rate and the booking terms.' });
    } catch (e) { if (token === this.quoteToken) this.fail(e, { quoting: false }); }
  }
  async confirm() {
    if (this.locked() || this.state.quoting) return;
    let input: GuestBookingInput;
    try {
      const selections = this.selections();
      if (!this.state.quote || !this.state.acknowledged) throw new GuestBookingError('Get a fresh quote and review its room rates and terms before confirming.', 'VALIDATION_ERROR', 400);
      const quote = parseGuestBookingQuote({ data: this.state.quote }, selections.branchId, selections.lines);
      input = { branchId: quote.branchId, quotedBillingPolicyId: quote.billingPolicy.billingPolicyId,
        lines: quote.lines.map(l => ({ roomId: l.roomId, checkIn: l.checkIn, checkOut: l.checkOut, guestCount: l.guestCount,
          quotedRoomTypeId: l.roomTypeId, quotedBaseDailyRate: l.baseDailyRate })) };
    } catch (e) { this.fail(e); return; }
    const token = ++this.createToken;
    this.publish({ creating: true, failure: null, notice: '' });
    try {
      const created = parseCreatedGuestBooking({ data: await this.client.create(input) }, input);
      if (token !== this.createToken) return;
      this.publish({ created, creating: false, acknowledged: false, quote: null, notice: 'Your rooms were reserved together under one booking reference. No online payment was taken.' });
    } catch (e) {
      if (token !== this.createToken) return;
      const err = failure(e), uncertain = err.uncertain || err.status === 0 || err.status >= 500;
      this.fail(err, { creating: false, quote: null, acknowledged: false, uncertain,
        notice: uncertain ? 'Do not submit again. Contact the hotel to check your reservation; another attempt could create a duplicate.' : 'Your unconfirmed selection is retained. Resolve the issue, get a fresh quote and confirm again.' });
    }
  }
}
export type { BookingPolicy, QuotedLine };
