import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthPrincipal } from './auth';

// M1-S09 server-side staff authorization (SRS §6.1.4 staff permission mapping,
// FR-003/004/081, AT-24). `ROLE_GRANTS` below is the single source of truth:
// every seeded staff role maps to the operations it may perform together with
// the scope of each grant (BRANCH = the officer's assigned branch only,
// CHAIN = chain-wide). There is no permission table in the database, and no
// other module may hard-code a role→operation list; the shared decision
// function `authorizeStaff` is used by the edge middleware and by feature
// services alike. Role and branch come from req.user, which auth.authenticate
// re-reads from officer/role on every request, never from request headers or
// bodies. Guest sessions never match a staff grant; guest ownership checks stay
// with the owning feature (FR-081/082). The mapping follows the SRS working
// proposal pending TBD-15 sign-off.

export const STAFF_ROLES = [
  'FRONT_DESK',
  'SERVICE_STAFF',
  'BRANCH_MANAGER',
  'CHAIN_MANAGER',
  'SYSTEM_ADMINISTRATOR',
  'AUDITOR',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

// BRANCH: the operation is limited to the officer's assigned branch.
// CHAIN: the operation is chain-wide (shared catalogues, cross-branch reads,
// branch records, accounts and configuration).
export type PermissionScope = 'BRANCH' | 'CHAIN';

// Every staff-performable operation. Kept as a self-describing registry so the
// role grants below are checked against a closed set at compile time.
export const OPERATIONS = {
  // Chain-wide room-type/amenity/service catalogues and prices (AT-24).
  'catalogue.write': 'Create, price or deactivate chain-wide catalogues',
  // Physical rooms and dated blocks.
  'room.read': 'Read physical rooms and dated blocks',
  'room.write': 'Create or edit own-branch physical rooms and blocks',
  // Direct physical-condition changes (checkout's internal CLEANING transition
  // is part of checkout.perform, not this permission).
  'room.condition.write': 'Change a physical room condition',
  'service_usage.record': 'Record own-branch service usage',
  'service_usage.void': 'Void a recorded service-usage row',
  // Reservations, check-in, checkout, cancellation, no-show and payments.
  'booking.manage': 'Create, read and modify own-branch reservations',
  'booking.check_in': 'Check in a booked room line',
  'booking.cancel': 'Cancel a room line or whole booking',
  'booking.no_show': 'Mark a booked room line or booking as no-show',
  'checkout.perform': 'Check out a checked-in room line',
  'payment.record': 'Record a payment or refund',
  'invoice.read.branch': 'Read invoices and payments for the own branch',
  'invoice.read.chain': 'Read invoices and payments chain-wide',
  'discount.apply': 'Apply a booking discount',
  // Guest profiles are chain-wide (no branch FK): FRONT_DESK issues the
  // single-guest link code after checking identity (M1-S10, FR-083).
  'guest.link.issue': 'Issue a guest account link code',
  'guest.manage': 'Search, create, update and deactivate guest profiles',
  // Reports and audit.
  'report.read.branch': 'Read own-branch reports and exports',
  'report.read.chain': 'Read chain-wide reports and exports',
  'audit.read': 'Read the chain-wide audit log',
  // Chain-wide billing policy.
  'billing_policy.publish': 'Publish a chain-wide billing policy version',
  // Branch records, staff accounts and non-financial configuration.
  'branch.read': 'Read branch records',
  'branch.write': 'Create, edit or deactivate branch records',
  'account.read': 'Read staff accounts',
  'account.write': 'Create, edit or disable staff accounts',
  'config.read': 'Read non-financial system configuration',
  'config.write': 'Update non-financial system configuration',
} as const;

export type Operation = keyof typeof OPERATIONS;

// Backwards-compatible alias: callers historically called the operation a
// "permission".
export type Permission = Operation;

// The single version-controlled matrix, keyed by role so a reviewer can look at
// one role and see its exact grant set and scope for every operation.
export const ROLE_GRANTS: Record<StaffRole, Partial<Record<Operation, PermissionScope>>> = {
  FRONT_DESK: {
    'room.read': 'BRANCH',
    'service_usage.record': 'BRANCH',
    'booking.manage': 'BRANCH',
    'booking.check_in': 'BRANCH',
    'booking.cancel': 'BRANCH',
    'booking.no_show': 'BRANCH',
    'checkout.perform': 'BRANCH',
    'payment.record': 'BRANCH',
    'invoice.read.branch': 'BRANCH',
    'guest.link.issue': 'CHAIN',
    'guest.manage': 'CHAIN',
    'branch.read': 'CHAIN',
  },
  SERVICE_STAFF: {
    'room.read': 'BRANCH',
    'room.condition.write': 'BRANCH',
    'service_usage.record': 'BRANCH',
    'invoice.read.branch': 'BRANCH',
    'branch.read': 'CHAIN',
  },
  BRANCH_MANAGER: {
    'room.read': 'BRANCH',
    'room.write': 'BRANCH',
    'room.condition.write': 'BRANCH',
    'booking.check_in': 'BRANCH',
    'booking.cancel': 'BRANCH',
    'booking.no_show': 'BRANCH',
    'checkout.perform': 'BRANCH',
    'service_usage.void': 'BRANCH',
    'invoice.read.branch': 'BRANCH',
    'discount.apply': 'BRANCH',
    'report.read.branch': 'BRANCH',
    'branch.read': 'CHAIN',
  },
  CHAIN_MANAGER: {
    'catalogue.write': 'CHAIN',
    'booking.check_in': 'CHAIN',
    'booking.cancel': 'CHAIN',
    'booking.no_show': 'CHAIN',
    'checkout.perform': 'CHAIN',
    'service_usage.void': 'CHAIN',
    'invoice.read.chain': 'CHAIN',
    'report.read.chain': 'CHAIN',
    'billing_policy.publish': 'CHAIN',
    'branch.read': 'CHAIN',
  },
  SYSTEM_ADMINISTRATOR: {
    'booking.check_in': 'CHAIN',
    'booking.cancel': 'CHAIN',
    'booking.no_show': 'CHAIN',
    'checkout.perform': 'CHAIN',
    'service_usage.void': 'CHAIN',
    'audit.read': 'CHAIN',
    'branch.read': 'CHAIN',
    'branch.write': 'CHAIN',
    'account.read': 'CHAIN',
    'account.write': 'CHAIN',
    'config.read': 'CHAIN',
    'config.write': 'CHAIN',
  },
  AUDITOR: {
    'invoice.read.chain': 'CHAIN',
    'report.read.chain': 'CHAIN',
    'audit.read': 'CHAIN',
    'branch.read': 'CHAIN',
    'account.read': 'CHAIN',
    'config.read': 'CHAIN',
  },
};

// Derived, read-only view (operation → roles + a representative scope). Kept
// for callers and tests that iterate operations; `ROLE_GRANTS` remains the
// source of truth.
export const PERMISSIONS: Record<Operation, { readonly roles: readonly StaffRole[]; readonly scope: PermissionScope }> =
  (Object.keys(OPERATIONS) as Operation[]).reduce(
    (acc, operation) => {
      const roles = STAFF_ROLES.filter((role) => ROLE_GRANTS[role][operation] !== undefined);
      const scope: PermissionScope = roles.some((role) => ROLE_GRANTS[role][operation] === 'CHAIN') ? 'CHAIN' : 'BRANCH';
      acc[operation] = { roles, scope };
      return acc;
    },
    {} as Record<Operation, { roles: StaffRole[]; scope: PermissionScope }>,
  );

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export function scopeForRole(role: unknown, operation: Operation): PermissionScope | undefined {
  return isStaffRole(role) ? ROLE_GRANTS[role][operation] : undefined;
}

export function roleHasPermission(role: unknown, permission: Operation): boolean {
  return scopeForRole(role, permission) !== undefined;
}

export type AuthorizationDecision =
  | { allowed: true; permission: Operation; scope: PermissionScope; branchId?: string }
  | { allowed: false; status: 401 | 403; code: 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'CROSS_BRANCH_FORBIDDEN' };

// Pure decision used by the middleware and available to services. A
// BRANCH-scoped grant also requires the target branch (when one is known) to
// equal the officer's assigned branch. When several operations are accepted,
// a chain-wide grant wins so a cross-branch reader is not branch-limited.
export function authorizeStaff(
  principal: AuthPrincipal | undefined,
  permissions: Operation | readonly Operation[],
  targetBranchId?: string,
): AuthorizationDecision {
  if (!principal) return { allowed: false, status: 401, code: 'AUTHENTICATION_REQUIRED' };
  if (principal.kind !== 'STAFF' || !principal.branchId || !isStaffRole(principal.role)) {
    return { allowed: false, status: 403, code: 'FORBIDDEN' };
  }
  const requested = typeof permissions === 'string' ? [permissions] : permissions;
  const granted = requested.filter((operation) => ROLE_GRANTS[principal.role as StaffRole][operation] !== undefined);
  if (granted.length === 0) return { allowed: false, status: 403, code: 'FORBIDDEN' };
  const chain = granted.find((operation) => ROLE_GRANTS[principal.role as StaffRole][operation] === 'CHAIN');
  if (chain) return { allowed: true, permission: chain, scope: 'CHAIN' };
  const permission = granted[0];
  if (targetBranchId !== undefined && targetBranchId !== principal.branchId) {
    return { allowed: false, status: 403, code: 'CROSS_BRANCH_FORBIDDEN' };
  }
  return { allowed: true, permission, scope: 'BRANCH', branchId: principal.branchId };
}

const MESSAGES = {
  AUTHENTICATION_REQUIRED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  CROSS_BRANCH_FORBIDDEN: 'This action is limited to your assigned branch.',
} as const;

function deny(res: Response, decision: Extract<AuthorizationDecision, { allowed: false }>) {
  res.status(decision.status).json({ error: { code: decision.code, message: MESSAGES[decision.code] } });
}

export interface StaffRequirementOptions {
  // Optional branch targeted by the request (for example a route or query
  // parameter); a BRANCH-scoped grant must match it.
  targetBranch?: (req: Request) => string | undefined;
}

export function requireStaff(
  permissions: Operation | readonly Operation[],
  options: StaffRequirementOptions = {},
): RequestHandler {
  return (req, res, next) => {
    const decision = authorizeStaff(req.user, permissions, options.targetBranch?.(req));
    if (!decision.allowed) {
      deny(res, decision);
      return;
    }
    next();
  };
}

// Any authenticated principal (staff or online guest).
export const requirePrincipal: RequestHandler = (req, res, next) => {
  if (!req.user) {
    deny(res, { allowed: false, status: 401, code: 'AUTHENTICATION_REQUIRED' });
    return;
  }
  next();
};

// Only an online guest. Staff are denied.
export const requireGuest: RequestHandler = (req, res, next) => {
  if (!req.user) {
    deny(res, { allowed: false, status: 401, code: 'AUTHENTICATION_REQUIRED' });
    return;
  }
  if (req.user.kind !== 'GUEST' || !req.user.guestId) {
    deny(res, { allowed: false, status: 403, code: 'FORBIDDEN' });
    return;
  }
  next();
};

// An online guest, or staff holding one of the given permissions. The owning
// feature must still check that the guest owns the requested record.
export function requireGuestOrStaff(permissions: Operation | readonly Operation[]): RequestHandler {
  const staff = requireStaff(permissions);
  return (req, res, next) => {
    if (req.user?.kind === 'GUEST' && req.user.guestId) {
      next();
      return;
    }
    staff(req, res, next);
  };
}

export interface RoutePolicyRule {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  // Matched against req.path relative to the router mount point.
  path: RegExp;
  permissions: Operation | readonly Operation[];
  // For branch-scoped grants on read endpoints that filter by a query
  // parameter: a different branch is rejected and the officer's own branch is
  // forced, so omitting the filter cannot widen the result.
  scopeQueryBranch?: string;
}

// Default-deny policy for routers that do not accept injected middleware:
// a request matching no rule is refused, so a newly added route stays closed
// until it is mapped to a permission here.
export function routePolicy(rules: readonly RoutePolicyRule[]): RequestHandler {
  return (req, res, next) => {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const rule = rules.find((candidate) => candidate.method === method && candidate.path.test(req.path));
    if (!rule) {
      deny(res, req.user ? { allowed: false, status: 403, code: 'FORBIDDEN' } : { allowed: false, status: 401, code: 'AUTHENTICATION_REQUIRED' });
      return;
    }
    const rawBranch = rule.scopeQueryBranch ? req.query[rule.scopeQueryBranch] : undefined;
    if (rawBranch !== undefined && typeof rawBranch !== 'string') {
      deny(res, { allowed: false, status: 403, code: 'CROSS_BRANCH_FORBIDDEN' });
      return;
    }
    const decision = authorizeStaff(req.user, rule.permissions, rawBranch || undefined);
    if (!decision.allowed) {
      deny(res, decision);
      return;
    }
    if (rule.scopeQueryBranch && decision.scope === 'BRANCH') {
      req.query[rule.scopeQueryBranch] = decision.branchId;
    }
    next();
  };
}

// Runs authentication first, then the authorization check, as one handler so
// it can be injected wherever a router expects a single RequestHandler.
export function withAuthentication(authenticate: RequestHandler, check: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    authenticate(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      check(req, res, next);
    });
  };
}

const ID = '[^/]+';

export const ADMIN_ROUTE_POLICY: readonly RoutePolicyRule[] = [
  { method: 'GET', path: /^\/branches\/?$/, permissions: 'branch.read' },
  { method: 'POST', path: /^\/branches\/?$/, permissions: 'branch.write' },
  { method: 'PATCH', path: new RegExp(`^/branches/${ID}/?$`), permissions: 'branch.write' },
  { method: 'GET', path: /^\/users\/?$/, permissions: 'account.read' },
  { method: 'PATCH', path: new RegExp(`^/users/${ID}/status/?$`), permissions: 'account.write' },
  { method: 'GET', path: /^\/audit-logs\/?$/, permissions: 'audit.read' },
  { method: 'GET', path: /^\/configs\/?$/, permissions: 'config.read' },
  { method: 'PUT', path: new RegExp(`^/configs/${ID}/?$`), permissions: 'config.write' },
];

// Branch managers get only the reports whose queries filter by branch_id;
// the others aggregate across branches and stay chain-reader only until the
// report owner adds a branch filter.
const BRANCH_OR_CHAIN_REPORT = ['report.read.chain', 'report.read.branch'] as const;

export const REPORT_ROUTE_POLICY: readonly RoutePolicyRule[] = [
  { method: 'GET', path: /^\/occupancy\/?$/, permissions: BRANCH_OR_CHAIN_REPORT, scopeQueryBranch: 'branch_id' },
  { method: 'GET', path: /^\/revenue\/?$/, permissions: BRANCH_OR_CHAIN_REPORT, scopeQueryBranch: 'branch_id' },
  { method: 'GET', path: /^\/revenue\/export\/?$/, permissions: BRANCH_OR_CHAIN_REPORT, scopeQueryBranch: 'branch_id' },
  { method: 'GET', path: /^\/occupancy\/export\/?$/, permissions: BRANCH_OR_CHAIN_REPORT, scopeQueryBranch: 'branch_id' },
  { method: 'GET', path: /^\/billing(\/export)?\/?$/, permissions: BRANCH_OR_CHAIN_REPORT, scopeQueryBranch: 'branch_id' },
  { method: 'GET', path: /^\/guest-history(\/export)?\/?$/, permissions: 'report.read.chain' },
  { method: 'GET', path: /^\/service-usage(\/top)?\/?$/, permissions: 'report.read.chain' },
  { method: 'GET', path: /^\/service-usage\/export\/?$/, permissions: 'report.read.chain' },
  { method: 'GET', path: /^\/preference\/trends\/?$/, permissions: 'report.read.chain' },
  { method: 'GET', path: /^\/trends\/export\/?$/, permissions: 'report.read.chain' },
  { method: 'GET', path: /^\/audit-logs(\/export)?\/?$/, permissions: 'audit.read' },
];

// Bundles the middleware every protected router uses, all behind
// auth.authenticate.
export function createAuthorization(authenticate: RequestHandler) {
  const guard = (check: RequestHandler) => withAuthentication(authenticate, check);
  return {
    authenticated: guard(requirePrincipal),
    guest: guard(requireGuest),
    staff: (permissions: Operation | readonly Operation[], options?: StaffRequirementOptions) =>
      guard(requireStaff(permissions, options)),
    guestOrStaff: (permissions: Operation | readonly Operation[]) => guard(requireGuestOrStaff(permissions)),
    policy: (rules: readonly RoutePolicyRule[]) => guard(routePolicy(rules)),
  };
}

export type Authorization = ReturnType<typeof createAuthorization>;

// Request context for branch-scoped routers: always the session's own branch
// and user, never a client-supplied value.
export function sessionBranchId(req: Request): string {
  return req.user?.kind === 'STAFF' ? req.user.branchId ?? '' : '';
}

export function sessionUserId(req: Request): string {
  return req.user?.userId ?? '';
}

export interface ResolvedActor {
  userId: string;
  role?: string;
  branchId?: string;
}

// The one actor-resolution seam for feature controllers/services. The verified
// session (`req.user`) is always authoritative. Identity headers exist only as
// an isolated adapter for feature tests that mount a router without the session
// middleware; they are never consulted in production, and even in tests the
// feature services re-derive role/branch from officer/role by userId.
export function resolveActor(req: Request): ResolvedActor {
  if (req.user) {
    return { userId: req.user.userId, role: req.user.role, branchId: req.user.branchId };
  }
  if (process.env.NODE_ENV === 'production') return { userId: '' };
  const header = (name: string): string | undefined => {
    const value = req.headers[name];
    const single = Array.isArray(value) ? value[0] : value;
    return typeof single === 'string' ? single.trim() : undefined;
  };
  return {
    userId: header('x-user-id') ?? header('x-actor-id') ?? '',
    role: header('x-role'),
    branchId: header('x-branch-id'),
  };
}

// Build an AuthPrincipal from a role/branch pair re-read from the database, for
// services that must authorize against a resource-derived target branch.
export function staffPrincipal(userId: string, role: string, branchId: string | null | undefined): AuthPrincipal {
  return { userId, username: '', kind: 'STAFF', role, branchId: branchId ?? undefined };
}
