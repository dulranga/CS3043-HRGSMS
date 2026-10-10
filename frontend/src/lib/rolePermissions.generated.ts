// AUTO-GENERATED from backend/src/authorization.ts — do not edit by hand.
// Regenerate with: npm run gen:permissions

export type PermissionScope = 'BRANCH' | 'CHAIN';

export const OPERATIONS = [
  "catalogue.write",
  "room.read",
  "room.write",
  "room.condition.write",
  "service_usage.record",
  "service_usage.void",
  "booking.manage",
  "booking.check_in",
  "booking.cancel",
  "booking.no_show",
  "checkout.perform",
  "payment.record",
  "invoice.read.branch",
  "invoice.read.chain",
  "discount.apply",
  "guest.link.issue",
  "guest.manage",
  "report.read.branch",
  "report.read.chain",
  "audit.read",
  "billing_policy.publish",
  "branch.read",
  "branch.write",
  "account.read",
  "account.write",
  "config.read",
  "config.write",
] as const;

export type Operation = (typeof OPERATIONS)[number];

// A staff role maps to the exact set of operations it may perform and the
// scope of each grant (BRANCH = own branch, CHAIN = chain-wide).
export const ROLE_GRANTS: Record<string, Partial<Record<Operation, PermissionScope>>> = {
  FRONT_DESK: { "booking.cancel": 'BRANCH', "booking.check_in": 'BRANCH', "booking.manage": 'BRANCH', "booking.no_show": 'BRANCH', "branch.read": 'CHAIN', "checkout.perform": 'BRANCH', "guest.link.issue": 'CHAIN', "guest.manage": 'CHAIN', "invoice.read.branch": 'BRANCH', "payment.record": 'BRANCH', "room.read": 'BRANCH', "service_usage.record": 'BRANCH' },
  SERVICE_STAFF: { "branch.read": 'CHAIN', "invoice.read.branch": 'BRANCH', "room.condition.write": 'BRANCH', "room.read": 'BRANCH', "service_usage.record": 'BRANCH' },
  BRANCH_MANAGER: { "booking.cancel": 'BRANCH', "booking.check_in": 'BRANCH', "booking.no_show": 'BRANCH', "branch.read": 'CHAIN', "checkout.perform": 'BRANCH', "discount.apply": 'BRANCH', "invoice.read.branch": 'BRANCH', "report.read.branch": 'BRANCH', "room.condition.write": 'BRANCH', "room.read": 'BRANCH', "room.write": 'BRANCH', "service_usage.void": 'BRANCH' },
  CHAIN_MANAGER: { "billing_policy.publish": 'CHAIN', "booking.cancel": 'CHAIN', "booking.check_in": 'CHAIN', "booking.no_show": 'CHAIN', "branch.read": 'CHAIN', "catalogue.write": 'CHAIN', "checkout.perform": 'CHAIN', "invoice.read.chain": 'CHAIN', "report.read.chain": 'CHAIN', "service_usage.void": 'CHAIN' },
  SYSTEM_ADMINISTRATOR: { "account.read": 'CHAIN', "account.write": 'CHAIN', "audit.read": 'CHAIN', "booking.cancel": 'CHAIN', "booking.check_in": 'CHAIN', "booking.no_show": 'CHAIN', "branch.read": 'CHAIN', "branch.write": 'CHAIN', "checkout.perform": 'CHAIN', "config.read": 'CHAIN', "config.write": 'CHAIN', "service_usage.void": 'CHAIN' },
  AUDITOR: { "account.read": 'CHAIN', "audit.read": 'CHAIN', "branch.read": 'CHAIN', "config.read": 'CHAIN', "invoice.read.chain": 'CHAIN', "report.read.chain": 'CHAIN' },
};
