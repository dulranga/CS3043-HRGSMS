export interface OccupancyReport {
  room_id?: string;
  room_number: string;
  room_type: string;
  status: string;
  guest_name?: string;
  check_in_date?: string;
  check_out_date?: string;
}

export interface RevenueReport {
  branch_id?: string;
  branch_name?: string;
  billing_month?: string;
  total_revenue: number;
}

export interface GuestHistoryReport {
  guest_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  total_stays: number;
  lifetime_expenditure: number;
  last_visit_date?: string;
}

export interface ServiceUsageReport {
  service_id: string;
  service_name: string;
  total_orders: number;
  total_quantity_consumed: number;
  total_revenue: number;
}

export interface AuditLogReport {
  log_id: string;
  timestamp: string;
  action_type: string;
  target_table: string;
  record_id?: string;
  staff_name?: string;
  staff_role?: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
}