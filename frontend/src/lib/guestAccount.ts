// Client for the M1-S12 online guest own-profile API. Routes live under
// /api/guest/profile (singular) and are guest-only: the server derives the
// guest from the authenticated session, so there is no guest ID in the request.

export interface GuestAccountProfile {
  guestId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  maskedNic: string | null;
  hasNic: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// Only provided keys are sent; `null` clears an optional field. At least one of
// fullName/email/phone/nic must be present or the server returns INVALID_INPUT.
export interface GuestAccountUpdateInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  nic?: string | null;
  confirmNotDuplicate?: boolean;
}

export type GuestAccountErrorCode =
  | "INVALID_INPUT"
  | "GUEST_NIC_EXISTS"
  | "POSSIBLE_DUPLICATE"
  | "GUEST_NOT_FOUND"
  | "GUEST_INACTIVE"
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NETWORK_ERROR"
  | "INTERNAL_SERVER_ERROR";

export class GuestAccountError extends Error {
  constructor(
    public readonly code: GuestAccountErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "GuestAccountError";
  }
}

async function parseError(response: Response): Promise<GuestAccountError> {
  let code: GuestAccountErrorCode = "INTERNAL_SERVER_ERROR";
  let message = "Something went wrong. Please try again.";
  let fields: Record<string, string> | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: GuestAccountErrorCode; message?: string; fields?: Record<string, string> };
    };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.fields && typeof body.error.fields === "object") fields = body.error.fields;
  } catch {
    // Non-JSON bodies keep the generic message.
  }
  return new GuestAccountError(code, message, fields);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new GuestAccountError(
      "NETWORK_ERROR",
      "The server could not be reached. Check your connection and try again.",
    );
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function getOwnProfile(): Promise<GuestAccountProfile> {
  const payload = await request<{ data: GuestAccountProfile }>("/api/guest/profile");
  return payload.data;
}

export async function updateOwnProfile(input: GuestAccountUpdateInput): Promise<GuestAccountProfile> {
  const body: Record<string, unknown> = {};
  if (input.fullName !== undefined) body.fullName = input.fullName;
  if (input.email !== undefined) body.email = input.email;
  if (input.phone !== undefined) body.phone = input.phone;
  if (input.nic !== undefined) body.nic = input.nic;
  if (input.confirmNotDuplicate !== undefined) body.confirmNotDuplicate = input.confirmNotDuplicate;
  const payload = await request<{ data: GuestAccountProfile }>("/api/guest/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return payload.data;
}
