export interface SearchDraft {
  branchId: string;
  checkIn: string;
  checkOut: string;
  guestCount: string;
  roomTypeId: string;
  immediateCheckIn: boolean;
}
export interface AvailabilitySearch extends Omit<SearchDraft, 'guestCount' | 'roomTypeId'> {
  guestCount: number;
  roomTypeId: string | null;
}
export interface AvailabilityOptions {
  branches: { branchId: string; name: string; city: string }[];
  roomTypes: { roomTypeId: string; name: string }[];
}
export interface AvailableRoom {
  roomId: string;
  roomNumber: string;
  operationalStatus: 'READY' | 'CLEANING';
  branchId: string;
  roomType: {
    roomTypeId: string; name: string; capacity: number; baseDailyRate: string;
    amenities: { amenityId: string; name: string; description: string | null }[];
  };
}
export type DraftErrors = Partial<Record<keyof SearchDraft, string>>;
export class AvailabilityError extends Error {
  constructor(message: string, readonly code = 'REQUEST_FAILED', readonly status = 0, readonly fields: DraftErrors = {}) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const DAY_MS = 86400000;
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function validateSearch(draft: SearchDraft, options?: AvailabilityOptions): AvailabilitySearch {
  const fields: DraftErrors = {};
  if (!UUID.test(draft.branchId) || (options && !options.branches.some(b => b.branchId === draft.branchId))) fields.branchId = 'Choose an active SkyNest branch.';
  if (!validDate(draft.checkIn)) fields.checkIn = 'Choose a valid arrival date.';
  if (!validDate(draft.checkOut)) fields.checkOut = 'Choose a valid departure date.';
  else if (validDate(draft.checkIn) && draft.checkOut <= draft.checkIn) fields.checkOut = 'Departure must be after arrival.';
  if (!/^[1-9]\d*$/.test(draft.guestCount) || Number(draft.guestCount) > 32767) fields.guestCount = 'Enter 1–32767 guests for this room.';
  if (draft.roomTypeId && (!UUID.test(draft.roomTypeId) || (options && !options.roomTypes.some(t => t.roomTypeId === draft.roomTypeId)))) fields.roomTypeId = 'Choose an active room type or Any type.';
  if (Object.keys(fields).length) throw new AvailabilityError('Correct the search fields below.', 'VALIDATION_ERROR', 400, fields);
  return { ...draft, guestCount: Number(draft.guestCount), roomTypeId: draft.roomTypeId || null };
}
export function nights(search: Pick<AvailabilitySearch, 'checkIn' | 'checkOut'>): number {
  return (Date.parse(`${search.checkOut}T00:00:00Z`) - Date.parse(`${search.checkIn}T00:00:00Z`)) / DAY_MS;
}
export function overlaps(a: AvailabilitySearch, b: AvailabilitySearch): boolean {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}
export interface SelectedRoomLine {
  selectionId: string;
  room: AvailableRoom;
  search: AvailabilitySearch;
  check: 'available' | 'unavailable' | 'changed' | 'unverified';
  issue: string | null;
}
export function selectionIssue(room: AvailableRoom, search: AvailabilitySearch, selected: SelectedRoomLine[]): string | null {
  if (selected.some(line => line.room.branchId !== search.branchId)) return 'All rooms in this selection must belong to one branch.';
  if (room.branchId !== search.branchId) return 'This room belongs to another branch.';
  if (room.roomType.capacity < search.guestCount) return 'This room cannot accommodate the requested guests.';
  if (search.immediateCheckIn && room.operationalStatus !== 'READY') return 'Immediate check-in requires a physically READY room.';
  if (selected.some(line => line.room.roomId === room.roomId && overlaps(line.search, search))) return 'This room is already selected for overlapping dates.';
  return null;
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AvailabilityError('The server returned unreadable availability data.', 'INVALID_RESPONSE', 502);
  return value as Record<string, any>;
}
function requireValue(ok: boolean): void {
  if (!ok) throw new AvailabilityError('The server returned inconsistent availability data. Search again.', 'INVALID_RESPONSE', 502);
}
export function parseOptions(payload: unknown): AvailabilityOptions {
  const data = object(object(payload).data);
  requireValue(Array.isArray(data.branches) && Array.isArray(data.roomTypes));
  const branches = data.branches.map((value: unknown) => {
    const b = object(value);
    requireValue(typeof b.branchId === 'string' && UUID.test(b.branchId) && typeof b.name === 'string' && typeof b.city === 'string');
    return { branchId: b.branchId as string, name: b.name as string, city: b.city as string };
  });
  const roomTypes = data.roomTypes.map((value: unknown) => {
    const t = object(value);
    requireValue(typeof t.roomTypeId === 'string' && UUID.test(t.roomTypeId) && typeof t.name === 'string');
    return { roomTypeId: t.roomTypeId as string, name: t.name as string };
  });
  return { branches, roomTypes };
}
export function parseRooms(payload: unknown, search: AvailabilitySearch): AvailableRoom[] {
  const envelope = object(payload);
  const meta = object(envelope.meta);
  requireValue(Array.isArray(envelope.data) && meta.resultCount === envelope.data.length);
  for (const key of ['branchId', 'checkIn', 'checkOut', 'guestCount', 'roomTypeId', 'immediateCheckIn'] as const) requireValue(meta[key] === search[key]);
  const rooms = envelope.data.map((value: unknown) => {
    const r = object(value), t = object(r.roomType);
    requireValue(typeof r.roomId === 'string' && UUID.test(r.roomId) && typeof r.roomNumber === 'string' && r.branchId === search.branchId);
    requireValue(r.operationalStatus === 'READY' || (!search.immediateCheckIn && r.operationalStatus === 'CLEANING'));
    requireValue(typeof t.roomTypeId === 'string' && UUID.test(t.roomTypeId) && (!search.roomTypeId || t.roomTypeId === search.roomTypeId));
    requireValue(typeof t.name === 'string' && Number.isInteger(t.capacity) && t.capacity >= search.guestCount && t.capacity <= 32767 && typeof t.baseDailyRate === 'string' && RATE.test(t.baseDailyRate) && Array.isArray(t.amenities));
    const amenities = t.amenities.map((value: unknown) => {
      const a = object(value);
      requireValue(typeof a.amenityId === 'string' && UUID.test(a.amenityId) && typeof a.name === 'string' && (a.description === null || typeof a.description === 'string'));
      return { amenityId: a.amenityId as string, name: a.name as string, description: a.description as string | null };
    });
    return { roomId: r.roomId, roomNumber: r.roomNumber, branchId: r.branchId, operationalStatus: r.operationalStatus, roomType: { roomTypeId: t.roomTypeId, name: t.name, capacity: t.capacity, baseDailyRate: t.baseDailyRate, amenities } } as AvailableRoom;
  });
  requireValue(new Set(rooms.map((r: AvailableRoom) => r.roomId)).size === rooms.length);
  return rooms;
}
export interface AvailabilityClient {
  options(signal?: AbortSignal): Promise<AvailabilityOptions>;
  search(search: AvailabilitySearch, signal?: AbortSignal): Promise<AvailableRoom[]>;
}
export class AvailabilityApi implements AvailabilityClient {
  // Keep the browser's fetch receiver intact; an injected transport is useful
  // for tests, while native fetch must not be called as a model-owned method.
  constructor(private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try { response = await this.transport(path, { method: 'GET', credentials: 'same-origin', signal }); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new AvailabilityError('Unable to reach availability search. Try again.', 'NETWORK_ERROR');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload?.error?.code ?? 'REQUEST_FAILED';
      const message = response.status === 409 ? 'Availability changed. Search again before selecting this room.'
        : response.status === 400 ? payload?.error?.message ?? 'Check the search dates and guest count.'
        : 'Availability could not be loaded. Try again.';
      throw new AvailabilityError(message, code, response.status);
    }
    return payload;
  }
  async options(signal?: AbortSignal) { return parseOptions(await this.get('/api/availability/options', signal)); }
  async search(search: AvailabilitySearch, signal?: AbortSignal) {
    const query = new URLSearchParams({ branchId: search.branchId, checkIn: search.checkIn, checkOut: search.checkOut, guestCount: String(search.guestCount), immediateCheckIn: String(search.immediateCheckIn) });
    if (search.roomTypeId) query.set('roomTypeId', search.roomTypeId);
    return parseRooms(await this.get(`/api/availability?${query}`, signal), search);
  }
}

export interface AvailabilityState {
  options: AvailabilityOptions | null;
  draft: SearchDraft;
  loadingOptions: boolean;
  searching: boolean;
  rechecking: boolean;
  results: { search: AvailabilitySearch; rooms: AvailableRoom[] } | null;
  selected: SelectedRoomLine[];
  failure: AvailabilityError | null;
  notice: string;
}
export const initialAvailabilityState = (): AvailabilityState => ({
  options: null, draft: { branchId: '', checkIn: '', checkOut: '', guestCount: '1', roomTypeId: '', immediateCheckIn: false },
  loadingOptions: false, searching: false, rechecking: false, results: null, selected: [], failure: null, notice: '',
});
function failure(error: unknown) { return error instanceof AvailabilityError ? error : new AvailabilityError('Availability could not be loaded. Try again.'); }

// The model keeps search snapshots separate from editable criteria and selected
// lines. Late responses cannot attach yesterday's criteria to today's results.
export class AvailabilityModel {
  private state = initialAvailabilityState();
  private listeners = new Set<() => void>();
  private searchToken = 0;
  private optionsToken = 0;
  private sequence = 0;
  private searchAbort?: AbortController;
  private optionsAbort?: AbortController;
  private checkAbort?: AbortController;
  constructor(private readonly client: AvailabilityClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<AvailabilityState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  cancelPending = () => {
    this.searchToken++; this.optionsToken++;
    this.searchAbort?.abort(); this.optionsAbort?.abort(); this.checkAbort?.abort();
  };
  async loadOptions() {
    const token = ++this.optionsToken;
    this.optionsAbort?.abort(); this.optionsAbort = new AbortController();
    this.publish({ loadingOptions: true, failure: null });
    try {
      const options = await this.client.options(this.optionsAbort.signal);
      if (token !== this.optionsToken) return;
      this.publish({ options, loadingOptions: false });
    } catch (error) { if (token === this.optionsToken) this.publish({ loadingOptions: false, failure: failure(error) }); }
  }
  setDraft(patch: Partial<SearchDraft>) {
    if (this.state.rechecking) return;
    if (patch.branchId !== undefined && patch.branchId !== this.state.draft.branchId && this.state.selected.length) {
      this.publish({ failure: new AvailabilityError('Remove selected rooms before choosing a different branch.', 'SELECTION_CONFLICT', 409) });
      return;
    }
    this.searchAbort?.abort(); this.searchToken++;
    this.publish({ draft: { ...this.state.draft, ...patch }, results: null, searching: false, failure: null, notice: '' });
  }
  async search() {
    if (!this.state.options || this.state.rechecking) return;
    let search: AvailabilitySearch;
    try { search = validateSearch(this.state.draft, this.state.options); }
    catch (error) { this.publish({ failure: failure(error), results: null }); return; }
    const token = ++this.searchToken;
    this.searchAbort?.abort(); this.searchAbort = new AbortController();
    this.publish({ searching: true, results: null, failure: null, notice: '' });
    try {
      const rooms = await this.client.search(search, this.searchAbort.signal);
      if (token !== this.searchToken) return;
      this.publish({ searching: false, results: { search, rooms } });
    } catch (error) { if (token === this.searchToken) this.publish({ searching: false, failure: failure(error) }); }
  }
  add(roomId: string) {
    if (this.state.rechecking || !this.state.results) return;
    const { rooms, search } = this.state.results;
    const room = rooms.find(room => room.roomId === roomId);
    if (!room) return;
    const issue = selectionIssue(room, search, this.state.selected);
    if (issue) { this.publish({ failure: new AvailabilityError(issue, 'SELECTION_CONFLICT', 409) }); return; }
    const line: SelectedRoomLine = { selectionId: `selection-${++this.sequence}`, room, search: { ...search }, check: 'available', issue: null };
    this.publish({ selected: [...this.state.selected, line], failure: null, notice: `Room ${room.roomNumber} added to your selection.` });
  }
  remove(selectionId: string) {
    if (this.state.rechecking) return;
    this.publish({ selected: this.state.selected.filter(line => line.selectionId !== selectionId), failure: null, notice: 'Room removed from this unconfirmed selection.' });
  }
  clear() { if (!this.state.rechecking) this.publish({ selected: [], failure: null, notice: 'Selection cleared.' }); }
  async recheck() {
    if (!this.state.selected.length || this.state.rechecking) return;
    this.checkAbort = new AbortController();
    const signal = this.checkAbort.signal;
    this.publish({ rechecking: true, failure: null, notice: '' });
    const selected = await Promise.all(this.state.selected.map(async line => {
      try {
        const rooms = await this.client.search(line.search, signal);
        const latest = rooms.find(room => room.roomId === line.room.roomId);
        if (!latest) return { ...line, check: 'unavailable' as const, issue: 'This room is no longer available for these dates and guests. Remove it and search again.' };
        if (latest.roomType.roomTypeId !== line.room.roomType.roomTypeId || latest.roomType.baseDailyRate !== line.room.roomType.baseDailyRate || latest.roomType.capacity !== line.room.roomType.capacity) return { ...line, check: 'changed' as const, issue: 'The room type, capacity or rate changed. Remove this selection and search again.' };
        return { ...line, room: latest, check: 'available' as const, issue: null };
      } catch (error) { return { ...line, check: 'unverified' as const, issue: failure(error).message }; }
    }));
    if (signal.aborted) return;
    this.publish({ selected, rechecking: false, notice: selected.every(line => line.check === 'available') ? 'Selected rooms are available when checked. They remain unreserved until confirmation.' : 'Some selections need attention. Remove affected rooms and search again.' });
  }
}
