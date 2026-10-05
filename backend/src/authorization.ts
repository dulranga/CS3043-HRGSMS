import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthPrincipal } from './auth';

// M1-S09 server-side staff authorization (SRS §6.1.4 staff permission mapping,
// FR-003/004/081, AT-24). The matrix below is the single version-controlled
// source of staff permissions, keyed by the seeded role.role_name values; there
// is no permission table. Role and branch come from req.user, which
// auth.authenticate re-reads from officer/role on every request, never from
// request headers or bodies. Guest sessions never match a staff permission;
// guest ownership checks stay with the owning feature (FR-081/082).
// The mapping follows the SRS working proposal pending TBD-15 sign-off.

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

interface PermissionRule {
  readonly roles: readonly StaffRole[];
  readonly scope: PermissionScope;
}

export const PERMISSIONS = {
  // Chain-wide room-type/amenity/service catalogues and prices (AT-24).
  'catalogue.write': { roles: ['CHAIN_MANAGER'], scope: 'CHAIN' },
  // Physical rooms and dated blocks.
  'room.read': { roles: ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER'], scope: 'BRANCH' },
  'room.write': { roles: ['BRANCH_MANAGER'], scope: 'BRANCH' },
  // Direct physical-condition changes (checkout's internal CLEANING transition
  // is part of checkout.perform, not this permission).
  'room.condition.write': { roles: ['SERVICE_STAFF'], scope: 'BRANCH' },
  'service_usage.record': { roles: ['FRONT_DESK', 'SERVICE_STAFF'], scope: 'BRANCH' },
  // Reservations, check-in, checkout and payments.
  'booking.manage': { roles: ['FRONT_DESK'], scope: 'BRANCH' },
  'checkout.perform': { roles: ['FRONT_DESK'], scope: 'BRANCH' },
  'payment.record': { roles: ['FRONT_DESK'], scope: 'BRANCH' },
  'invoice.read.branch': { roles: ['FRONT_DESK', 'BRANCH_MANAGER'], scope: 'BRANCH' },
  'invoice.read.chain': { roles: ['CHAIN_MANAGER', 'AUDITOR'], scope: 'CHAIN' },
  'discount.apply': { roles: ['BRANCH_MANAGER'], scope: 'BRANCH' },
  // Guest profiles are chain-wide (no branch FK): FRONT_DESK issues the
  // single-guest link code after checking identity (M1-S10, FR-083).
  'guest.link.issue': { roles: ['FRONT_DESK'], scope: 'CHAIN' },
  // Reports and audit.
  'report.read.branch': { roles: ['BRANCH_MANAGER'], scope: 'BRANCH' },
  'report.read.chain': { roles: ['CHAIN_MANAGER', 'AUDITOR'], scope: 'CHAIN' },
  'audit.read': { roles: ['SYSTEM_ADMINISTRATOR', 'AUDITOR'], scope: 'CHAIN' },
  // Chain-wide billing policy.
  'billing_policy.publish': { roles: ['CHAIN_MANAGER'], scope: 'CHAIN' },
  // Branch records, staff accounts and non-financial configuration.
  'branch.read': { roles: STAFF_ROLES, scope: 'CHAIN' },
  'branch.write': { roles: ['SYSTEM_ADMINISTRATOR'], scope: 'CHAIN' },
  'account.read': { roles: ['SYSTEM_ADMINISTRATOR', 'AUDITOR'], scope: 'CHAIN' },
  'account.write': { roles: ['SYSTEM_ADMINISTRATOR'], scope: 'CHAIN' },
  'config.read': { roles: ['SYSTEM_ADMINISTRATOR', 'AUDITOR'], scope: 'CHAIN' },
  'config.write': { roles: ['SYSTEM_ADMINISTRATOR'], scope: 'CHAIN' },
} as const satisfies Record<string, PermissionRule>;

export type Permission = keyof typeof PERMISSIONS;

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export function roleHasPermission(role: unknown, permission: Permission): boolean {
  return isStaffRole(role) && (PERMISSIONS[permission].roles as readonly StaffRole[]).includes(role);
}

export type AuthorizationDecision =
  | { allowed: true; permission: Permission; scope: PermissionScope; branchId?: string }
  | { allowed: false; status: 401 | 403; code: 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'CROSS_BRANCH_FORBIDDEN' };

// Pure decision used by the middleware and available to services. A
// BRANCH-scoped permission also requires the target branch (when one is known)
// to equal the officer's assigned branch.
export function authorizeStaff(
  principal: AuthPrincipal | undefined,
  permissions: Permission | readonly Permission[],
  targetBranchId?: string,
): AuthorizationDecision {
  if (!principal) return { allowed: false, status: 401, code: 'AUTHENTICATION_REQUIRED' };
  if (principal.kind !== 'STAFF' || !principal.branchId) {
    return { allowed: false, status: 403, code: 'FORBIDDEN' };
  }
  const candidates = (typeof permissions === 'string' ? [permissions] : permissions).filter((permission) =>
    roleHasPermission(principal.role, permission),
  );
  if (candidates.length === 0) return { allowed: false, status: 403, code: 'FORBIDDEN' };
  // Prefer a chain-wide grant so a cross-branch reader is not branch-limited.
  const chain = candidates.find((permission) => PERMISSIONS[permission].scope === 'CHAIN');
  if (chain) return { allowed: true, permission: chain, scope: 'CHAIN' };
  const permission = candidates[0];
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
  permissions: Permission | readonly Permission[],
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

// An online guest, or staff holding one of the given permissions. The owning
// feature must still check that the guest owns the requested record.
export function requireGuestOrStaff(permissions: Permission | readonly Permission[]): RequestHandler {
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
  permissions: Permission | readonly Permission[];
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
  { method: 'GET', path: /^\/occupancy\/export\/?$/, permissions: 'report.read.chain' },
  { method: 'GET', path: /^\/guest-history(\/export)?\/?$/, permissions: 'report.read.chain' },
  { method: 'GET', path: /^\/service-usage(\/top)?\/?$/, permissions: 'report.read.chain' },
  { method: 'GET', path: /^\/audit-logs\/?$/, permissions: 'audit.read' },
];

// Bundles the middleware every protected router uses, all behind
// auth.authenticate.
export function createAuthorization(authenticate: RequestHandler) {
  const guard = (check: RequestHandler) => withAuthentication(authenticate, check);
  return {
    authenticated: guard(requirePrincipal),
    staff: (permissions: Permission | readonly Permission[], options?: StaffRequirementOptions) =>
      guard(requireStaff(permissions, options)),
    guestOrStaff: (permissions: Permission | readonly Permission[]) => guard(requireGuestOrStaff(permissions)),
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
