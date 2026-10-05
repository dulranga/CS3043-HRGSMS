export type PaymentKind = 'PAYMENT' | 'REFUND';
export type PaymentStatus = 'SUCCESSFUL' | 'FAILED' | 'REVERSED';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER';

export interface Payment {
  payment_id: string;
  booking_id: string;
  recorded_by: string;
  kind: PaymentKind;
  amount: string; // LKR numeric(14, 2)
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  paid_at: Date;
  recorded_at: Date;
}

export interface PostPaymentParams {
  bookingId: string;
  recordedBy: string;
  kind: PaymentKind;
  amount: number | string;
  method: PaymentMethod;
  reference: string;
  status?: PaymentStatus;
  paidAt?: Date | string;
}

export interface PaymentPostingResult {
  payment_id: string;
  booking_id: string;
  recorded_by: string;
  kind: PaymentKind;
  amount: string;
  status: PaymentStatus;
  method: PaymentMethod;
  reference: string;
  paid_at: string;
  recorded_at: string;
  previous_balance: string;
  new_balance: string;
  is_credit: boolean;
  credit_amount: string;
}

export interface ReversePaymentResult {
  payment_id: string;
  booking_id: string;
  kind: PaymentKind;
  amount: string;
  status: PaymentStatus;
  reference: string;
  previous_balance: string;
  new_balance: string;
}
