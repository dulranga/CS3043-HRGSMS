// Client for the M1-S10 online guest registration/linking API
// (POST /api/auth/register). The endpoint is public: a new guest creates their
// own guest profile, or an existing guest links it using a link code that the
// front desk issues after checking their identity. Registration does not sign
// the user in; the caller sends them to /login afterwards.

export type RegistrationMode = "NEW" | "LINK";

export interface NewGuestRegistration {
  mode: "NEW";
  fullName: string;
  email?: string;
  phone?: string;
  nic?: string;
  username: string;
  password: string;
}

export interface LinkExistingRegistration {
  mode: "LINK";
  linkCode: string;
  username: string;
  password: string;
}

export type RegistrationInput = NewGuestRegistration | LinkExistingRegistration;

export interface RegistrationResult {
  userId: string;
  username: string;
  guestId: string;
  linkedExistingProfile: boolean;
}

export type RegistrationErrorCode =
  | "VALIDATION_ERROR"
  | "USERNAME_TAKEN"
  | "PROFILE_EXISTS"
  | "INVALID_LINK_CODE"
  | "LINK_CODE_USED"
  | "TOO_MANY_ATTEMPTS"
  | "NETWORK_ERROR"
  | "INTERNAL_SERVER_ERROR";

export class RegistrationError extends Error {
  constructor(
    public readonly code: RegistrationErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

// Mirrors the server-side policy in backend/src/auth.ts. The server is still
// authoritative; this only gives immediate inline feedback.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{3,64}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validatePassword(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (byteLength(password) > PASSWORD_MAX_BYTES) {
    return `Use at most ${PASSWORD_MAX_BYTES} bytes.`;
  }
  return undefined;
}

async function parseError(response: Response): Promise<RegistrationError> {
  let code: RegistrationErrorCode = "INTERNAL_SERVER_ERROR";
  let message = "Something went wrong. Please try again.";
  let fields: Record<string, string> | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: RegistrationErrorCode; message?: string; fields?: Record<string, string> };
    };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.fields && typeof body.error.fields === "object") fields = body.error.fields;
  } catch {
    // Non-JSON error bodies keep the generic message.
  }
  const retryAfter = Number(response.headers.get("retry-after"));
  return new RegistrationError(
    code,
    message,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    fields,
  );
}

export async function registerGuest(input: RegistrationInput): Promise<RegistrationResult> {
  const body =
    input.mode === "NEW"
      ? {
          username: input.username,
          password: input.password,
          fullName: input.fullName,
          // Blank optional fields are omitted so the server stores them as null.
          email: input.email?.trim() || undefined,
          phone: input.phone?.trim() || undefined,
          nic: input.nic?.trim() || undefined,
        }
      : {
          username: input.username,
          password: input.password,
          linkCode: input.linkCode.trim(),
        };

  let response: Response;
  try {
    response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    throw new RegistrationError(
      "NETWORK_ERROR",
      "The server could not be reached. Check your connection and try again.",
    );
  }

  if (!response.ok) throw await parseError(response);
  const payload = (await response.json()) as { data: RegistrationResult };
  return payload.data;
}
