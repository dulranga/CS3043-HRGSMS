import { SelectedRoomLine, selectionIssue, validDate, nights } from './availability';
import { multiplyMoney, sumMoney, toMoneyString } from './money';

export interface StaffBookingSession {
  role: string;
  branchId: string;
  // Supplied only by Member 1's verified session/CSRF adapter. No assumed header.
  mutationHeaders(): Promise<HeadersInit>;
}
export interface BookingSelection { roomId: string; checkIn: string; checkOut: string; guestCount: number }
export interface QuotedLine extends BookingSelection {
  roomNumber: string; roomTypeId: string; roomTypeName: string; capacity: number; baseDailyRate: string;
}
export interface BookingPolicy {
  billingPolicyId: string; effectiveFrom: string; createdAt: string;
  taxPercent: string; serviceChargePercent: string; maxDiscountPercent: string;
  cancellationFee: string; noShowFee: string; lateCheckoutFee: string; noShowGraceDays: number;
}
export interface BookingQuote { billingPolicy: BookingPolicy; lines: QuotedLine[] }
export type StaffChannel = 'FRONT_DESK' | 'PHONE' | 'EMAIL';
export interface StaffBookingInput {
  guestId: string; bookingChannel: StaffChannel; quotedBillingPolicyId: string;
  lines: (BookingSelection & { quotedRoomTypeId: string; quotedBaseDailyRate: string })[];
}
export interface CreatedStaffBooking {
  bookingId: string; bookingRef: string; bookingChannel: StaffChannel; guestId: string; createdAt: string;
  invoice: { invoiceId: string; billingPolicyId: string; status: 'DRAFT'; total: string };
  lines: (BookingSelection & { lineId: string; roomNumber: string; roomTypeId: string; roomTypeName: string; rateSnapshot: string; status: 'BOOKED' })[];
}
export class StaffBookingError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly status = 0) { super(message); }
}
export interface StaffBookingClient {
  quote(lines: BookingSelection[], signal?: AbortSignal): Promise<BookingQuote>;
  create(input: StaffBookingInput): Promise<CreatedStaffBooking>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const TOTAL = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
export function canCreateStaffBooking(session: StaffBookingSession | null): session is StaffBookingSession {
  return session?.role === 'FRONT_DESK' && UUID.test(session.branchId) && typeof session.mutationHeaders === 'function';
}
const key = (line: BookingSelection) => `${line.roomId.toLowerCase()}|${line.checkIn}|${line.checkOut}|${line.guestCount}`;
const selection = (line: SelectedRoomLine): BookingSelection => ({ roomId: line.room.roomId, checkIn: line.search.checkIn, checkOut: line.search.checkOut, guestCount: line.search.guestCount });
export function validateStaffLines(lines: SelectedRoomLine[], branchId: string): BookingSelection[] {
  if (!lines.length) throw new StaffBookingError('Add at least one room before requesting a quote.', 'VALIDATION_ERROR', 400);
  lines.forEach((line, index) => {
    if (line.room.branchId !== branchId || line.search.branchId !== branchId) throw new StaffBookingError('All room lines must belong to your assigned branch.', 'FORBIDDEN', 403);
    if (!UUID.test(line.room.roomId) || !validDate(line.search.checkIn) || !validDate(line.search.checkOut)
      || line.search.checkOut <= line.search.checkIn || !Number.isInteger(line.search.guestCount)
      || line.search.guestCount < 1 || line.search.guestCount > 32767) throw new StaffBookingError('Correct each room’s dates and guest count.', 'VALIDATION_ERROR', 400);
    const issue = selectionIssue(line.room, line.search, lines.slice(0, index));
    if (issue) throw new StaffBookingError(issue, 'VALIDATION_ERROR', 400);
    // A fresh server quote may resolve a changed catalogue rate; missing inventory cannot.
    if (line.check === 'unavailable' || line.check === 'unverified') throw new StaffBookingError('Recheck or replace room lines that need attention before quoting.', 'INVENTORY_CONFLICT', 409);
  });
  return lines.map(selection);
}
function requireValue(ok: boolean): void {
  if (!ok) throw new StaffBookingError('The server returned inconsistent booking data. Request a fresh quote.', 'INVALID_RESPONSE', 502);
}
function object(value: unknown): Record<string, any> {
  requireValue(!!value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, any>;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const uuid = (value: unknown) => typeof value === 'string' && UUID.test(value);
const decimal = (value: unknown) => typeof value === 'string' && DECIMAL.test(value);
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function parseBookingQuote(payload: unknown, selections: BookingSelection[]): BookingQuote {
  const data = object(object(payload).data), policy = object(data.billingPolicy);
  requireValue(uuid(policy.billingPolicyId) && validDate(policy.effectiveFrom) && instant(policy.createdAt)
    && Number.isInteger(policy.noShowGraceDays) && policy.noShowGraceDays >= 1 && policy.noShowGraceDays <= 7);
  for (const field of ['taxPercent', 'serviceChargePercent', 'maxDiscountPercent']) requireValue(decimal(policy[field]) && Number(policy[field]) <= 100);
  for (const field of ['cancellationFee', 'noShowFee', 'lateCheckoutFee']) requireValue(decimal(policy[field]));
  requireValue(Array.isArray(data.lines) && data.lines.length === selections.length);
  const pending = new Map(selections.map(line => [key(line), line]));
  requireValue(pending.size === selections.length);
  const typeRates = new Map<string, string>();
  const lines: QuotedLine[] = data.lines.map((value: unknown) => {
    const line = object(value);
    requireValue(uuid(line.roomId) && validDate(line.checkIn) && validDate(line.checkOut) && line.checkOut > line.checkIn
      && Number.isInteger(line.guestCount) && pending.delete(key(line as unknown as BookingSelection))
      && text(line.roomNumber) && uuid(line.roomTypeId) && text(line.roomTypeName)
      && Number.isInteger(line.capacity) && line.capacity >= line.guestCount && line.capacity <= 32767 && decimal(line.baseDailyRate));
    const rate = toMoneyString(line.baseDailyRate);
    requireValue(!typeRates.has(line.roomTypeId) || typeRates.get(line.roomTypeId) === rate);
    typeRates.set(line.roomTypeId, rate);
    return { roomId: line.roomId, roomNumber: line.roomNumber, checkIn: line.checkIn, checkOut: line.checkOut,
      guestCount: line.guestCount, roomTypeId: line.roomTypeId, roomTypeName: line.roomTypeName, capacity: line.capacity, baseDailyRate: rate };
  });
  return { billingPolicy: {
    billingPolicyId: policy.billingPolicyId, effectiveFrom: policy.effectiveFrom, createdAt: policy.createdAt,
    taxPercent: policy.taxPercent, serviceChargePercent: policy.serviceChargePercent, maxDiscountPercent: policy.maxDiscountPercent,
    cancellationFee: policy.cancellationFee, noShowFee: policy.noShowFee, lateCheckoutFee: policy.lateCheckoutFee, noShowGraceDays: policy.noShowGraceDays,
  }, lines };
}
export function parseCreatedBooking(payload: unknown, input: StaffBookingInput): CreatedStaffBooking {
  const data = object(object(payload).data), invoice = object(data.invoice);
  requireValue(uuid(data.bookingId) && text(data.bookingRef) && data.guestId === input.guestId
    && data.bookingChannel === input.bookingChannel && instant(data.createdAt)
    && uuid(invoice.invoiceId) && invoice.billingPolicyId === input.quotedBillingPolicyId
    && invoice.status === 'DRAFT' && typeof invoice.total === 'string' && TOTAL.test(invoice.total)
    && Array.isArray(data.lines) && data.lines.length === input.lines.length);
  const pending = new Map(input.lines.map(line => [key(line), line]));
  const ids = new Set<string>();
  const lines: CreatedStaffBooking['lines'] = data.lines.map((value: unknown) => {
    const line = object(value), expected = pending.get(key(line as unknown as BookingSelection));
    requireValue(!!expected && uuid(line.lineId) && !ids.has(line.lineId) && line.status === 'BOOKED'
      && line.roomTypeId === expected!.quotedRoomTypeId && decimal(line.rateSnapshot)
      && toMoneyString(line.rateSnapshot) === expected!.quotedBaseDailyRate && text(line.roomNumber) && text(line.roomTypeName));
    pending.delete(key(line as unknown as BookingSelection)); ids.add(line.lineId);
    return { roomId: expected!.roomId, checkIn: expected!.checkIn, checkOut: expected!.checkOut, guestCount: expected!.guestCount,
      lineId: line.lineId, roomNumber: line.roomNumber, roomTypeId: line.roomTypeId,
      roomTypeName: line.roomTypeName, rateSnapshot: line.rateSnapshot, status: 'BOOKED' };
  });
  return { bookingId: data.bookingId, bookingRef: data.bookingRef, guestId: data.guestId, bookingChannel: data.bookingChannel,
    createdAt: data.createdAt, invoice: { invoiceId: invoice.invoiceId, billingPolicyId: invoice.billingPolicyId, status: 'DRAFT', total: invoice.total }, lines };
}
// Display-only estimate with exact minor-unit arithmetic and SRS §4.7.4 order.
// The create response's persisted DRAFT invoice remains authoritative.
export function provisionalBookingTotal(quote: BookingQuote) {
  const roomAmounts = quote.lines.map(line => multiplyMoney(String(nights(line)), line.baseDailyRate));
  const roomSubtotal = sumMoney(roomAmounts);
  const percent = (amount: string, pct: string) => {
    const minor = (value: string) => { const [whole, fraction] = toMoneyString(value).split('.'); return BigInt(whole) * 100n + BigInt(fraction); };
    const rounded = (minor(amount) * minor(pct) + 5000n) / 10000n;
    return `${rounded / 100n}.${String(rounded % 100n).padStart(2, '0')}`;
  };
  const serviceCharge = percent(roomSubtotal, quote.billingPolicy.serviceChargePercent);
  const tax = percent(sumMoney([roomSubtotal, serviceCharge]), quote.billingPolicy.taxPercent);
  return { roomAmounts, roomSubtotal, serviceCharge, tax, total: sumMoney([roomSubtotal, serviceCharge, tax]) };
}
export class StaffBookingApi implements StaffBookingClient {
  constructor(private readonly session: StaffBookingSession | null,
    private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!canCreateStaffBooking(this.session)) throw new StaffBookingError('Sign in as Front Desk staff to create a booking.', 'FORBIDDEN', 403);
    let headers: Headers;
    try { headers = new Headers(await this.session.mutationHeaders()); }
    catch { throw new StaffBookingError('Your session could not prepare this request. Sign in again.', 'SESSION_UNAVAILABLE', 401); }
    headers.set('Content-Type', 'application/json');
    let response: Response;
    try { response = await this.transport(path, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body), signal }); }
    catch { throw new StaffBookingError('The booking service could not be reached.', 'NETWORK_ERROR'); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload?.error?.code;
      const messages: Record<string, string> = {
        REQUOTE_REQUIRED: 'The catalogue rate or billing policy changed. Get a fresh quote and review it again.',
        POLICY_UNAVAILABLE: 'No approved billing policy is available. Ask a Chain Manager to publish one.',
        INVENTORY_CONFLICT: 'A room is no longer available for its dates and guests. Recheck your selection and replace affected rooms.',
        RETRY_TRANSACTION: 'Inventory changed concurrently. Recheck rooms, then request a fresh quote.',
        BOOKING_CONFLICT: 'Current hotel data conflicts with this booking. Recheck rooms and guest details.',
        VALIDATION_ERROR: 'Check the primary guest and every room’s dates and guest count.',
        NOT_FOUND: 'The selected guest or room no longer exists. Check the selection.',
      };
      throw new StaffBookingError(response.status === 401 ? 'Your session expired. Sign in again.' : response.status === 403 ? 'Your session cannot create bookings in this branch.' : messages[code] ?? 'The booking service could not complete this request.', typeof code === 'string' ? code : 'REQUEST_FAILED', response.status);
    }
    return payload;
  }
  async quote(lines: BookingSelection[], signal?: AbortSignal) { return parseBookingQuote(await this.post('/api/bookings/quote', { lines }, signal), lines); }
  async create(input: StaffBookingInput) { return parseCreatedBooking(await this.post('/api/bookings', input), input); }
}

export interface StaffBookingState {
  lines: SelectedRoomLine[]; guestId: string; channel: StaffChannel; quote: BookingQuote | null;
  acknowledged: boolean; quoting: boolean; creating: boolean; failure: StaffBookingError | null;
  notice: string; created: CreatedStaffBooking | null; uncertain: boolean;
}
export const initialStaffBookingState = (): StaffBookingState => ({ lines: [], guestId: '', channel: 'FRONT_DESK', quote: null,
  acknowledged: false, quoting: false, creating: false, failure: null, notice: '', created: null, uncertain: false });
const failure = (error: unknown) => error instanceof StaffBookingError ? error : new StaffBookingError('The booking request could not be completed.');
export class StaffBookingModel {
  private state = initialStaffBookingState();
  private listeners = new Set<() => void>();
  private token = 0;
  private abort?: AbortController;
  constructor(private readonly session: StaffBookingSession | null, private readonly client: StaffBookingClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<StaffBookingState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  cancelPending = () => { this.token++; this.abort?.abort(); };
  private locked() { return this.state.creating || !!this.state.created || this.state.uncertain; }
  setLines(lines: SelectedRoomLine[]) {
    if (this.locked() || JSON.stringify(lines) === JSON.stringify(this.state.lines)) return;
    this.cancelPending();
    this.publish({ lines: structuredClone(lines), quote: null, acknowledged: false, quoting: false, failure: null, notice: 'Selection changed. Request a fresh combined quote.' });
  }
  setGuest(guestId: string) { if (!this.locked()) this.publish({ guestId: guestId.trim().toLowerCase(), acknowledged: false, failure: null }); }
  setChannel(channel: StaffChannel) { if (!this.locked()) this.publish({ channel, acknowledged: false, failure: null }); }
  acknowledge() { if (!this.locked() && this.state.quote && !this.state.quoting) this.publish({ acknowledged: !this.state.acknowledged }); }
  private selections() {
    if (!canCreateStaffBooking(this.session)) throw new StaffBookingError('Sign in as Front Desk staff to create a booking.', 'FORBIDDEN', 403);
    return validateStaffLines(this.state.lines, this.session.branchId);
  }
  async requestQuote() {
    if (this.locked()) return;
    let lines: BookingSelection[];
    try { lines = this.selections(); } catch (error) { this.publish({ failure: failure(error), quote: null, acknowledged: false }); return; }
    const token = ++this.token; this.abort?.abort(); this.abort = new AbortController();
    this.publish({ quoting: true, quote: null, acknowledged: false, failure: null, notice: '' });
    try {
      const quote = await this.client.quote(lines, this.abort.signal);
      if (token !== this.token) return;
      // Validate injected clients too, rather than trusting the rendering layer.
      const checked = parseBookingQuote({ data: quote }, lines);
      const changed = checked.lines.some(line => {
        const selected = this.state.lines.find(draft => key(selection(draft)) === key(line))!;
        return selected.room.roomType.roomTypeId !== line.roomTypeId || toMoneyString(selected.room.roomType.baseDailyRate) !== line.baseDailyRate;
      });
      this.publish({ quoting: false, quote: checked, notice: changed ? 'Catalogue values changed since selection. Review the new per-room rates and policy before confirming.' : 'Fresh combined quote ready. Review every room and the selected policy before confirming.' });
    } catch (error) { if (token === this.token) this.publish({ quoting: false, failure: failure(error) }); }
  }
  async confirm() {
    if (this.locked() || this.state.quoting) return;
    let input: StaffBookingInput;
    try {
      const selections = this.selections();
      if (!UUID.test(this.state.guestId)) throw new StaffBookingError('Enter the primary guest ID from the guest record.', 'VALIDATION_ERROR', 400);
      if (!this.state.quote || !this.state.acknowledged) throw new StaffBookingError('Get a fresh quote and acknowledge its room rates and policy before confirming.', 'VALIDATION_ERROR', 400);
      const quote = parseBookingQuote({ data: this.state.quote }, selections);
      input = { guestId: this.state.guestId, bookingChannel: this.state.channel,
        quotedBillingPolicyId: quote.billingPolicy.billingPolicyId,
        lines: quote.lines.map(line => ({ roomId: line.roomId, checkIn: line.checkIn, checkOut: line.checkOut, guestCount: line.guestCount,
          quotedRoomTypeId: line.roomTypeId, quotedBaseDailyRate: line.baseDailyRate })) };
    } catch (error) { this.publish({ failure: failure(error) }); return; }
    this.publish({ creating: true, failure: null, notice: '' });
    try {
      const created = parseCreatedBooking({ data: await this.client.create(input) }, input);
      this.publish({ creating: false, created, acknowledged: false, notice: 'Booking confirmed. All room lines and the single DRAFT invoice were created together.' });
    } catch (error) {
      const err = failure(error);
      const uncertain = err.status === 0 || err.status >= 500;
      this.publish({ creating: false, failure: err, quote: null, acknowledged: false, uncertain,
        notice: uncertain ? 'Confirmation status is unknown. Check booking records with staff before starting another booking; repeating this request could create a duplicate.' : 'Your draft is retained. Resolve the issue, request a fresh quote and explicitly confirm again.' });
    }
  }
}
