import { ROLE_GRANTS, type Operation } from './rolePermissions.generated';

export type ReportType = 'occupancy' | 'billing' | 'revenue' | 'guest-history' | 'service-usage' | 'preference-trends' | 'audit-logs';

// Mirrors the backend REPORT_ROUTE_POLICY: the three branch-filtered reports
// accept either report grant, the cross-branch aggregations need the chain
// grant, and the audit report needs audit.read. Derived from the generated
// role-grant matrix so the client can never hide a report the server permits
// (the API still authorizes every request independently).
const REPORT_REQUIREMENTS: Record<ReportType, readonly Operation[]> = {
  occupancy: ['report.read.branch', 'report.read.chain'],
  billing: ['report.read.branch', 'report.read.chain'],
  revenue: ['report.read.branch', 'report.read.chain'],
  'guest-history': ['report.read.chain'],
  'service-usage': ['report.read.chain'],
  'preference-trends': ['report.read.chain'],
  'audit-logs': ['audit.read'],
};

export function hasReportAccess(role: string | null, report: ReportType): boolean {
  if (!role) return false;
  const grants = ROLE_GRANTS[role];
  if (!grants) return false;
  return REPORT_REQUIREMENTS[report].some((required) => grants[required] !== undefined);
}
export function reportUrl(origin: string, report: ReportType, filters: Record<string, string>, csv = false): URL {
  const endpoint = report === 'preference-trends' ? (csv ? 'trends' : 'preference/trends') : report;
  const url = new URL(`/api/reports/${endpoint}${csv ? '/export' : ''}`, origin);
  const keys: Record<ReportType, string[]> = {
    occupancy: ['branch_id'], billing: ['branch_id', 'booking_ref', 'invoice_status', 'limit', 'offset'],
    revenue: ['branch_id', 'year'], 'guest-history': ['search', 'min_stays', 'limit', 'offset'],
    'service-usage': ['category', 'search'], 'preference-trends': ['by', 'limit'],
    'audit-logs': ['entity_name', 'action', 'staff_id', 'limit', 'page'],
  };
  for (const key of keys[report]) if (filters[key]?.trim()) url.searchParams.set(key, filters[key].trim());
  return url;
}
