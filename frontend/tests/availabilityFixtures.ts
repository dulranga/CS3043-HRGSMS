import type { AvailabilityOptions, AvailableRoom, AvailabilitySearch, SearchDraft } from '../src/lib/availability.ts';
export const id = (suffix: number) => `0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d${String(suffix).padStart(2, '0')}`;
export const options: AvailabilityOptions = {
  branches: [{ branchId: id(1), name: 'SkyNest Colombo', city: 'Colombo' }, { branchId: id(2), name: 'SkyNest Kandy', city: 'Kandy' }],
  roomTypes: [{ roomTypeId: id(3), name: 'Single' }, { roomTypeId: id(4), name: 'Double' }],
};
export const draft: SearchDraft = { branchId: id(1), checkIn: '2027-06-01', checkOut: '2027-06-04', guestCount: '1', immediateCheckIn: false, roomTypeId: '' };
export const search: AvailabilitySearch = { ...draft, guestCount: 1, roomTypeId: null };
export const single: AvailableRoom = {
  roomId: id(5), roomNumber: '101', branchId: id(1), operationalStatus: 'READY',
  roomType: { roomTypeId: id(3), name: 'Single', capacity: 1, baseDailyRate: '10000.50', amenities: [{ amenityId: id(6), name: 'Wi-Fi', description: 'Included' }] },
};
export const double: AvailableRoom = {
  ...single, roomId: id(7), roomNumber: '102', operationalStatus: 'CLEANING',
  roomType: { ...single.roomType, roomTypeId: id(4), name: 'Double', capacity: 2, baseDailyRate: '18000.00' },
};
export const envelope = (rooms: AvailableRoom[], criteria = search) => ({ data: rooms, meta: { ...criteria, resultCount: rooms.length } });
