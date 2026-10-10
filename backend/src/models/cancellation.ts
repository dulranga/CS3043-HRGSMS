export interface CancelLineParams {
  bookingId: string;
  lineId: string;
  actorId: string;
  reason?: string;
  cancelTime?: string;
}

export interface CancelLineResult {
  booking_id: string;
  line_id: string;
  status: 'CANCELLED';
  cancelled_at: string;
  cancelled_by: string;
  cancellation_fee: number;
  remaining_active_lines: number;
  new_outstanding_balance: number;
  is_credit: boolean;
  credit_amount: number;
}

export interface CancelLineReceipt {
  booking_id: string;
  line_id: string;
  status: 'CANCELLED';
  cancelled_at: string;
  cancelled_by: string;
  cancellation_fee: number;
  remaining_active_lines: number;
  outstanding_balance: number;
  is_credit: boolean;
  credit_amount: number;
}

export interface CancelWholeBookingParams {
  bookingId: string;
  actorId: string;
  reason?: string;
  cancelTime?: string;
}

export interface CancelWholeBookingResult {
  booking_id: string;
  cancelled_lines_count: number;
  cancelled_line_ids: string[];
  cancelled_at: string;
  cancelled_by: string;
  total_cancellation_fees: number;
  remaining_active_lines: number;
  new_outstanding_balance: number;
  is_credit: boolean;
  credit_amount: number;
}

export interface CancelWholeBookingReceipt {
  booking_id: string;
  cancelled_lines_count: number;
  cancelled_line_ids: string[];
  cancelled_at: string;
  cancelled_by: string;
  total_cancellation_fees: number;
  remaining_active_lines: number;
  outstanding_balance: number;
  is_credit: boolean;
  credit_amount: number;
}

export interface CancellationQuote {
  booking_id: string;
  line_id?: string;
  is_eligible: boolean;
  stay_start_date?: string;
  cutoff_deadline?: string;
  cancellation_fee: number;
  rejection_reason?: string;
}
