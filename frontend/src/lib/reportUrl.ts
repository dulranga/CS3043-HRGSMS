export type ReportType = 'occupancy' | 'billing' | 'revenue' | 'guest-history' | 'service-usage' | 'preference-trends' | 'audit-logs';
export function hasReportAccess(role: string | null, report: ReportType): boolean {
  if (report === 'audit-logs') return role === 'SYSTEM_ADMINISTRATOR' || role === 'AUDITOR';
  if (role === 'CHAIN_MANAGER' || role === 'AUDITOR') return true;
  return role === 'BRANCH_MANAGER' && ['occupancy', 'billing', 'revenue'].includes(report);
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
