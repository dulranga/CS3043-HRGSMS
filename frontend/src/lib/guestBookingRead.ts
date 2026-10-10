import { validDate } from './availability';
import { toMoneyString } from './money';
import { BookingChannel, LineSummary, RoomLineStatus, RoomLineValues } from './staffBookingRead';

// Member 1 supplies this verified session; a URL/form/storage value is not identity.
export interface GuestBookingReadSession { accountKind: string }
export interface GuestBookingHeader {
  bookingId: string; bookingRef: string; bookingChannel: BookingChannel; createdAt: string; updatedAt: string;
}
export interface GuestBookingListItem extends GuestBookingHeader { lineSummary: LineSummary }
export interface GuestBookingPage { items: GuestBookingListItem[]; pagination: { limit: number; offset: number; returned: number } }
export interface GuestRoomLine extends RoomLineValues {
  lineId: string; status: RoomLineStatus; createdAt: string; updatedAt: string;
  assignments: { assignmentId: string; roomNumber: string; roomType: { name: string }; assignedAt: string;
    unassignedAt: string | null; occupiedFrom: string | null; occupiedTo: string | null; current: boolean }[];
  statusHistory: { historyId: string; oldStatus: RoomLineStatus | null; newStatus: RoomLineStatus; changedAt: string }[];
  revisions: { revisionId: string; oldValues: RoomLineValues; newValues: RoomLineValues; changedAt: string }[];
}
export interface GuestBookingDetail extends GuestBookingHeader { lines: GuestRoomLine[] }
export class GuestBookingReadError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly status = 0) { super(message); }
}
export const canReadGuestBookings = (session: GuestBookingReadSession | null): session is GuestBookingReadSession => session?.accountKind === 'guest';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireValue(ok: boolean): void { if (!ok) throw new GuestBookingReadError('The hotel returned inconsistent booking records. Reload to try again.', 'INVALID_RESPONSE', 502); }
const object = (v: unknown): Record<string, any> => { requireValue(!!v && typeof v === 'object' && !Array.isArray(v)); return v as Record<string, any>; };
const uuid = (v: unknown): string => { requireValue(typeof v === 'string' && UUID.test(v)); return (v as string).toLowerCase(); };
const text = (v: unknown): string => { requireValue(typeof v === 'string' && !!v.trim()); return v as string; };
const date = (v: unknown): string => { requireValue(typeof v === 'string' && validDate(v)); return v as string; };
const instant = (v: unknown): string => { requireValue(typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))); return v as string; };
const nullableInstant = (v: unknown) => v === null ? null : instant(v);
const count = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => { requireValue(Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max); return v as number; };
const array = (v: unknown): unknown[] => { requireValue(Array.isArray(v)); return v as unknown[]; };
const status = (v: unknown): RoomLineStatus => { requireValue(['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(v as string)); return v as RoomLineStatus; };
const unique = (ids: string[]) => requireValue(new Set(ids).size === ids.length);
function header(value: unknown): GuestBookingHeader {
  const h = object(value); requireValue(['DIRECT_ONLINE', 'FRONT_DESK', 'PHONE', 'EMAIL'].includes(h.bookingChannel));
  // Own history includes staff-assisted reservations too, not only DIRECT_ONLINE.
  return { bookingId: uuid(h.bookingId), bookingRef: text(h.bookingRef), bookingChannel: h.bookingChannel, createdAt: instant(h.createdAt), updatedAt: instant(h.updatedAt) };
}
function values(value: unknown): RoomLineValues {
  const v = object(value), checkIn = date(v.checkIn), checkOut = date(v.checkOut);
  requireValue(checkOut > checkIn && typeof v.rateSnapshot === 'string' && /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(v.rateSnapshot));
  return { checkIn, checkOut, guestCount: count(v.guestCount, 1, 32767), rateSnapshot: toMoneyString(v.rateSnapshot) };
}
export function parseGuestBookingPage(payload: unknown, limit: number, offset: number): GuestBookingPage {
  const d = object(object(payload).data), p = object(d.pagination);
  const items = array(d.items).map(value => {
    const h = header(value), s = object(object(value).lineSummary);
    const lineSummary: LineSummary = { total: count(s.total, 1), booked: count(s.booked), checkedIn: count(s.checkedIn), checkedOut: count(s.checkedOut),
      cancelled: count(s.cancelled), noShow: count(s.noShow), firstStayDate: date(s.firstStayDate), lastStayDate: date(s.lastStayDate) };
    requireValue(lineSummary.total === lineSummary.booked + lineSummary.checkedIn + lineSummary.checkedOut + lineSummary.cancelled + lineSummary.noShow && lineSummary.lastStayDate > lineSummary.firstStayDate);
    return { ...h, lineSummary };
  });
  unique(items.map(i => i.bookingId)); unique(items.map(i => i.bookingRef));
  requireValue(p.limit === limit && p.offset === offset && p.returned === items.length && items.length <= limit);
  return { items, pagination: { limit, offset, returned: items.length } };
}
export function parseGuestBookingDetail(payload: unknown, bookingId: string): GuestBookingDetail {
  const d = object(object(payload).data), h = header(d); requireValue(h.bookingId === uuid(bookingId));
  const lines: GuestRoomLine[] = array(d.lines).map(value => {
    const l = object(value), lineStatus = status(l.status);
    const assignments = array(l.assignments).map(value => {
      const a = object(value), assignedAt = instant(a.assignedAt), unassignedAt = nullableInstant(a.unassignedAt), occupiedFrom = nullableInstant(a.occupiedFrom), occupiedTo = nullableInstant(a.occupiedTo);
      requireValue(typeof a.current === 'boolean' && a.current === (unassignedAt === null)
        && (!unassignedAt || Date.parse(unassignedAt) >= Date.parse(assignedAt))
        && (!occupiedFrom || Date.parse(occupiedFrom) >= Date.parse(assignedAt))
        && (!occupiedTo || (!!occupiedFrom && Date.parse(occupiedTo) > Date.parse(occupiedFrom)))
        && (!unassignedAt || !occupiedFrom || (!!occupiedTo && Date.parse(occupiedTo) <= Date.parse(unassignedAt))));
      return { assignmentId: uuid(a.assignmentId), roomNumber: text(a.roomNumber), roomType: { name: text(object(a.roomType).name) },
        assignedAt, unassignedAt, occupiedFrom, occupiedTo, current: a.current as boolean };
    });
    const current = assignments.filter(a => a.current);
    requireValue(assignments.length > 0 && current.length === (['BOOKED', 'CHECKED_IN'].includes(lineStatus) ? 1 : 0));
    if (lineStatus === 'CHECKED_IN') requireValue(current[0].occupiedFrom !== null && current[0].occupiedTo === null);
    if (lineStatus === 'BOOKED') requireValue(current[0].occupiedFrom === null && current[0].occupiedTo === null);
    const statusHistory = array(l.statusHistory).map(value => { const s = object(value);
      return { historyId: uuid(s.historyId), oldStatus: s.oldStatus === null ? null : status(s.oldStatus), newStatus: status(s.newStatus), changedAt: instant(s.changedAt) }; });
    const revisions = array(l.revisions).map(value => { const r = object(value);
      return { revisionId: uuid(r.revisionId), oldValues: values(r.oldValues), newValues: values(r.newValues), changedAt: instant(r.changedAt) }; });
    return { ...values(l), lineId: uuid(l.lineId), status: lineStatus, createdAt: instant(l.createdAt), updatedAt: instant(l.updatedAt), assignments, statusHistory, revisions };
  });
  requireValue(lines.length > 0); unique(lines.map(l => l.lineId)); unique(lines.flatMap(l => l.assignments.map(a => a.assignmentId)));
  unique(lines.flatMap(l => l.statusHistory.map(s => s.historyId))); unique(lines.flatMap(l => l.revisions.map(r => r.revisionId)));
  // Project only guest-facing facts; no actor/guest IDs, contact/NIC, internal
  // condition/branch metadata or free-text staff reasons are retained.
  return { ...h, lines };
}
export interface GuestBookingReadClient {
  list(limit: number, offset: number, signal?: AbortSignal): Promise<GuestBookingPage>;
  detail(bookingId: string, signal?: AbortSignal): Promise<GuestBookingDetail>;
}
export class GuestBookingReadApi implements GuestBookingReadClient {
  constructor(private readonly session: GuestBookingReadSession | null, private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!canReadGuestBookings(this.session)) throw new GuestBookingReadError('Sign in to your SkyNest guest account to view your bookings.', 'FORBIDDEN', 403);
    let response: Response;
    try { response = await this.transport(path, { method: 'GET', credentials: 'same-origin', signal }); }
    catch { throw new GuestBookingReadError('Your bookings could not be reached. Reload to try again.', 'NETWORK_ERROR'); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new GuestBookingReadError(response.status === 401 ? 'Your session expired. Sign in again.' : response.status === 403 ? 'Your account cannot access these bookings. Sign in with your active SkyNest guest account.'
      : response.status === 404 ? 'Booking not found.' : 'Your bookings could not be loaded. Reload to try again.', response.status === 404 ? 'BOOKING_NOT_FOUND' : 'REQUEST_FAILED', response.status);
    return payload;
  }
  async list(limit: number, offset: number, signal?: AbortSignal) {
    count(limit, 1, 100); count(offset);
    return parseGuestBookingPage(await this.get(`/api/guest/bookings?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`, signal), limit, offset);
  }
  async detail(bookingId: string, signal?: AbortSignal) {
    const id = uuid(bookingId); return parseGuestBookingDetail(await this.get(`/api/guest/bookings/${id}`, signal), id);
  }
}
export interface GuestBookingReadState {
  page: GuestBookingPage | null; offset: number; limit: number; loadingList: boolean; listFailure: GuestBookingReadError | null;
  selectedId: string | null; detail: GuestBookingDetail | null; loadingDetail: boolean; detailFailure: GuestBookingReadError | null; denied: boolean;
}
export const initialGuestBookingReadState = (): GuestBookingReadState => ({ page: null, offset: 0, limit: 20, loadingList: false, listFailure: null,
  selectedId: null, detail: null, loadingDetail: false, detailFailure: null, denied: false });
const failure = (e: unknown) => e instanceof GuestBookingReadError ? e : new GuestBookingReadError('Your bookings could not be loaded. Reload to try again.');
export class GuestBookingReadModel {
  private state = initialGuestBookingReadState(); private listeners = new Set<() => void>();
  private listToken = 0; private detailToken = 0; private listAbort?: AbortController; private detailAbort?: AbortController;
  constructor(private readonly session: GuestBookingReadSession | null, private readonly client: GuestBookingReadClient) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<GuestBookingReadState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  cancelPending = () => { this.listToken++; this.detailToken++; this.listAbort?.abort(); this.detailAbort?.abort(); };
  private authorize() { if (!canReadGuestBookings(this.session)) throw new GuestBookingReadError('Sign in to your SkyNest guest account to view your bookings.', 'FORBIDDEN', 403); }
  private fail(e: unknown, patch: Partial<GuestBookingReadState>) {
    const err = failure(e);
    if ([401, 403].includes(err.status)) { this.cancelPending(); this.publish({ ...initialGuestBookingReadState(), denied: true, listFailure: err, detailFailure: err }); }
    else this.publish({ ...patch, ...('loadingList' in patch ? { listFailure: err } : { detailFailure: err }) });
  }
  async loadList(offset = this.state.offset) {
    if (this.state.denied) return;
    const token = ++this.listToken; this.listAbort?.abort(); this.listAbort = new AbortController();
    this.publish({ page: null, offset, loadingList: true, listFailure: null });
    try {
      this.authorize(); count(offset);
      const page = await this.client.list(this.state.limit, offset, this.listAbort.signal);
      if (token === this.listToken) this.publish({ page: parseGuestBookingPage({ data: page }, this.state.limit, offset), loadingList: false });
    } catch (e) { if (token === this.listToken) this.fail(e, { loadingList: false }); }
  }
  async open(bookingId: string) {
    if (this.state.denied) return;
    const token = ++this.detailToken; this.detailAbort?.abort(); this.detailAbort = new AbortController();
    this.publish({ selectedId: bookingId, detail: null, loadingDetail: true, detailFailure: null });
    try {
      this.authorize(); const id = uuid(bookingId), detail = await this.client.detail(id, this.detailAbort.signal);
      if (token === this.detailToken) this.publish({ detail: parseGuestBookingDetail({ data: detail }, id), loadingDetail: false });
    } catch (e) { if (token === this.detailToken) this.fail(e, { loadingDetail: false }); }
  }
  back() { if (this.state.denied) return; this.detailToken++; this.detailAbort?.abort(); this.publish({ selectedId: null, detail: null, loadingDetail: false, detailFailure: null }); }
  next() { if (!this.state.loadingList && this.state.page?.pagination.returned === this.state.limit) return this.loadList(this.state.offset + this.state.limit); }
  previous() { if (!this.state.loadingList && this.state.offset > 0) return this.loadList(Math.max(0, this.state.offset - this.state.limit)); }
}
