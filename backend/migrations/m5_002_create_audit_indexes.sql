CREATE INDEX IF NOT EXISTS idx_audit_log_entity_changed 
  ON audit_log (entity_name, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_changed 
  ON audit_log (user_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_action_only 
  ON audit_log (action);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_action 
  ON audit_log (user_id, changed_at DESC, action);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id_changed 
  ON audit_log (entity_name, entity_id, changed_at DESC);

-- Supporting report performance indexes
CREATE INDEX IF NOT EXISTS idx_booking_branch_dates_status 
  ON booking (branch_id, check_in_date, status);

CREATE INDEX IF NOT EXISTS idx_service_usage_used_booking 
  ON service_usage (used_at, booking_id);

CREATE INDEX IF NOT EXISTS idx_payment_booking_status 
  ON payment (booking_id, status, recorded_at);

CREATE INDEX IF NOT EXISTS idx_invoice_booking_status 
  ON invoice (booking_id, status, created_at);