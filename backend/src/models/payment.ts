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
