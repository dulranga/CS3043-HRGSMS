// Client for the M1-S08 session API. Calls are same-origin (`/api` is proxied
// to the backend in development) so the HTTP-only session cookie is sent.

export type PrincipalKind = "STAFF" | "GUEST";

export interface SessionUser {
  userId: string;
  username: string;
  kind: PrincipalKind;
  role?: string;
  branchId?: string;
  guestId?: string;
}

export interface SessionInfo {
  user: SessionUser;
  idleTimeoutMinutes: number;
}

export type AuthErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DISABLED"
  | "TOO_MANY_ATTEMPTS"
  | "SESSION_EXPIRED"
  | "AUTHENTICATION_REQUIRED"
  | "NETWORK_ERROR"
  | "INTERNAL_SERVER_ERROR";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new AuthError("NETWORK_ERROR", "The server could not be reached. Check your connection and try again.");
  }
}

async function toAuthError(response: Response): Promise<AuthError> {
  let code: AuthErrorCode = "INTERNAL_SERVER_ERROR";
  let message = "Something went wrong. Please try again.";
  try {
    const body = await response.json();
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Non-JSON error bodies keep the generic message.
  }
  const retryAfter = Number(response.headers.get("retry-after"));
  return new AuthError(code, message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
}

export async function login(username: string, password: string): Promise<SessionInfo> {
  const response = await send("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw await toAuthError(response);
  return response.json();
}

export async function logout(): Promise<void> {
  const response = await send("/api/auth/logout", { method: "POST" });
  if (!response.ok && response.status !== 204) throw await toAuthError(response);
}

// Returns null when there is no session; an expired session reports its code.
export async function fetchSession(): Promise<{ session: SessionInfo | null; expired: boolean }> {
  const response = await send("/api/auth/session");
  if (response.status === 401) {
    const error = await toAuthError(response);
    return { session: null, expired: error.code === "SESSION_EXPIRED" };
  }
  if (!response.ok) throw await toAuthError(response);
  return { session: await response.json(), expired: false };
}

const ROLE_LABELS: Record<string, string> = {
  FRONT_DESK: "Front desk",
  SERVICE_STAFF: "Service staff",
  BRANCH_MANAGER: "Branch manager",
  CHAIN_MANAGER: "Chain manager",
  SYSTEM_ADMINISTRATOR: "System administrator",
  AUDITOR: "Auditor",
};

export function describePrincipal(user: SessionUser): string {
  if (user.kind === "GUEST") return "Guest";
  return (user.role && ROLE_LABELS[user.role]) ?? "Staff";
}

// Staff land on the operations dashboard; guests on the public home page.
export function homePathFor(user: SessionUser): string {
  return user.kind === "STAFF" ? "/dashboard" : "/";
}

// Only same-app relative paths are accepted, preventing open redirects.
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return undefined;
  if (value === "/login" || value.startsWith("/login?")) return undefined;
  return value;
}
