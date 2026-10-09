import type { Amenity, AffectedLine, Room, RoomBlock, RoomType } from '../src/lib/roomAdministration.ts';
export const branchId = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01';
export const otherBranchId = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d02';
export const amenity: Amenity = { amenityId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d03', name: 'Ocean view', description: 'Sea-facing room', active: true };
export const roomType: RoomType = { roomTypeId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d04', name: 'Deluxe', capacity: 3, baseDailyRate: '12500.50', active: true, amenities: [amenity] };
export const line: AffectedLine = { lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d05', bookingId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d06', bookingRef: 'SKY-EXAMPLE', status: 'BOOKED', stayStartDate: '2027-12-01', stayEndDate: '2027-12-04', guestCount: 3 };
export const room: Room = { roomId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d07', roomNumber: '101', branchId, active: true, operationalStatus: 'READY', roomType, activeAssignmentCount: 1, blockCount: 1, affectedLines: [line] };
export const block: RoomBlock = { blockId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d08', roomId: room.roomId, startDate: '2027-12-05', endDate: '2027-12-08', reason: 'Bathroom maintenance' };
export const initialData = { types: [roomType], amenities: [amenity], rooms: [room, { ...room, roomId: otherBranchId, branchId: otherBranchId, roomNumber: 'SECRET-OTHER-BRANCH' }] };
