-- M4-S06: Query performance indexes for invoice detail and payment history reads
-- Indexes foreign key and filtering columns per lecture 5 indexing recommendations.

-- Index on invoice_line.invoice_id for fast retrieval of lines by invoice
CREATE INDEX IF NOT EXISTS idx_invoice_line_invoice_id 
    ON invoice_line (invoice_id);

-- Composite index on payment for fast aggregation of payments/refunds by booking, kind, and status
CREATE INDEX IF NOT EXISTS idx_payment_booking_kind_status 
    ON payment (booking_id, kind, status);
