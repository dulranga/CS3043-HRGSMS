import { validDate } from './availability';
import { toMoneyString } from './money';

export interface StaffBookingReadSession { role: string; branchId: string }
export type BookingChannel = 'DIRECT_ONLINE' | 'FRONT_DESK' | 'PHONE' | 'EMAIL';
export type RoomLineStatus = 'BOOKED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
export interface BookingHeader {
  bookingId: string; bookingRef: string; bookingChannel: BookingChannel;
  createdAt: string; updatedAt: string; createdBy: string;
  guest: { guestId: string; fullName: string };
}
export interface LineSummary {
  total: number; booked: number; checkedIn: number; checkedOut: number; cancelled: number; noShow: number;
  firstStayDate: string; lastStayDate: string;
}
export interface StaffBookingListItem extends BookingHeader { lineSummary: LineSummary }
export interface BookingPage { items: StaffBookingListItem[]; pagination: { limit: number; offset: number; returned: number } }
export interface RoomLineValues { checkIn: string; checkOut: string; guestCount: number; rateSnapshot: string }
export interface RoomAssignment {
  assignmentId: string; roomId: string; roomNumber: string; branchId: string; roomActive: boolean;
  operationalStatus: 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';
  roomType: { roomTypeId: string; name: string; capacity: number };
  assignedAt: string; unassignedAt: string | null; occupiedFrom: string | null; occupiedTo: string | null; current: boolean;
}
export interface BookingRoomLine extends RoomLineValues {
  lineId: string; status: RoomLineStatus; createdAt: string; updatedAt: string;
  assignments: RoomAssignment[];
  statusHistory: { historyId: string; oldStatus: RoomLineStatus | null; newStatus: RoomLineStatus; changedAt: string; changedBy: string; reason: string | null }[];
  revisions: { revisionId: string; oldValues: RoomLineValues; newValues: RoomLineValues; changedAt: string; changedBy: string; reason: string }[];
}
export interface StaffBookingDetail extends BookingHeader { lines: BookingRoomLine[] }
export class StaffBookingReadError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly status = 0) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
export function canReadStaffBookings(session: StaffBookingReadSession | null): session is StaffBookingReadSession {
  return session?.role === 'FRONT_DESK' && UUID.test(session.branchId);
}
function requireValue(ok: boolean): void { if (!ok) throw new StaffBookingReadError('The server returned inconsistent booking records. Reload to try again.', 'INVALID_RESPONSE', 502); }
function object(value: unknown): Record<string, any> { requireValue(!!value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, any>; }
function uuid(value: unknown): string { requireValue(typeof value === 'string' && UUID.test(value)); return (value as string).toLowerCase(); }
function text(value: unknown): string { requireValue(typeof value === 'string' && value.trim().length > 0); return value as string; }
function instant(value: unknown): string { requireValue(typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))); return value as string; }
function nullableInstant(value: unknown): string | null { return value === null ? null : instant(value); }
function date(value: unknown): string { requireValue(typeof value === 'string' && validDate(value)); return value as string; }
function count(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { requireValue(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max); return value as number; }
function rate(value: unknown): string { requireValue(typeof value === 'string' && RATE.test(value)); return toMoneyString(value as string); }
function status(value: unknown): RoomLineStatus { requireValue(['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(value as string)); return value as RoomLineStatus; }
function array(value: unknown): unknown[] { requireValue(Array.isArray(value)); return value as unknown[]; }
function unique(ids: string[]): void { requireValue(new Set(ids).size === ids.length); }
function header(value: unknown): BookingHeader {
  const h = object(value), g = object(h.guest);
  requireValue(['DIRECT_ONLINE', 'FRONT_DESK', 'PHONE', 'EMAIL'].includes(h.bookingChannel));
  // Project only what this screen needs. NIC/contact fields and extra metadata
  // from the existing staff API are deliberately not retained or rendered.
  return { bookingId: uuid(h.bookingId), bookingRef: text(h.bookingRef), bookingChannel: h.bookingChannel,
    createdAt: instant(h.createdAt), updatedAt: instant(h.updatedAt), createdBy: uuid(h.createdBy),
    guest: { guestId: uuid(g.guestId), fullName: text(g.fullName) } };
}
function values(value: unknown): RoomLineValues {
  const v = object(value), checkIn = date(v.checkIn), checkOut = date(v.checkOut); requireValue(checkOut > checkIn);
  return { checkIn, checkOut, guestCount: count(v.guestCount, 1, 32767), rateSnapshot: rate(v.rateSnapshot) };
}
export function parseBookingPage(payload: unknown, limit: number, offset: number): BookingPage {
  const data = object(object(payload).data), p = object(data.pagination);
  const items = array(data.items).map(value => {
    const h = header(value), s = object(object(value).lineSummary);
    const lineSummary: LineSummary = { total: count(s.total, 1), booked: count(s.booked), checkedIn: count(s.checkedIn), checkedOut: count(s.checkedOut), cancelled: count(s.cancelled), noShow: count(s.noShow),
      firstStayDate: date(s.firstStayDate), lastStayDate: date(s.lastStayDate) };
    requireValue(lineSummary.total === lineSummary.booked + lineSummary.checkedIn + lineSummary.checkedOut + lineSummary.cancelled + lineSummary.noShow
      && lineSummary.lastStayDate > lineSummary.firstStayDate);
    return { ...h, lineSummary };
  });
  unique(items.map(item => item.bookingId)); unique(items.map(item => item.bookingRef));
  requireValue(p.limit === limit && p.offset === offset && p.returned === items.length && items.length <= limit);
  return { items, pagination: { limit, offset, returned: items.length } };
}
export function parseStaffBookingDetail(payload: unknown, bookingId: string, branchId: string): StaffBookingDetail {
  const data = object(object(payload).data), h = header(data);
  requireValue(h.bookingId === bookingId.toLowerCase());
  const lines: BookingRoomLine[] = array(data.lines).map(value => {
    const l = object(value), lineStatus = status(l.status);
    const assignments: RoomAssignment[] = array(l.assignments).map(value => {
      const a = object(value), t = object(a.roomType);
      const assignmentBranch = uuid(a.branchId);
      if (assignmentBranch !== branchId.toLowerCase()) throw new StaffBookingReadError('This booking is unavailable in your assigned branch.', 'BRANCH_DENIED', 403);
      const assignedAt = instant(a.assignedAt), unassignedAt = nullableInstant(a.unassignedAt), occupiedFrom = nullableInstant(a.occupiedFrom), occupiedTo = nullableInstant(a.occupiedTo);
      requireValue(typeof a.roomActive === 'boolean' && typeof a.current === 'boolean' && a.current === (unassignedAt === null)
        && ['READY', 'CLEANING', 'OUT_OF_SERVICE'].includes(a.operationalStatus)
        && (!unassignedAt || Date.parse(unassignedAt) >= Date.parse(assignedAt))
        && (!occupiedTo || (!!occupiedFrom && Date.parse(occupiedTo) > Date.parse(occupiedFrom)))
        && (!occupiedFrom || Date.parse(occupiedFrom) >= Date.parse(assignedAt)));
      return { assignmentId: uuid(a.assignmentId), roomId: uuid(a.roomId), roomNumber: text(a.roomNumber), branchId: assignmentBranch,
        roomActive: a.roomActive, operationalStatus: a.operationalStatus, current: a.current,
        roomType: { roomTypeId: uuid(t.roomTypeId), name: text(t.name), capacity: count(t.capacity, 1, 32767) }, assignedAt, unassignedAt, occupiedFrom, occupiedTo };
    });
    const current = assignments.filter(a => a.current);
    requireValue(assignments.length > 0 && current.length === (['BOOKED', 'CHECKED_IN'].includes(lineStatus) ? 1 : 0));
    if (lineStatus === 'CHECKED_IN') requireValue(current[0].occupiedFrom !== null && current[0].occupiedTo === null);
    const statusHistory = array(l.statusHistory).map(value => {
      const s = object(value); requireValue(s.reason === null || typeof s.reason === 'string');
      return { historyId: uuid(s.historyId), oldStatus: s.oldStatus === null ? null : status(s.oldStatus), newStatus: status(s.newStatus), changedAt: instant(s.changedAt), changedBy: uuid(s.changedBy), reason: s.reason as string | null };
    });
    const revisions = array(l.revisions).map(value => {
      const r = object(value);
      return { revisionId: uuid(r.revisionId), oldValues: values(r.oldValues), newValues: values(r.newValues), changedAt: instant(r.changedAt), changedBy: uuid(r.changedBy), reason: text(r.reason) };
    });
    return { ...values(l), lineId: uuid(l.lineId), status: lineStatus, createdAt: instant(l.createdAt), updatedAt: instant(l.updatedAt), assignments, statusHistory, revisions };
  });
  requireValue(lines.length > 0); unique(lines.map(l => l.lineId));
  unique(lines.flatMap(l => l.assignments.map(a => a.assignmentId)));
  unique(lines.flatMap(l => l.statusHistory.map(s => s.historyId))); unique(lines.flatMap(l => l.revisions.map(r => r.revisionId)));
  return { ...h, lines };
}
export function summarizeLines(lines: BookingRoomLine[]): LineSummary {
  const counts = (s: RoomLineStatus) => lines.filter(line => line.status === s).length;
  return { total: lines.length, booked: counts('BOOKED'), checkedIn: counts('CHECKED_IN'), checkedOut: counts('CHECKED_OUT'), cancelled: counts('CANCELLED'), noShow: counts('NO_SHOW'),
    firstStayDate: [...lines].map(l => l.checkIn).sort()[0], lastStayDate: [...lines].map(l => l.checkOut).sort().at(-1)! };
}
export function progressLabel(summary: LineSummary): string {
  if ([summary.booked, summary.checkedIn, summary.checkedOut, summary.cancelled, summary.noShow].filter(count => count > 0).length > 1) return 'Mixed line states';
  return summary.booked ? 'All lines BOOKED' : summary.checkedIn ? 'All lines CHECKED_IN' : summary.checkedOut ? 'All lines CHECKED_OUT' : summary.cancelled ? 'All lines CANCELLED' : 'All lines NO_SHOW';
}
export function hotelTime(value: string | null): string {
  return value === null ? 'Not recorded' : new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', hour12: false });
}
export interface StaffBookingReadClient {
  list(limit: number, offset: number, signal?: AbortSignal): Promise<BookingPage>;
  detail(bookingId: string, signal?: AbortSignal): Promise<StaffBookingDetail>;
}
export class StaffBookingReadApi implements StaffBookingReadClient {
  constructor(private readonly session: StaffBookingReadSession | null, private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!canReadStaffBookings(this.session)) throw new StaffBookingReadError('Sign in as Front Desk staff to view bookings.', 'FORBIDDEN', 403);
    let response: Response;
    try { response = await this.transport(path, { method: 'GET', credentials: 'same-origin', signal }); }
    catch { throw new StaffBookingReadError('Booking records could not be reached. Reload to try again.', 'NETWORK_ERROR'); }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new StaffBookingReadError(response.status === 401 ? 'Your session expired. Sign in again.'
      : response.status === 403 ? 'Your session cannot view these booking records.'
      : response.status === 404 ? 'Booking not found in your assigned branch.'
      : 'Booking records could not be loaded. Reload to try again.', response.status === 404 ? 'BOOKING_NOT_FOUND' : 'REQUEST_FAILED', response.status);
    return payload;
  }
  async list(limit: number, offset: number, signal?: AbortSignal) {
    count(limit, 1, 100); count(offset);
    return parseBookingPage(await this.get(`/api/bookings?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`, signal), limit, offset);
  }
  async detail(bookingId: string, signal?: AbortSignal) {
    const id = uuid(bookingId);
    return parseStaffBookingDetail(await this.get(`/api/bookings/${id}`, signal), id, this.session!.branchId);
  }
}
export interface StaffBookingReadState {
  page: BookingPage | null; offset: number; limit: number; loadingList: boolean; listFailure: StaffBookingReadError | null;
  selectedId: string | null; detail: StaffBookingDetail | null; loadingDetail: boolean; detailFailure: StaffBookingReadError | null;
}
export const initialStaffBookingReadState = (): StaffBookingReadState => ({ page: null, offset: 0, limit: 20, loadingList: false, listFailure: null,
  selectedId: null, detail: null, loadingDetail: false, detailFailure: null });
const failure = (err: unknown) => err instanceof StaffBookingReadError ? err : new StaffBookingReadError('Booking records could not be loaded. Reload to try again.');
export class StaffBookingReadModel {
  private state = initialStaffBookingReadState(); private listeners = new Set<() => void>();
  private listToken = 0; private detailToken = 0; private listAbort?: AbortController; private detailAbort?: AbortController;
  constructor(private readonly session: StaffBookingReadSession | null, private readonly client: StaffBookingReadClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<StaffBookingReadState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(l => l()); }
  cancelPending = () => { this.listToken++; this.detailToken++; this.listAbort?.abort(); this.detailAbort?.abort(); };
  private authorize() { if (!canReadStaffBookings(this.session)) throw new StaffBookingReadError('Sign in as Front Desk staff to view bookings.', 'FORBIDDEN', 403); }
  private deny(error: StaffBookingReadError) {
    if (![401, 403].includes(error.status)) return {};
    this.cancelPending();
    return { page: null, detail: null, loadingList: false, loadingDetail: false, listFailure: error, detailFailure: error };
  }
  async loadList(offset = this.state.offset) {
    const token = ++this.listToken; this.listAbort?.abort(); this.listAbort = new AbortController();
    this.publish({ offset, page: null, loadingList: true, listFailure: null });
    try {
      this.authorize(); count(offset);
      const page = await this.client.list(this.state.limit, offset, this.listAbort.signal);
      if (token !== this.listToken) return;
      this.publish({ page: parseBookingPage({ data: page }, this.state.limit, offset), loadingList: false });
    } catch (error) { if (token === this.listToken) { const err = failure(error); this.publish({ ...this.deny(err), loadingList: false, listFailure: err }); } }
  }
  async open(bookingId: string) {
    const token = ++this.detailToken; this.detailAbort?.abort(); this.detailAbort = new AbortController();
    this.publish({ selectedId: bookingId, detail: null, loadingDetail: true, detailFailure: null });
    try {
      this.authorize(); const id = uuid(bookingId);
      const detail = await this.client.detail(id, this.detailAbort.signal);
      if (token !== this.detailToken) return;
      this.publish({ detail: parseStaffBookingDetail({ data: detail }, id, this.session!.branchId), loadingDetail: false });
    } catch (error) { if (token === this.detailToken) { const err = failure(error); this.publish({ ...this.deny(err), loadingDetail: false, detailFailure: err }); } }
  }
  back() { this.detailToken++; this.detailAbort?.abort(); this.publish({ selectedId: null, detail: null, loadingDetail: false, detailFailure: null }); }
  next() { if (!this.state.loadingList && this.state.page?.pagination.returned === this.state.limit) return this.loadList(this.state.offset + this.state.limit); }
  previous() { if (!this.state.loadingList && this.state.offset > 0) return this.loadList(Math.max(0, this.state.offset - this.state.limit)); }
}
