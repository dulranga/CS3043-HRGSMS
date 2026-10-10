export interface MarkNoShowParams {
  bookingId: string;
  lineId: string;
  actorId: string;
  reason?: string;
  markTime?: string;
}

export interface MarkNoShowResult {
  booking_id: string;
  line_id: string;
  status: 'NO_SHOW';
  no_show_at: string;
  marked_by: string;
  no_show_fee: number;
  remaining_active_lines: number;
  new_outstanding_balance: number;
  is_credit: boolean;
  credit_amount: number;
}

export interface NoShowReceipt {
  booking_id: string;
  line_id: string;
  status: 'NO_SHOW';
  no_show_at: string;
  marked_by: string;
  no_show_fee: number;
  remaining_active_lines: number;
  outstanding_balance: number;
  is_credit: boolean;
  credit_amount: number;
}

export interface MarkNoShowBookingParams {
  bookingId: string;
  actorId: string;
  reason?: string;
  markTime?: string;
}

export interface MarkNoShowBookingResult {
  booking_id: string;
  no_show_lines_count: number;
  no_show_line_ids: string[];
  no_show_at: string;
  marked_by: string;
  total_no_show_fees: number;
  remaining_active_lines: number;
  new_outstanding_balance: number;
  is_credit: boolean;
  credit_amount: number;
}

export interface MarkNoShowBookingReceipt {
  booking_id: string;
  no_show_lines_count: number;
  no_show_line_ids: string[];
  no_show_at: string;
  marked_by: string;
  total_no_show_fees: number;
  remaining_active_lines: number;
  outstanding_balance: number;
  is_credit: boolean;
  credit_amount: number;
}

export interface NoShowQuote {
  booking_id: string;
  line_id?: string;
  is_eligible: boolean;
  stay_start_date?: string;
  cutoff_deadline?: string;
  no_show_grace_days?: number;
  no_show_fee: number;
  rejection_reason?: string;
}
