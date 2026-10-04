
CREATE TABLE audit_log (
    audit_id UUID DEFAULT uuidv7() PRIMARY KEY,
    user_id UUID,
    entity_name VARCHAR(255) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    before_value TEXT,
    after_value TEXT,
    changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(255)
);

CREATE INDEX idx_audit_entity ON audit_log(entity_name, changed_at DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, changed_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action);

CREATE TABLE system_config (
    config_key VARCHAR(255) PRIMARY KEY,
    config_value TEXT NOT NULL,
    effective_from DATE DEFAULT CURRENT_DATE,
    updated_by UUID,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_config (config_key, config_value) VALUES
('cancellation_fee_rate','10.0'),
('tax_rate','8.0'),
('service_charge_rate','5.0'),
('late_checkout_amount','2000.00'),
('discount_rate','0.0')
ON CONFLICT DO NOTHING;