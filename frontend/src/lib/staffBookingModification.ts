import { AvailabilityClient, AvailabilitySearch, AvailableRoom, validDate, overlaps } from './availability';
import { StaffBookingSession } from './staffBooking';
import { BookingRoomLine, StaffBookingDetail, StaffBookingReadClient } from './staffBookingRead';
import { toMoneyString } from './money';

export type ModificationKind = 'add' | 'change' | 'move';
export interface ModificationDraft { checkIn: string; checkOut: string; guestCount: string; reason: string }
export interface TypeQuote { roomTypeId: string; name: string; capacity: number; baseDailyRate: string; active: boolean }
export interface LineModificationInput {
  checkIn: string; checkOut: string; guestCount: number; quotedRoomTypeId: string; quotedBaseDailyRate: string; reason: string;
}
export interface MoveInput { roomId: string; quotedRoomTypeId: string; quotedBaseDailyRate: string; reason: string; approvedPriceAdjustment: null }
export interface ModificationReview {
  kind: ModificationKind; bookingId: string; lineId?: string; roomId: string; roomNumber: string;
  checkIn: string; checkOut: string; guestCount: number; catalogueRate: string; agreedRate: string;
  input: LineModificationInput | (LineModificationInput & { roomId: string }) | MoveInput;
  originalStatus: 'BOOKED' | 'CHECKED_IN';
}
export interface ModificationResult {
  bookingId: string;
  line: { lineId: string; checkIn: string; checkOut: string; guestCount: number; rateSnapshot: string; status: 'BOOKED' | 'CHECKED_IN';
    currentAssignment: { assignmentId: string; roomId: string; roomNumber: string; roomTypeId: string; roomTypeName: string; assignedAt: string; occupiedFrom: string | null } };
  invoice: { invoiceId: string; total: string; balance: string; isCredit: boolean; creditAmount: string };
}
export class BookingModificationError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly status = 0, readonly uncertain = false) { super(message); }
}
export interface BookingModificationClient {
  typeQuote(typeId: string, signal?: AbortSignal): Promise<TypeQuote>;
  modify(review: ModificationReview): Promise<ModificationResult>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const MONEY = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
export function canModifyStaffBooking(session: StaffBookingSession | null): session is StaffBookingSession {
  return session?.role === 'FRONT_DESK' && UUID.test(session.branchId) && typeof session.mutationHeaders === 'function';
}
const requireValue = (ok: boolean) => { if (!ok) throw new BookingModificationError('The server returned inconsistent data.', 'INVALID_RESPONSE', 502); };
const object = (v: unknown): Record<string, any> => { requireValue(!!v && typeof v === 'object' && !Array.isArray(v)); return v as Record<string, any>; };
const uuid = (v: unknown) => typeof v === 'string' && UUID.test(v);
const text = (v: unknown) => typeof v === 'string' && !!v.trim();
const instant = (v: unknown) => typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const amount = (v: unknown) => typeof v === 'string' && MONEY.test(v);
const minor = (v: string) => { const negative = v.startsWith('-'); const [whole, fraction = ''] = v.replace(/^-/, '').split('.'); return (negative ? -1n : 1n) * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))); };
export function parseTypeQuote(payload: unknown, typeId: string): TypeQuote {
  const t = object(object(payload).data);
  requireValue(uuid(t.roomTypeId) && t.roomTypeId.toLowerCase() === typeId.toLowerCase() && text(t.name)
    && Number.isInteger(t.capacity) && t.capacity > 0 && t.capacity <= 32767 && typeof t.baseDailyRate === 'string'
    && RATE.test(t.baseDailyRate) && typeof t.active === 'boolean');
  return { roomTypeId: t.roomTypeId.toLowerCase(), name: t.name, capacity: t.capacity, baseDailyRate: toMoneyString(t.baseDailyRate), active: t.active };
}
export function parseModificationResult(payload: unknown, review: ModificationReview): ModificationResult {
  const d = object(object(payload).data), l = object(d.line), a = object(l.currentAssignment), i = object(d.invoice);
  requireValue(d.bookingId === review.bookingId && uuid(l.lineId) && (review.lineId ? l.lineId === review.lineId : true)
    && l.checkIn === review.checkIn && l.checkOut === review.checkOut && l.guestCount === review.guestCount
    && typeof l.rateSnapshot === 'string' && RATE.test(l.rateSnapshot) && toMoneyString(l.rateSnapshot) === review.agreedRate
    && l.status === review.originalStatus && uuid(a.assignmentId) && a.roomId === review.roomId && a.roomNumber === review.roomNumber
    && a.roomTypeId === review.input.quotedRoomTypeId && text(a.roomTypeName) && instant(a.assignedAt)
    && (l.status === 'CHECKED_IN' ? instant(a.occupiedFrom) : a.occupiedFrom === null)
    && uuid(i.invoiceId) && amount(i.total) && minor(i.total) >= 0n && amount(i.balance) && amount(i.creditAmount)
    && typeof i.isCredit === 'boolean' && i.isCredit === (minor(i.balance) < 0n)
    && minor(i.creditAmount) === (minor(i.balance) < 0n ? -minor(i.balance) : 0n));
  return { bookingId: d.bookingId, line: { lineId: l.lineId, checkIn: l.checkIn, checkOut: l.checkOut,
    guestCount: l.guestCount, rateSnapshot: toMoneyString(l.rateSnapshot), status: l.status,
    currentAssignment: { assignmentId: a.assignmentId, roomId: a.roomId, roomNumber: a.roomNumber, roomTypeId: a.roomTypeId,
      roomTypeName: a.roomTypeName, assignedAt: a.assignedAt, occupiedFrom: a.occupiedFrom } },
    invoice: { invoiceId: i.invoiceId, total: i.total, balance: i.balance, isCredit: i.isCredit, creditAmount: i.creditAmount } };
}
export class BookingModificationApi implements BookingModificationClient {
  constructor(private readonly session: StaffBookingSession | null, private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  private authorize() { if (!canModifyStaffBooking(this.session)) throw new BookingModificationError('Sign in as Front Desk staff in your assigned branch.', 'FORBIDDEN', 403); }
  async typeQuote(typeId: string, signal?: AbortSignal) {
    this.authorize(); requireValue(uuid(typeId));
    return parseTypeQuote(await this.request(`/api/room-types/${typeId}`, 'GET', undefined, signal), typeId);
  }
  private async request(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const headers = new Headers(body ? await this.session!.mutationHeaders() : undefined);
    if (body) headers.set('Content-Type', 'application/json');
    let response: Response;
    try { response = await this.transport(path, { method, credentials: 'same-origin', headers, body: body ? JSON.stringify(body) : undefined, signal }); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new BookingModificationError(body ? 'The change outcome is unknown. Check booking and invoice records before another attempt.' : 'Unable to load the current catalogue. Try again.', 'NETWORK_ERROR', 0, !!body);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = typeof payload?.error?.code === 'string' ? payload.error.code : 'REQUEST_FAILED';
      const known = ['REQUOTE_REQUIRED', 'INVENTORY_CONFLICT', 'RETRY_TRANSACTION', 'INVALID_STATE', 'NOT_FOUND', 'VALIDATION_ERROR', 'FORBIDDEN'];
      const messages: Record<string, string> = {
        REQUOTE_REQUIRED: 'Room type or rate changed. The operation was rolled back. Search or review a fresh rate before confirming again.',
        INVENTORY_CONFLICT: 'The room conflicts with current inventory. The operation was rolled back; other lines were not changed. Search again.',
        RETRY_TRANSACTION: 'Reservation data changed concurrently. The operation was rolled back. Reload records and review the complete change again.',
        INVALID_STATE: 'The line or invoice no longer allows this change. The operation was rolled back. Reload booking and invoice records.',
        VALIDATION_ERROR: 'Check dates, guests and reason. The operation was rejected.',
        NOT_FOUND: 'The booking, line or room is unavailable in your branch. Reload records.',
      };
      const uncertain = !!body && response.status !== 401 && response.status !== 403 && !(response.status < 500 && known.includes(code));
      throw new BookingModificationError(response.status === 401 ? 'Your session expired. Sign in again.' : response.status === 403 ? 'This change is not permitted in your assigned branch.'
        : uncertain ? 'The change outcome is unknown. Check booking and invoice records before another attempt.' : messages[code] ?? 'The catalogue could not be loaded.', code, response.status, uncertain);
    }
    return payload;
  }
  async modify(review: ModificationReview) {
    this.authorize();
    if (!['add', 'change', 'move'].includes(review.kind) || !uuid(review.bookingId) || !uuid(review.roomId)
      || (review.kind !== 'add' && !uuid(review.lineId)) || !uuid(review.input.quotedRoomTypeId)
      || !RATE.test(review.input.quotedBaseDailyRate) || !review.input.reason.trim() || review.input.reason.length > 200
      || !validDate(review.checkIn) || !validDate(review.checkOut) || review.checkOut <= review.checkIn
      || !Number.isInteger(review.guestCount) || review.guestCount < 1 || review.guestCount > 32767) {
      throw new BookingModificationError('Correct the room-line change before confirming.', 'VALIDATION_ERROR', 400);
    }
    // Project only contract fields; identity/branch and agreed rates are server decisions.
    const source = review.input;
    const input = review.kind === 'move' ? { roomId: review.roomId, quotedRoomTypeId: source.quotedRoomTypeId,
      quotedBaseDailyRate: source.quotedBaseDailyRate, reason: source.reason, approvedPriceAdjustment: null }
      : { ...(review.kind === 'add' ? { roomId: review.roomId } : {}), checkIn: review.checkIn, checkOut: review.checkOut,
        guestCount: review.guestCount, quotedRoomTypeId: source.quotedRoomTypeId, quotedBaseDailyRate: source.quotedBaseDailyRate, reason: source.reason };
    const path = `/api/bookings/${review.bookingId}/lines${review.kind === 'add' ? '' : `/${review.lineId}${review.kind === 'move' ? '/move' : ''}`}`;
    const payload = await this.request(path, review.kind === 'change' ? 'PATCH' : 'POST', input);
    try { return parseModificationResult(payload, review); }
    catch { throw new BookingModificationError('The change response could not be verified. Check booking and invoice records before another attempt.', 'INVALID_RESPONSE', 502, true); }
  }
}
export interface ModificationState {
  booking: StaffBookingDetail | null; loading: boolean; editor: { kind: ModificationKind; lineId?: string } | null;
  draft: ModificationDraft; searching: boolean; rooms: AvailableRoom[] | null; selected: AvailableRoom | null;
  reviewing: boolean; review: ModificationReview | null; acknowledged: boolean; saving: boolean;
  failure: Error | null; notice: string; result: ModificationResult | null; uncertain: boolean; needsRefresh: boolean;
}
const emptyDraft = (): ModificationDraft => ({ checkIn: '', checkOut: '', guestCount: '1', reason: '' });
export const initialModificationState = (): ModificationState => ({ booking: null, loading: false, editor: null, draft: emptyDraft(), searching: false,
  rooms: null, selected: null, reviewing: false, review: null, acknowledged: false, saving: false, failure: null, notice: '', result: null, uncertain: false, needsRefresh: false });
const failure = (error: unknown): Error => error instanceof Error ? error : new BookingModificationError('The request failed.');
export class BookingModificationModel {
  private state = initialModificationState(); private listeners = new Set<() => void>(); private token = 0; private loadToken = 0;
  private bookingId?: string;
  private abort?: AbortController; private loadAbort?: AbortController; private saveToken = 0;
  constructor(private readonly session: StaffBookingSession | null, private readonly read: StaffBookingReadClient,
    private readonly availability: AvailabilityClient, private readonly client: BookingModificationClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ModificationState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private cancelReview() { this.token++; this.abort?.abort(); }
  cancelPending = () => { this.cancelReview(); this.loadToken++; this.loadAbort?.abort(); this.saveToken++; };
  private locked() { return this.state.saving || this.state.loading || this.state.uncertain || this.state.needsRefresh; }
  private authorize() { if (!canModifyStaffBooking(this.session)) throw new BookingModificationError('Sign in as Front Desk staff in your assigned branch.', 'FORBIDDEN', 403); }
  private fail(error: unknown, patch: Partial<ModificationState> = {}) {
    const e = failure(error), status = (e as { status?: number }).status;
    if (status === 401 || status === 403 || status === 404) { this.cancelReview(); this.publish({ ...initialModificationState(), uncertain: this.state.uncertain || !!patch.uncertain, failure: e }); }
    else this.publish({ ...patch, failure: e });
  }
  async load(bookingId: string) {
    if (this.state.saving) return;
    const same = this.bookingId === bookingId;
    this.bookingId = bookingId;
    this.cancelReview(); const token = ++this.loadToken;
    this.loadAbort?.abort(); this.loadAbort = new AbortController();
    this.publish({ ...(same ? {} : initialModificationState()), booking: null, loading: true, review: null, acknowledged: false, searching: false, reviewing: false, rooms: null, selected: null, failure: null });
    try { this.authorize(); const booking = await this.read.detail(bookingId, this.loadAbort.signal);
      if (token !== this.loadToken) return;
      this.publish({ booking, loading: false, needsRefresh: false,
        notice: this.state.result ? 'Change committed. All booking room lines and preserved histories have refreshed.' : this.state.notice });
    } catch (error) { if (token === this.loadToken) this.fail(error, { loading: false, needsRefresh: true }); }
  }
  start(kind: ModificationKind, lineId?: string) {
    if (this.locked() || !this.state.booking) return;
    try {
      this.authorize(); const line = lineId ? this.state.booking.lines.find(l => l.lineId === lineId) : undefined;
      if (kind !== 'add' && (!line || (kind === 'change' ? line.status !== 'BOOKED' : !['BOOKED', 'CHECKED_IN'].includes(line.status)))) throw new BookingModificationError('This line cannot use the selected operation.', 'INVALID_STATE', 409);
      this.cancelReview(); this.publish({ editor: { kind, lineId: line?.lineId }, draft: line ? { checkIn: line.checkIn, checkOut: line.checkOut, guestCount: String(line.guestCount), reason: '' } : emptyDraft(),
        rooms: null, selected: null, review: null, acknowledged: false, reviewing: false, searching: false, failure: null, result: null, notice: '' });
    } catch (e) { this.fail(e); }
  }
  close() { if (!this.locked()) { this.cancelReview(); this.publish({ editor: null, review: null, rooms: null, selected: null, acknowledged: false, reviewing: false, searching: false, failure: null }); } }
  setDraft(patch: Partial<ModificationDraft>) {
    if (this.locked() || !this.state.editor) return;
    const update = this.state.editor.kind === 'move' ? { reason: patch.reason ?? this.state.draft.reason } : patch;
    if (Object.entries(update).every(([key, value]) => this.state.draft[key as keyof ModificationDraft] === value)) return;
    this.cancelReview(); this.publish({ draft: { ...this.state.draft, ...update }, rooms: null, selected: null, review: null, acknowledged: false, searching: false, reviewing: false, failure: null });
  }
  private line(): BookingRoomLine | undefined { return this.state.booking?.lines.find(l => l.lineId === this.state.editor?.lineId); }
  private criteria(): AvailabilitySearch {
    this.authorize(); const d = this.state.draft;
    if (!validDate(d.checkIn) || !validDate(d.checkOut) || d.checkOut <= d.checkIn || !/^[1-9]\d*$/.test(d.guestCount) || Number(d.guestCount) > 32767) throw new BookingModificationError('Choose valid stay dates and 1–32767 guests.', 'VALIDATION_ERROR', 400);
    return { branchId: this.session!.branchId, checkIn: d.checkIn, checkOut: d.checkOut, guestCount: Number(d.guestCount), roomTypeId: null, immediateCheckIn: this.line()?.status === 'CHECKED_IN' };
  }
  async search() {
    if (this.locked() || !this.state.editor || this.state.editor.kind === 'change') return;
    this.cancelReview(); const token = this.token; this.abort = new AbortController();
    this.publish({ searching: true, reviewing: false, rooms: null, selected: null, review: null, acknowledged: false, failure: null });
    try { const criteria = this.criteria(); const rooms = await this.availability.search(criteria, this.abort.signal);
      if (token !== this.token) return;
      const current = this.line()?.assignments.find(a => a.current)?.roomId;
      this.publish({ searching: false, rooms: rooms.filter(r => r.roomId !== current && r.branchId === criteria.branchId && r.roomType.capacity >= criteria.guestCount
        && (!criteria.immediateCheckIn || r.operationalStatus === 'READY') && !this.localConflict(r, criteria)) });
    } catch (e) { if (token === this.token) this.fail(e, { searching: false }); }
  }
  private localConflict(room: AvailableRoom, criteria: AvailabilitySearch) {
    return this.state.booking!.lines.some(l => l.lineId !== this.state.editor?.lineId && ['BOOKED', 'CHECKED_IN'].includes(l.status)
      && l.assignments.some(a => a.current && a.roomId === room.roomId) && overlaps(criteria, { ...criteria, checkIn: l.checkIn, checkOut: l.checkOut }));
  }
  select(roomId: string) { if (!this.locked()) { const selected = this.state.rooms?.find(r => r.roomId === roomId); if (selected) { this.cancelReview(); this.publish({ selected, review: null, acknowledged: false, reviewing: false, searching: false, failure: null }); } } }
  async prepare() {
    if (this.locked() || !this.state.editor || !this.state.booking) return;
    this.cancelReview(); const token = this.token; this.abort = new AbortController();
    this.publish({ reviewing: true, searching: false, review: null, acknowledged: false, failure: null });
    try {
      const { kind, lineId } = this.state.editor, line = this.line(), reason = this.state.draft.reason.trim();
      if (kind !== 'add' && (!line || (kind === 'change' ? line.status !== 'BOOKED' : !['BOOKED', 'CHECKED_IN'].includes(line.status)))) throw new BookingModificationError('The line state changed. Reload records and select an eligible operation.', 'INVALID_STATE', 409);
      if (kind === 'move') this.publish({ draft: { ...this.state.draft, checkIn: line!.checkIn, checkOut: line!.checkOut, guestCount: String(line!.guestCount) } });
      const criteria = this.criteria();
      if (!reason || this.state.draft.reason.length > 200) throw new BookingModificationError('Enter a reason of 1–200 characters.', 'VALIDATION_ERROR', 400);
      let roomId: string, roomNumber: string, type: TypeQuote;
      if (kind === 'change') {
        const assignment = line!.assignments.find(a => a.current)!; roomId = assignment.roomId; roomNumber = assignment.roomNumber;
        type = await this.client.typeQuote(assignment.roomType.roomTypeId, this.abort.signal);
        if (!assignment.roomActive) throw new BookingModificationError('The current room is inactive. Reload records.', 'INVALID_STATE', 409);
      } else {
        const room = this.state.selected;
        if (!room) throw new BookingModificationError('Search and choose a target room first.', 'VALIDATION_ERROR', 400);
        const current = await this.availability.search(criteria, this.abort.signal);
        const fresh = current.find(r => r.roomId === room.roomId);
        if (!fresh || fresh.branchId !== criteria.branchId || fresh.roomType.capacity < criteria.guestCount || this.localConflict(fresh, criteria)
          || (criteria.immediateCheckIn && fresh.operationalStatus !== 'READY')) throw new BookingModificationError('The selected room is no longer available. Search again.', 'INVENTORY_CONFLICT', 409);
        roomId = fresh.roomId; roomNumber = fresh.roomNumber; type = { ...fresh.roomType, active: true };
      }
      if (token !== this.token) return;
      if (!type.active || type.capacity < criteria.guestCount) throw new BookingModificationError('The room type is inactive or too small. Reload records or choose another room.', 'INVALID_STATE', 409);
      const base = { quotedRoomTypeId: type.roomTypeId, quotedBaseDailyRate: toMoneyString(type.baseDailyRate), reason };
      const input = kind === 'move' ? { ...base, roomId, approvedPriceAdjustment: null } : { ...base, ...(kind === 'add' ? { roomId } : {}), checkIn: criteria.checkIn, checkOut: criteria.checkOut, guestCount: criteria.guestCount };
      const review: ModificationReview = { kind, bookingId: this.state.booking.bookingId, lineId, roomId, roomNumber,
        checkIn: criteria.checkIn, checkOut: criteria.checkOut, guestCount: criteria.guestCount, catalogueRate: base.quotedBaseDailyRate,
        agreedRate: kind === 'move' && line!.status === 'CHECKED_IN' ? line!.rateSnapshot : base.quotedBaseDailyRate,
        originalStatus: kind === 'move' ? line!.status as 'BOOKED' | 'CHECKED_IN' : 'BOOKED', input };
      this.publish({ review, reviewing: false });
    } catch (e) { if (token === this.token) this.fail(e, { reviewing: false }); }
  }
  acknowledge() { if (!this.locked() && this.state.review) this.publish({ acknowledged: !this.state.acknowledged }); }
  async confirm() {
    if (this.locked() || !this.state.review || !this.state.acknowledged) return;
    const review = this.state.review; const token = ++this.saveToken;
    this.publish({ saving: true, failure: null });
    try { this.authorize(); const result = await this.client.modify(review);
      if (token !== this.saveToken) return;
      if (review.kind === 'add' && this.state.booking?.lines.some(l => l.lineId === result.line.lineId)) throw new BookingModificationError('The new line response could not be verified. Check booking and invoice records.', 'INVALID_RESPONSE', 502, true);
      this.publish({ saving: false, result, editor: null, review: null, acknowledged: false, needsRefresh: true,
        notice: 'Change committed and DRAFT invoice refreshed. Reloading all room lines and preserved histories…' });
      await this.load(review.bookingId);
    } catch (e) {
      if (token !== this.saveToken) return;
      const uncertain = !(e instanceof BookingModificationError) || e.uncertain;
      this.fail(e, { saving: false, review: null, acknowledged: false, uncertain,
        needsRefresh: uncertain || (e instanceof BookingModificationError && ['INVALID_STATE', 'RETRY_TRANSACTION'].includes(e.code)),
        notice: '' });
    }
  }
  reconciled() {
    if (this.state.uncertain && this.state.booking && !this.state.loading && !this.state.needsRefresh) this.publish({ uncertain: false, editor: null, review: null, selected: null, rooms: null,
      failure: null, notice: 'Outcome checked against booking and invoice records. Start a new change if still needed.' });
  }
}
