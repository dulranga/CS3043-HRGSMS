import { InvoiceLineType } from '../services/billingCalculator';
import { Payment } from './payment';

export type InvoiceStatus = 'DRAFT' | 'FINAL';

export interface Invoice {
  invoice_id: string;
  booking_id: string;
  billing_policy_id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  issued_at: Date | null;
  created_at: Date;
}

export interface InvoiceLine {
  invoice_line_id: string;
  invoice_id: string;
  line_type: InvoiceLineType;
  booking_room_line_id: string | null;
  description: string;
  amount: string; // LKR numeric(14, 2)
}

export interface BookingBalance {
  invoice_id: string | null;
  status: InvoiceStatus | null;
  total_amount: number;
  successful_payments: number;
  successful_refunds: number;
  net_paid: number;
  balance: number;
  is_settled: boolean;
}

export interface InvoiceSummary {
  total_amount: number;
  successful_payments: number;
  successful_refunds: number;
  net_payments: number;
  outstanding_balance: number;
  credit_amount: number;
  is_credit: boolean;
  is_settled: boolean;
  is_provisional: boolean;
}

export interface InvoiceDetailResponse {
  invoice_id: string;
  booking_id: string;
  billing_policy_id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  is_provisional: boolean;
  issued_at: Date | null;
  created_at: Date;
  lines: InvoiceLine[];
  summary: InvoiceSummary;
}

export interface PaymentHistoryResponse {
  booking_id: string;
  payments: Payment[];
  summary: {
    successful_payments_total: number;
    successful_refunds_total: number;
    net_payments: number;
    invoice_total: number;
    outstanding_balance: number;
    credit_amount: number;
    is_credit: boolean;
    is_settled: boolean;
  };
}
