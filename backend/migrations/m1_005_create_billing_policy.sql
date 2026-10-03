CREATE TABLE IF NOT EXISTS billing_policy (
    billing_policy_id uuid PRIMARY KEY DEFAULT uuidv7 (),
    effective_from date NOT NULL,
    tax_percent numeric(5, 2) NOT NULL,
    service_charge_percent numeric(5, 2) NOT NULL,
    max_discount_percent numeric(5, 2) NOT NULL,
    cancellation_fee numeric(12, 2) NOT NULL,
    no_show_fee numeric(12, 2) NOT NULL,
    late_checkout_fee numeric(12, 2) NOT NULL,
    no_show_grace_days smallint NOT NULL,
    is_demo boolean NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp (),
    CONSTRAINT billing_policy_uuidv7_check CHECK (
        (
            uuid_extract_version (billing_policy_id) = 7
        ) IS TRUE
    ),
    CONSTRAINT billing_policy_tax_percent_check CHECK (tax_percent BETWEEN 0 AND 100),
    CONSTRAINT billing_policy_service_charge_percent_check CHECK (
        service_charge_percent BETWEEN 0 AND 100
    ),
    CONSTRAINT billing_policy_max_discount_percent_check CHECK (
        max_discount_percent BETWEEN 0 AND 100
    ),
    CONSTRAINT billing_policy_cancellation_fee_check CHECK (cancellation_fee >= 0),
    CONSTRAINT billing_policy_no_show_fee_check CHECK (no_show_fee >= 0),
    CONSTRAINT billing_policy_late_checkout_fee_check CHECK (late_checkout_fee >= 0),
    CONSTRAINT billing_policy_no_show_grace_days_check CHECK (
        no_show_grace_days BETWEEN 1 AND 7
    ),
    CONSTRAINT billing_policy_effective_created_unique UNIQUE (effective_from, created_at),
    CONSTRAINT billing_policy_created_by_fkey FOREIGN KEY (created_by) REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Bring a pre-existing mock table up to the target contract.
ALTER TABLE billing_policy ALTER COLUMN created_at
SET
    DEFAULT clock_timestamp ();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'billing_policy'::regclass
           AND conname = 'billing_policy_uuidv7_check'
    ) THEN
        ALTER TABLE billing_policy ADD CONSTRAINT billing_policy_uuidv7_check
            CHECK ((uuid_extract_version(billing_policy_id) = 7) IS TRUE);
    END IF;
END;
$$;

-- Supports the effective-version lookup's descending ordering.
CREATE INDEX IF NOT EXISTS idx_billing_policy_effective ON billing_policy (
    effective_from DESC,
    created_at DESC,
    billing_policy_id DESC
);

CREATE OR REPLACE FUNCTION billing_policy_before_publish() RETURNS trigger AS $$
DECLARE
    publisher_is_chain_manager boolean;
    publisher_is_system boolean;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('skynest.billing_policy.publish', 0));
    NEW.created_at := clock_timestamp();

    SELECT EXISTS (
        SELECT 1
          FROM user_account ua
          JOIN officer o ON o.officer_id = ua.user_id
          JOIN role r ON r.role_id = o.role_id
         WHERE ua.user_id = NEW.created_by
           AND ua.active
           AND o.active
           AND r.role_name = 'CHAIN_MANAGER'
    ) INTO publisher_is_chain_manager;

    SELECT EXISTS (
        SELECT 1
          FROM user_account ua
         WHERE ua.user_id = NEW.created_by
           AND ua.username = 'system'
           AND ua.password_hash IS NULL
           AND ua.active
    ) INTO publisher_is_system;

    IF NOT (publisher_is_chain_manager OR (publisher_is_system AND NEW.is_demo)) THEN
        RAISE EXCEPTION 'billing_policy publication requires an active CHAIN_MANAGER officer'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER billing_policy_before_publish_trigger
    BEFORE INSERT ON billing_policy
    FOR EACH ROW EXECUTE FUNCTION billing_policy_before_publish();

-- Audits every publication in the same transaction, whichever path inserted it.
CREATE OR REPLACE FUNCTION billing_policy_audit_publish() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (user_id, entity_name, entity_id, action, after_value)
    VALUES (
        NEW.created_by,
        'billing_policy',
        NEW.billing_policy_id::text,
        'PUBLISH',
        to_jsonb(NEW)::text
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER billing_policy_audit_publish_trigger
    AFTER INSERT ON billing_policy
    FOR EACH ROW EXECUTE FUNCTION billing_policy_audit_publish();

-- Append-only: published versions are never edited, deleted or truncated.
CREATE OR REPLACE FUNCTION billing_policy_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'billing_policy is append-only: publish a new version instead'
        USING ERRCODE = '55000';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER billing_policy_append_only_trigger
    BEFORE UPDATE OR DELETE ON billing_policy
    FOR EACH ROW EXECUTE FUNCTION billing_policy_append_only();

CREATE OR REPLACE TRIGGER billing_policy_no_truncate_trigger
    BEFORE TRUNCATE ON billing_policy
    FOR EACH STATEMENT EXECUTE FUNCTION billing_policy_append_only();

-- Demonstration policy (is_demo=true): zero percentages/fees and one grace day.
-- Production lookups exclude demo rows, so production confirmations stay blocked
-- until management publishes approved non-demo values.
INSERT INTO
    billing_policy (
        effective_from,
        tax_percent,
        service_charge_percent,
        max_discount_percent,
        cancellation_fee,
        no_show_fee,
        late_checkout_fee,
        no_show_grace_days,
        is_demo,
        created_by
    )
SELECT DATE '2026-01-01', 0, 0, 0, 0, 0, 0, 1, true, user_id
FROM user_account
WHERE
    username = 'system'
    AND NOT EXISTS (
        SELECT 1
        FROM billing_policy
        WHERE
            is_demo
    );