export interface OccupancyReport {
  branch_id: string;
  branch_name: string;
  total_rooms: number | string;
  occupied_rooms: number | string;
  occupancy_rate_percentage: number | string | null;
}

export interface BillingSummaryReport {
  booking_id: string;
  booking_ref: string;
  full_name: string;
  invoice_number: string;
  total_amount: number | string;
  invoice_status: 'ISSUED' | 'PAID' | 'VOID' | 'OVERDUE' | string;
  paid_amount: number | string;
  refunded_amount?: number | string;
  net_paid?: number | string;
  balance: number | string;
}

export interface RevenueReport {
  branch_id: string;
  branch_name: string;
  revenue_month: string;
  total_revenue_lkr: number | string;
}

export interface ServiceUsageReport {
  service_id: string;
  service_name: string;
  category?: string;
  total_orders: number | string;
  total_quantity_consumed: number | string;
  total_revenue_generated: number | string;
}

export interface ServiceTrendsReport {
  category?: string;
  service_name: string;
  usage_count: number | string;
  total_qty: number | string;
  total_rev: number | string;
}

export interface GuestHistoryReport {
  guest_id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  total_stays: number | string;
  lifetime_expenditure: number | string;
  last_visit_date?: string | null;
}

export interface AuditLogReport {
  audit_id: string;
  changed_at: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  entity_name: string;
  entity_id: string;
  user_id?: string | null;
  username?: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
  staff_role?: string | null;
  before_value?: string | Record<string, unknown> | null;
  after_value?: string | Record<string, unknown> | null;
  ip_address?: string | null;
}

export interface SystemConfigItem {
  config_key: string;
  config_value: string;
  effective_from?: string;
  updated_at?: string;
}

