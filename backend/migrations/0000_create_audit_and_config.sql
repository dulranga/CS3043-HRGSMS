CREATE EXTENSION IF NOT EXISTS "pgcrypto";  --to generate random uuid

CREATE TABLE IF NOT EXISTS audit_log (
    audit_id UUID DEFAULT gen_random_uuid(),
    user_id UUID,
    entity_name VARCHAR(255) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    before_value TEXT,
    after_value TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(255),

    PRIMARY KEY (audit_id)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_perf ON audit_log(entity_name, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

CREATE TABLE IF NOT EXISTS system_config (
    config_key VARCHAR(255),
    config_value TEXT NOT NULL,
    effective_from DATE DEFAULT CURRENT_DATE,
    updated_by UUID,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (config_key)
);

INSERT INTO system_config (config_key, config_value, effective_from) VALUES
('cancellation_fee_rate', '10.0', CURRENT_DATE),
('tax_rate', '8.0', CURRENT_DATE),
('service_charge_rate', '5.0', CURRENT_DATE),
('late_checkout_amount', '2000.00', CURRENT_DATE),
('discount_rate', '0.0', CURRENT_DATE)
ON CONFLICT (config_key) DO NOTHING;