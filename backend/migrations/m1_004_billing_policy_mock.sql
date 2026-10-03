-- Mock 
CREATE TABLE IF NOT EXISTS billing_policy (
    billing_policy_id uuid PRIMARY KEY DEFAULT uuidv7(),
    effective_from date NOT NULL,
    tax_percent numeric(5, 2) NOT NULL CHECK (tax_percent BETWEEN 0 AND 100),
    service_charge_percent numeric(5, 2) NOT NULL CHECK (service_charge_percent BETWEEN 0 AND 100),
    max_discount_percent numeric(5, 2) NOT NULL CHECK (max_discount_percent BETWEEN 0 AND 100),
    cancellation_fee numeric(12, 2) NOT NULL CHECK (cancellation_fee >= 0),
    no_show_fee numeric(12, 2) NOT NULL CHECK (no_show_fee >= 0),
    late_checkout_fee numeric(12, 2) NOT NULL CHECK (late_checkout_fee >= 0),
    no_show_grace_days smallint NOT NULL CHECK (no_show_grace_days BETWEEN 1 AND 7),
    is_demo boolean NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT billing_policy_effective_created_unique UNIQUE (effective_from, created_at),
    CONSTRAINT billing_policy_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES user_account(user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
