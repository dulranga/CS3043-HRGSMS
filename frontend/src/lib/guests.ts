// Client for the M1-S10/M1-S11 guest APIs used by the staff guest-profile UI
// (M1-S16). Search uses POST so full NICs stay out of URLs and logs. Every
// endpoint requires an authenticated FRONT_DESK session (`guest.manage` or
// `guest.link.issue`); other staff roles receive FORBIDDEN.

export interface GuestProfile {
  guestId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  maskedNic: string | null;
  hasNic: boolean;
  active: boolean;
  hasOnlineAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

export type GuestMatchField = "email" | "phone" | "nic";

export interface GuestCandidate {
  guestId: string;
  fullName: string;
  active: boolean;
  maskedNic: string | null;
  matchedOn: GuestMatchField[];
}

export interface GuestSearchInput {
  query?: string;
  nic?: string;
  includeInactive?: boolean;
  limit?: number;
}

export interface GuestSearchResult {
  guests: GuestProfile[];
  truncated: boolean;
}

export interface GuestCreateInput {
  fullName: string;
  email?: string;
  phone?: string;
  nic?: string;
  confirmNotDuplicate?: boolean;
}

// Only the provided keys are sent. `null` clears an optional field on the server.
export interface GuestUpdateInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  nic?: string | null;
  confirmNotDuplicate?: boolean;
}

export interface GuestLinkCode {
  guestId: string;
  linkCode: string;
  expiresAt: string;
}

export type GuestApiErrorCode =
  | "VALIDATION_ERROR"
  | "GUEST_NIC_EXISTS"
  | "POSSIBLE_DUPLICATE"
  | "GUEST_NOT_FOUND"
  | "GUEST_INACTIVE"
  | "GUEST_HAS_OPEN_BOOKINGS"
  | "GUEST_ALREADY_ACTIVE"
  | "GUEST_ALREADY_INACTIVE"
  | "GUEST_ALREADY_LINKED"
  | "LINK_CODE_USED"
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NETWORK_ERROR"
  | "INTERNAL_SERVER_ERROR";

export class GuestApiError extends Error {
  constructor(
    public readonly code: GuestApiErrorCode,
    message: string,
    options?: {
      fields?: Record<string, string>;
      candidates?: GuestCandidate[];
      openBookings?: number;
    },
  ) {
    super(message);
    this.name = "GuestApiError";
    this.fields = options?.fields;
    this.candidates = options?.candidates;
    this.openBookings = options?.openBookings;
  }

  public readonly fields?: Record<string, string>;
  public readonly candidates?: GuestCandidate[];
  public readonly openBookings?: number;
}

async function parseError(response: Response): Promise<GuestApiError> {
  let code: GuestApiErrorCode = "INTERNAL_SERVER_ERROR";
  let message = "Something went wrong. Please try again.";
  let fields: Record<string, string> | undefined;
  let candidates: GuestCandidate[] | undefined;
  let openBookings: number | undefined;
  try {
    const body = (await response.json()) as {
      error?: {
        code?: GuestApiErrorCode;
        message?: string;
        fields?: Record<string, string>;
        candidates?: GuestCandidate[];
        openBookings?: number;
      };
    };
    const error = body?.error;
    if (error?.code) code = error.code;
    if (error?.message) message = error.message;
    if (error?.fields && typeof error.fields === "object") fields = error.fields;
    if (Array.isArray(error?.candidates)) candidates = error.candidates;
    if (typeof error?.openBookings === "number") openBookings = error.openBookings;
  } catch {
    // Non-JSON bodies keep the generic message.
  }
  return new GuestApiError(code, message, { fields, candidates, openBookings });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new GuestApiError("NETWORK_ERROR", "The server could not be reached. Check your connection and try again.");
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

const JSON_HEADERS = { "content-type": "application/json" };

export async function searchGuests(input: GuestSearchInput): Promise<GuestSearchResult> {
  const payload = await request<{ data: GuestProfile[]; meta?: { truncated?: boolean } }>("/api/guests/search", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      query: input.query?.trim() || undefined,
      nic: input.nic?.trim() || undefined,
      includeInactive: input.includeInactive ?? false,
      limit: input.limit,
    }),
  });
  return { guests: payload.data, truncated: Boolean(payload.meta?.truncated) };
}

export async function getGuest(guestId: string): Promise<GuestProfile> {
  const payload = await request<{ data: GuestProfile }>(`/api/guests/${encodeURIComponent(guestId)}`);
  return payload.data;
}

export async function createGuest(input: GuestCreateInput): Promise<GuestProfile> {
  const payload = await request<{ data: GuestProfile }>("/api/guests", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      fullName: input.fullName,
      email: input.email?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      nic: input.nic?.trim() || undefined,
      confirmNotDuplicate: input.confirmNotDuplicate ?? undefined,
    }),
  });
  return payload.data;
}

export async function updateGuest(guestId: string, input: GuestUpdateInput): Promise<GuestProfile> {
  const body: Record<string, unknown> = {};
  if (input.fullName !== undefined) body.fullName = input.fullName;
  if (input.email !== undefined) body.email = input.email;
  if (input.phone !== undefined) body.phone = input.phone;
  if (input.nic !== undefined) body.nic = input.nic;
  if (input.confirmNotDuplicate !== undefined) body.confirmNotDuplicate = input.confirmNotDuplicate;
  const payload = await request<{ data: GuestProfile }>(`/api/guests/${encodeURIComponent(guestId)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return payload.data;
}

export async function setGuestActive(guestId: string, active: boolean, reason?: string): Promise<GuestProfile> {
  const payload = await request<{ data: GuestProfile }>(
    `/api/guests/${encodeURIComponent(guestId)}/${active ? "reactivate" : "deactivate"}`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: reason?.trim() || undefined }),
    },
  );
  return payload.data;
}

export async function issueGuestLinkCode(guestId: string): Promise<GuestLinkCode> {
  const payload = await request<{ data: GuestLinkCode }>(
    `/api/guests/${encodeURIComponent(guestId)}/link-code`,
    { method: "POST", headers: JSON_HEADERS },
  );
  return payload.data;
}
