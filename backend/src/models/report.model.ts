export interface OccupancyReport {
  branch_id: string;
  branch_name: string;
  total_rooms: number | string; 
  occupied_rooms: number | string;
  occupancy_rate_percentage: number | string | null;
}

export interface RevenueReport {
  branch_id: string;
  branch_name: string;
  revenue_month: string;
  total_revenue_lkr: number | string;
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

export interface ServiceUsageReport {
  service_id: string;
  service_name: string;
  category?: string;
  total_orders: number | string;
  total_quantity_consumed: number | string;
  total_revenue_generated: number | string;
}

export interface AuditLogReport {
  audit_id: string;
  changed_at: string;
  action: string;
  entity_name: string;
  entity_id: string;
  staff_id?: string | null;
  staff_name?: string | null;
  staff_role?: string | null;
  before_value?: string | Record<string, unknown> | null;
  after_value?: string | Record<string, unknown> | null;
  ip_address?: string | null;
}