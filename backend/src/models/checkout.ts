export interface CheckoutLineParams {
  bookingId: string;
  lineId: string;
  actorId: string;
  reason?: string;
}

export interface CheckoutResult {
  booking_id: string;
  line_id: string;
  room_id: string;
  room_number: string;
  room_condition: 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';
  checked_out_at: string;
  checked_out_by: string;
  remaining_active_lines: number;
  is_finalized: boolean;
  invoice_id: string | null;
  invoice_number: string | null;
  issued_at: string | null;
  provisional_statement_ref: string;
}

export interface CheckoutReceipt {
  statement_reference: string;
  booking_id: string;
  line_id: string;
  room_id: string;
  room_number: string;
  room_condition: 'CLEANING';
  checked_out_at: string;
  checked_out_by: string;
  remaining_active_lines: number;
  is_finalized: boolean;
  invoice_id: string | null;
  invoice_number: string | null;
  issued_at: string | null;
}
