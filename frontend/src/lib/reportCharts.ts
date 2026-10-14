import { formatLkr, sumMoney, toMoneyString } from './money';
import type { ReportType } from './reportUrl';

/**
 * Pure chart decision layer for the management reports screen. The backend
 * rows are PostgreSQL view results: `numeric` columns arrive as exact strings
 * ('1250.50') and `COUNT` columns as strings, so every number is coerced
 * defensively and money is aggregated with the shared exact-text helpers
 * before any chart scaling converts it to a float.
 *
 * Billing and the audit log stay table-only: invoice rows are per-booking
 * documents and audit rows are event history, neither aggregates into a
 * meaningful series.
 */
export const CHART_REPORTS: readonly ReportType[] = [
  'occupancy',
  'revenue',
  'service-usage',
  'preference-trends',
  'guest-history',
];

export function isChartReport(report: ReportType): boolean {
  return CHART_REPORTS.includes(report);
}

interface ReportRow {
  [key: string]: unknown;
}

function asRow(value: unknown): ReportRow {
  return value && typeof value === 'object' ? (value as ReportRow) : {};
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Coerces an unknown view column into the money helpers' accepted input. */
function toMoneyInput(value: unknown): string | number {
  return typeof value === 'string' || typeof value === 'number' ? value : 0;
}

function toName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** The revenue view groups months in Asia/Colombo, so labels must too. */
const COLOMBO_MONTH = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Colombo',
});

export function colomboMonthLabel(month: string): string {
  const time = Date.parse(month);
  return Number.isNaN(time) ? month : COLOMBO_MONTH.format(new Date(time));
}

// --- Occupancy: one row per branch from view_current_occupancy -------------

export interface OccupancyDatum {
  branch: string;
  occupiedRooms: number;
  totalRooms: number;
  /** Occupancy rate in percent; a branch with no active rooms has NULL in the
   * view (NULLIF guard) and is charted as 0 with its room counts shown. */
  occupancyRate: number;
}

export function occupancySeries(rows: unknown[]): OccupancyDatum[] {
  return rows
    .map((row) => {
      const record = asRow(row);
      const rate = Number(record.occupancy_rate_percentage);
      return {
        branch: toName(record.branch_name, 'Branch'),
        occupiedRooms: toCount(record.occupied_rooms),
        totalRooms: toCount(record.total_rooms),
        occupancyRate: Number.isFinite(rate) ? rate : 0,
      };
    })
    .sort(
      (a, b) =>
        b.occupancyRate - a.occupancyRate ||
        b.occupiedRooms - a.occupiedRooms ||
        a.branch.localeCompare(b.branch),
    );
}

// --- Revenue: per month × branch rows aggregated into month buckets --------

export interface RevenueDatum {
  /** Raw revenue_month value; one bucket per distinct month. */
  month: string;
  /** Asia/Colombo month label, matching the view's grouping. */
  monthLabel: string;
  room: number;
  service: number;
  other: number;
  total: number;
  roomLabel: string;
  serviceLabel: string;
  otherLabel: string;
  totalLabel: string;
}

export function revenueSeries(rows: unknown[]): RevenueDatum[] {
  const buckets = new Map<
    string,
    { room: string[]; service: string[]; other: string[] }
  >();
  for (const row of rows) {
    const record = asRow(row);
    const month = typeof record.revenue_month === 'string' ? record.revenue_month : '';
    if (!month) continue;
    const bucket = buckets.get(month) ?? { room: [], service: [], other: [] };
    bucket.room.push(String(record.room_revenue_lkr ?? 0));
    bucket.service.push(String(record.service_revenue_lkr ?? 0));
    bucket.other.push(String(record.other_revenue_lkr ?? 0));
    buckets.set(month, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => Date.parse(left) - Date.parse(right))
    .map(([month, bucket]) => {
      // Exact-text aggregation first; the float conversion below only feeds
      // the chart's bar scaling, never the displayed amounts.
      const room = sumMoney(bucket.room);
      const service = sumMoney(bucket.service);
      const other = sumMoney(bucket.other);
      const total = sumMoney([room, service, other]);
      return {
        month,
        monthLabel: colomboMonthLabel(month),
        room: Number(room),
        service: Number(service),
        other: Number(other),
        total: Number(total),
        roomLabel: formatLkr(room),
        serviceLabel: formatLkr(service),
        otherLabel: formatLkr(other),
        totalLabel: formatLkr(total),
      };
    });
}

// --- Service usage / preference trends: top services -----------------------

export interface ServiceUsageDatum {
  service: string;
  category: string;
  orders: number;
  quantity: number;
  revenue: number;
  revenueLabel: string;
}

export type ServiceRankBy = 'revenue' | 'quantity';

export function serviceUsageSeries(
  rows: unknown[],
  by: ServiceRankBy = 'revenue',
  limit = 8,
): ServiceUsageDatum[] {
  return rows
    .map((row) => {
      const record = asRow(row);
      const revenueText = toMoneyString(toMoneyInput(record.total_revenue_generated));
      return {
        service: toName(record.service_name ?? record.name, 'Service'),
        category: toName(record.category, 'Service'),
        orders: toCount(record.total_orders),
        quantity: toCount(record.total_quantity_consumed),
        revenue: Number(revenueText),
        revenueLabel: formatLkr(revenueText),
      };
    })
    .sort(
      (left, right) =>
        (by === 'quantity' ? right.quantity - left.quantity : right.revenue - left.revenue) ||
        right.orders - left.orders ||
        left.service.localeCompare(right.service),
    )
    .slice(0, Math.max(1, limit));
}

// --- Guest history: top guests by lifetime expenditure ---------------------

export interface GuestHistoryDatum {
  guest: string;
  stays: number;
  expenditure: number;
  expenditureLabel: string;
}

export function guestHistorySeries(rows: unknown[], limit = 10): GuestHistoryDatum[] {
  return rows
    .map((row) => {
      const record = asRow(row);
      const expenditureText = toMoneyString(toMoneyInput(record.lifetime_expenditure));
      return {
        guest: toName(record.full_name, 'Guest'),
        stays: toCount(record.total_stays),
        expenditure: Number(expenditureText),
        expenditureLabel: formatLkr(expenditureText),
      };
    })
    .sort(
      (left, right) =>
        right.expenditure - left.expenditure ||
        right.stays - left.stays ||
        left.guest.localeCompare(right.guest),
    )
    .slice(0, Math.max(1, limit));
}
