export type StaffRole = 'CHAIN_MANAGER' | 'BRANCH_MANAGER' | 'FRONT_DESK' | 'SERVICE_STAFF' | 'SYSTEM_ADMINISTRATOR' | 'AUDITOR';
// Supplied by Member 1's verified session adapter, never by form fields/storage.
export interface RoomAdminSession { role: StaffRole; branchId: string | null }
export const CONDITIONS = ['READY', 'CLEANING', 'OUT_OF_SERVICE'] as const;
export type Condition = typeof CONDITIONS[number];
export interface Amenity { amenityId: string; name: string; description: string | null; active: boolean }
export interface RoomType { roomTypeId: string; name: string; capacity: number; baseDailyRate: string; active: boolean; amenities: Amenity[] }
export interface AffectedLine { lineId: string; bookingId: string; bookingRef: string; status: string; stayStartDate: string; stayEndDate: string; guestCount: number }
export interface Room { roomId: string; roomNumber: string; branchId: string; active: boolean; operationalStatus: Condition; roomType: { roomTypeId: string; name: string; capacity: number; active: boolean }; activeAssignmentCount: number; blockCount: number; affectedLines?: AffectedLine[] }
export interface RoomBlock { blockId: string; roomId: string; startDate: string; endDate: string; reason: string }
export interface TypeDraft { name: string; capacity: string; baseDailyRate: string; amenityIds: string[] }
export interface AmenityDraft { name: string; description: string }
export interface RoomDraft { roomNumber: string; roomTypeId: string }
export interface BlockDraft { startDate: string; endDate: string; reason: string }
export type AdminAction = 'catalogue' | 'inventory' | 'condition';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function permissions(session: RoomAdminSession | null) {
  const scoped = !!session?.branchId && UUID.test(session.branchId);
  return {
    catalogue: session?.role === 'CHAIN_MANAGER',
    branchRead: scoped && ['BRANCH_MANAGER', 'FRONT_DESK', 'SERVICE_STAFF'].includes(session?.role ?? ''),
    inventory: scoped && session?.role === 'BRANCH_MANAGER',
    condition: scoped && ['BRANCH_MANAGER', 'SERVICE_STAFF'].includes(session?.role ?? ''),
  };
}
export class RoomAdminError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'VALIDATION_ERROR', readonly affectedLines: AffectedLine[] = []) { super(message); }
}
function text(value: string, field: string, maximum = 255): string {
  if (!value.trim() || value.trim().length > maximum) throw new RoomAdminError(`${field} must contain 1–${maximum} characters.`);
  return value.trim();
}
function uuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new RoomAdminError(`Choose a valid ${field}.`);
  return value;
}
export function typePayload(draft: TypeDraft) {
  if (!/^\d+$/.test(draft.capacity) || Number(draft.capacity) < 1 || Number(draft.capacity) > 32767) throw new RoomAdminError('Capacity must be a whole number from 1 to 32767.');
  const rate = draft.baseDailyRate.trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(rate)) throw new RoomAdminError('Rate must be a non-negative LKR amount with at most two decimals and ten integer digits.');
  draft.amenityIds.forEach(id => uuid(id, 'amenity'));
  return { name: text(draft.name, 'Name'), capacity: Number(draft.capacity), baseDailyRate: rate, amenityIds: [...new Set(draft.amenityIds)] };
}
export function amenityPayload(draft: AmenityDraft) {
  if (draft.description.trim().length > 255) throw new RoomAdminError('Description must not exceed 255 characters.');
  return { name: text(draft.name, 'Name'), description: draft.description.trim() || null };
}
export function roomPayload(draft: RoomDraft) { return { roomNumber: text(draft.roomNumber, 'Room number'), roomTypeId: uuid(draft.roomTypeId, 'room type') }; }
export function blockPayload(draft: BlockDraft) {
  for (const date of [draft.startDate, draft.endDate]) {
    const instant = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(instant.valueOf()) || instant.toISOString().slice(0, 10) !== date) throw new RoomAdminError('Choose valid calendar dates.');
  }
  if (draft.endDate <= draft.startDate) throw new RoomAdminError('Block end date must be later than its start date.');
  return { startDate: draft.startDate, endDate: draft.endDate, reason: text(draft.reason, 'Reason') };
}
export function conditionPayload(condition: Condition, reason: string) {
  if (!(CONDITIONS as readonly string[]).includes(condition)) throw new RoomAdminError('Choose READY, CLEANING or OUT_OF_SERVICE.');
  return { condition, reason: text(reason, 'Reason') };
}
function errorFromResponse(status: number, payload: unknown): RoomAdminError {
  const error = (payload as { error?: { code?: string; message?: string; affectedLines?: AffectedLine[] } } | null)?.error;
  const message = status === 401 ? 'Sign in to manage room inventory.'
    : status === 403 ? 'Your account does not have permission for this operation.'
    : status === 404 ? 'The record could not be found. Reload the list.'
    : status >= 500 ? 'The request could not be completed. Try again.'
    : error?.message ?? 'The request could not be completed.';
  return new RoomAdminError(message, status, error?.code ?? 'REQUEST_FAILED', Array.isArray(error?.affectedLines) ? error.affectedLines : []);
}
export function conflictAdvice(error: RoomAdminError): string | null {
  if (error.status !== 409) return null;
  if (error.code === 'ROOM_NUMBER_CONFLICT') return 'Use a different room number within this branch.';
  if (error.code === 'RETRY_TRANSACTION') return 'Reload current records, review your changes, and retry.';
  if (error.code === 'CATALOGUE_CONFLICT') return 'Retain a capacity that accommodates every active reservation. Resolve assigned reservations before deactivating a type.';
  return 'Review affected reservations with Front Desk. Resolve the conflicting assignments before retrying maintenance, deactivation or a room-type change.';
}
export type AdminFetch = typeof fetch;
export class RoomAdminApi {
  // Native browser fetch cannot be invoked with the API instance as its receiver.
  constructor(readonly session: RoomAdminSession | null, private readonly transport: AdminFetch = (...args) => fetch(...args), private readonly base = '/api') {}
  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!this.session) throw new RoomAdminError('Sign in to manage room inventory.', 401, 'AUTHENTICATION_REQUIRED');
    let response: Response;
    try { response = await this.transport(`${this.base}${path}`, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new RoomAdminError('Unable to reach room administration. Try again.', 0, 'NETWORK_ERROR'); }
    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw errorFromResponse(response.status, payload);
    if (!payload || typeof payload !== 'object') throw new RoomAdminError('The server returned an unreadable response.', 502, 'INVALID_RESPONSE');
    return payload.data as T;
  }
  private authorize(action: AdminAction, room?: Room) {
    if (!permissions(this.session)[action]) throw new RoomAdminError('Your account does not have permission for this operation.', 403, 'FORBIDDEN');
    if (room && room.branchId.toLowerCase() !== this.session?.branchId?.toLowerCase()) throw new RoomAdminError('This room belongs to another branch.', 403, 'FORBIDDEN');
  }
  types() { return this.request<RoomType[]>('/room-types?active=all'); }
  amenities() { return this.request<Amenity[]>('/amenities?active=all'); }
  rooms() { if (!permissions(this.session).branchRead) throw new RoomAdminError('Your account has no branch room access.', 403, 'FORBIDDEN'); return this.request<Room[]>('/rooms?active=all'); }
  detail(room: Room) { if (!permissions(this.session).branchRead || room.branchId.toLowerCase() !== this.session?.branchId?.toLowerCase()) throw new RoomAdminError('This room belongs to another branch.', 403, 'FORBIDDEN'); return this.request<Room>(`/rooms/${uuid(room.roomId, 'room')}`); }
  blocks(room: Room) { if (!permissions(this.session).branchRead || room.branchId.toLowerCase() !== this.session?.branchId?.toLowerCase()) throw new RoomAdminError('This room belongs to another branch.', 403, 'FORBIDDEN'); return this.request<RoomBlock[]>(`/rooms/${uuid(room.roomId, 'room')}/blocks`); }
  saveType(draft: TypeDraft, id?: string) { this.authorize('catalogue'); return this.request<RoomType>(`/room-types${id ? `/${uuid(id, 'room type')}` : ''}`, id ? 'PATCH' : 'POST', typePayload(draft)); }
  toggleType(type: RoomType) { this.authorize('catalogue'); return this.request<RoomType>(`/room-types/${uuid(type.roomTypeId, 'room type')}`, 'PATCH', { active: !type.active }); }
  saveAmenity(draft: AmenityDraft, id?: string) { this.authorize('catalogue'); return this.request<Amenity>(`/amenities${id ? `/${uuid(id, 'amenity')}` : ''}`, id ? 'PATCH' : 'POST', amenityPayload(draft)); }
  toggleAmenity(amenity: Amenity) { this.authorize('catalogue'); return this.request<Amenity>(`/amenities/${uuid(amenity.amenityId, 'amenity')}`, 'PATCH', { active: !amenity.active }); }
  saveRoom(draft: RoomDraft, room?: Room) { this.authorize('inventory', room); return this.request<Room>(`/rooms${room ? `/${uuid(room.roomId, 'room')}` : ''}`, room ? 'PATCH' : 'POST', roomPayload(draft)); }
  toggleRoom(room: Room) { this.authorize('inventory', room); return this.request<Room>(`/rooms/${uuid(room.roomId, 'room')}`, 'PATCH', { active: !room.active }); }
  saveBlock(room: Room, draft: BlockDraft, block?: RoomBlock) { this.authorize('inventory', room); if (block && block.roomId !== room.roomId) throw new RoomAdminError('Block does not belong to this room.'); return this.request<RoomBlock>(block ? `/room-blocks/${uuid(block.blockId, 'block')}` : `/rooms/${uuid(room.roomId, 'room')}/blocks`, block ? 'PATCH' : 'POST', blockPayload(draft)); }
  removeBlock(room: Room, block: RoomBlock) { this.authorize('inventory', room); if (block.roomId !== room.roomId) throw new RoomAdminError('Block does not belong to this room.'); return this.request<void>(`/room-blocks/${uuid(block.blockId, 'block')}`, 'DELETE'); }
  async changeCondition(room: Room, condition: Condition, reason: string) {
    this.authorize('condition', room);
    try { await this.request<void>(`/rooms/${uuid(room.roomId, 'room')}/condition`, 'PATCH', conditionPayload(condition, reason)); }
    catch (error) {
      // M3's condition conflict does not carry reservation details. Refresh the
      // own-branch detail so newly assigned lines can be explained as well.
      if (error instanceof RoomAdminError && error.status === 409) {
        const latest = await this.detail(room).catch(() => null);
        throw new RoomAdminError(error.message, error.status, error.code, latest?.affectedLines ?? error.affectedLines);
      }
      throw error;
    }
  }
}
