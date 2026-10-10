// Public home-page data: live counts and bookable room types from active
// inventory. Served by GET /api/availability/showcase (no authentication).

export interface ShowcaseBranch {
  branchId: string;
  name: string;
  city: string;
}

export interface ShowcaseRoomType {
  roomTypeId: string;
  name: string;
  capacity: number;
  baseDailyRate: string;
  roomCount: number;
  amenities: string[];
  branches: ShowcaseBranch[];
}

export interface Showcase {
  stats: { branchCount: number; cityCount: number; roomCount: number; roomTypeCount: number };
  roomTypes: ShowcaseRoomType[];
}

export class ShowcaseError extends Error {}

function fail(): never {
  throw new ShowcaseError('The server returned unreadable hotel data.');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) fail();
  return value as number;
}

function text(value: unknown): string {
  if (typeof value !== 'string') fail();
  return value;
}

export function parseShowcase(payload: unknown): Showcase {
  const data = record(record(payload).data);
  const stats = record(data.stats);
  if (!Array.isArray(data.roomTypes)) fail();
  return {
    stats: {
      branchCount: count(stats.branchCount),
      cityCount: count(stats.cityCount),
      roomCount: count(stats.roomCount),
      roomTypeCount: count(stats.roomTypeCount),
    },
    roomTypes: data.roomTypes.map((value) => {
      const type = record(value);
      if (!Array.isArray(type.amenities) || !Array.isArray(type.branches)) fail();
      return {
        roomTypeId: text(type.roomTypeId),
        name: text(type.name),
        capacity: count(type.capacity),
        baseDailyRate: text(type.baseDailyRate),
        roomCount: count(type.roomCount),
        amenities: type.amenities.map(text),
        branches: type.branches.map((entry) => {
          const branch = record(entry);
          return { branchId: text(branch.branchId), name: text(branch.name), city: text(branch.city) };
        }),
      };
    }),
  };
}

export async function fetchShowcase(signal?: AbortSignal): Promise<Showcase> {
  let response: Response;
  try {
    response = await fetch('/api/availability/showcase', { credentials: 'same-origin', signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ShowcaseError('Unable to reach SkyNest. Try again.');
  }
  if (!response.ok) throw new ShowcaseError('Hotel information could not be loaded. Try again.');
  return parseShowcase(await response.json().catch(() => null));
}
