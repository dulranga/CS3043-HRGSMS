// Screen and CSV share one validated, parameterized query and stable ordering.
export class ReportFilterError extends Error {}
export function buildReportQuery(name: string, filters: Record<string, unknown>) {
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const text = (key: string): string | undefined => {
    const value = filters[key];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || value.length > 255) throw new ReportFilterError(`Invalid ${key}.`);
    return value;
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = text(key);
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new ReportFilterError(`Invalid ${key}.`);
    return Number(value);
  };
  const uuid = (key: string) => {
    const value = text(key);
    if (value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ReportFilterError(`Invalid ${key}.`);
    return value;
  };
  const branch = uuid('branch_id');
  const branchCondition = (alias: string) => branch ? `EXISTS (SELECT 1 FROM view_booking_branch bb WHERE bb.booking_id = ${alias}.booking_id AND bb.branch_id = ${bind(branch)})` : 'TRUE';
  const like = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
  const predicates: string[] = [];
  let source: string;
  let order: string;
  let page: number | undefined;
  let limit: number | undefined;
  switch (name) {
    case 'occupancy':
      source = 'view_current_occupancy';
      if (branch) predicates.push(`branch_id = ${bind(branch)}`);
      order = 'branch_name, branch_id';
      break;
    case 'billing': {
      source = 'v_report_billing_summary v';
      predicates.push(branchCondition('v'));
      const reference = text('booking_ref');
      if (reference) predicates.push(`booking_ref ILIKE ${bind(like(reference))} ESCAPE '\\'`);
      const status = text('invoice_status');
      if (status && !['DRAFT', 'FINAL'].includes(status)) throw new ReportFilterError('Invalid invoice_status.');
      if (status) predicates.push(`invoice_status = ${bind(status)}`);
      order = 'booking_ref, booking_id';
      limit = integer('limit', 50, 1, 100);
      break;
    }
    case 'revenue': {
      source = 'view_monthly_branch_revenue';
      if (branch) predicates.push(`branch_id = ${bind(branch)}`);
      if (text('year')) predicates.push(`EXTRACT(YEAR FROM revenue_month AT TIME ZONE 'Asia/Colombo') = ${bind(integer('year', 2026, 1, 9999))}`);
      for (const key of ['start_date', 'end_date']) {
        const value = text(key);
        if (value) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ReportFilterError(`Invalid ${key}.`);
          predicates.push(`(revenue_month AT TIME ZONE 'Asia/Colombo')::date ${key === 'start_date' ? '>=' : '<='} ${bind(value)}::date`);
        }
      }
      if (text('start_date') && text('end_date') && text('start_date')! > text('end_date')!) throw new ReportFilterError('Invalid date range.');
      order = 'revenue_month DESC, branch_name, branch_id';
      break;
    }
    case 'guest-history': {
      if (!branch) source = 'view_guest_history';
      else {
        const scope = bind(branch);
        source = `(WITH scoped AS (SELECT b.* FROM booking b JOIN view_booking_branch bb ON bb.booking_id = b.booking_id WHERE bb.branch_id = ${scope}),
          stays AS (SELECT b.guest_id, COUNT(DISTINCT b.booking_id) AS total_stays, MAX(l.stay_end_date) AS last_visit_date FROM scoped b LEFT JOIN booking_room_line l ON l.booking_id = b.booking_id GROUP BY b.guest_id),
          cash AS (SELECT b.guest_id, SUM(p.amount) AS lifetime_expenditure FROM scoped b JOIN payment p ON p.booking_id = b.booking_id WHERE p.status = 'SUCCESSFUL' AND p.kind = 'PAYMENT' GROUP BY b.guest_id)
          SELECT g.guest_id, g.full_name, g.email, g.phone, stays.total_stays, COALESCE(cash.lifetime_expenditure, 0) AS lifetime_expenditure, stays.last_visit_date
          FROM guest g JOIN stays ON stays.guest_id = g.guest_id LEFT JOIN cash ON cash.guest_id = g.guest_id) v`;
      }
      const search = text('search');
      if (search) { const p = bind(like(search)); predicates.push(`(full_name ILIKE ${p} ESCAPE '\\' OR email ILIKE ${p} ESCAPE '\\' OR phone ILIKE ${p} ESCAPE '\\')`); }
      if (text('min_stays')) predicates.push(`total_stays >= ${bind(integer('min_stays', 0, 0, 1000000))}`);
      order = 'lifetime_expenditure DESC, total_stays DESC, guest_id';
      limit = integer('limit', 50, 1, 100);
      break;
    }
    case 'service-usage':
    case 'trends': {
      source = branch ? `(SELECT s.service_id, s.name AS service_name, s.category, COUNT(su.usage_id) AS total_orders,
        COALESCE(SUM(su.quantity), 0) AS total_quantity_consumed, COALESCE(SUM(su.quantity * su.unit_price_snapshot), 0) AS total_revenue_generated
        FROM service s LEFT JOIN service_usage su ON su.service_id = s.service_id AND NOT su.voided AND ${branchCondition('su')}
        GROUP BY s.service_id, s.name, s.category) v` : 'view_service_usage';
      for (const [key, column] of [['category', 'category'], ['search', 'service_name']]) {
        const value = text(key);
        if (value) predicates.push(`${column} ILIKE ${bind(like(value))} ESCAPE '\\'`);
      }
      const by = text('by');
      if (by && !['quantity', 'revenue'].includes(by)) throw new ReportFilterError('Invalid by.');
      order = name === 'trends' && by === 'quantity' ? 'total_quantity_consumed DESC, service_id' : 'total_revenue_generated DESC, total_orders DESC, service_id';
      if (name === 'trends') { predicates.push('total_orders > 0'); limit = integer('limit', 5, 1, 50); }
      break;
    }
    case 'audit-logs':
      source = 'view_staff_activity_audit';
      for (const key of ['entity_name', 'action']) { const value = text(key); if (value) predicates.push(`${key} = ${bind(value)}`); }
      if (uuid('staff_id')) predicates.push(`staff_id = ${bind(uuid('staff_id'))}`);
      order = 'changed_at DESC, audit_id DESC';
      page = integer('page', 1, 1, 1000000);
      limit = integer('limit', 25, 1, 100);
      break;
    default: return null;
  }
  let sql = `SELECT * FROM ${source}${predicates.length ? ` WHERE ${predicates.join(' AND ')}` : ''} ORDER BY ${order}`;
  if (limit !== undefined) {
    sql += ` LIMIT ${bind(limit)}`;
    sql += ` OFFSET ${bind(page ? (page - 1) * limit : integer('offset', 0, 0, 100000000))}`;
  }
  return { sql, values, page, limit };
}
