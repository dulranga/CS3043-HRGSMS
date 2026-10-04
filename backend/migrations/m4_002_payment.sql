-- M4-S03: Payment and Refund schema
-- SRS Table 40, §4.7.3 (FR-053 - FR-057), §4.7.4, §6.1.4

CREATE TYPE payment_kind_enum AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE payment_status_enum AS ENUM ('SUCCESSFUL', 'FAILED', 'REVERSED');
CREATE TYPE payment_method_enum AS ENUM ('CASH', 'BANK_TRANSFER');

CREATE TABLE payment (
    payment_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_id uuid NOT NULL,
    recorded_by uuid NOT NULL,
    kind payment_kind_enum NOT NULL,
    amount numeric(14, 2) NOT NULL,
    method payment_method_enum NOT NULL,
    status payment_status_enum NOT NULL DEFAULT 'SUCCESSFUL',
    reference varchar(255) NOT NULL,
    paid_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payment_uuidv7_check
        CHECK ((uuid_extract_version(payment_id) = 7) IS TRUE),
    CONSTRAINT payment_amount_positive_check
        CHECK (amount > 0 AND amount <> 'NaN'::numeric),
    CONSTRAINT payment_reference_check
        CHECK (btrim(reference) <> ''),
    CONSTRAINT payment_reference_unique
        UNIQUE (reference),
    CONSTRAINT payment_booking_fkey FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT payment_recorded_by_fkey FOREIGN KEY (recorded_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_payment_booking_id ON payment (booking_id);
CREATE INDEX idx_payment_recorded_by ON payment (recorded_by);

-- Trigger: Enforce payment record immutability and restricted transitions
-- Financial records cannot be deleted or have their critical fields mutated.
-- The only allowed status transition is from SUCCESSFUL to REVERSED.
CREATE OR REPLACE FUNCTION m4_enforce_payment_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payments are financial records and cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Only status transition from SUCCESSFUL to REVERSED is permitted
        IF OLD.status <> 'SUCCESSFUL' OR NEW.status <> 'REVERSED' THEN
            RAISE EXCEPTION 'Invalid payment status transition from % to %', OLD.status, NEW.status
            USING ERRCODE = 'object_not_in_prerequisite_state';
        END IF;

        -- Immutable columns must not change
        IF NEW.payment_id <> OLD.payment_id OR
           NEW.booking_id <> OLD.booking_id OR
           NEW.amount <> OLD.amount OR
           NEW.kind <> OLD.kind OR
           NEW.method <> OLD.method OR
           NEW.reference <> OLD.reference OR
           NEW.paid_at <> OLD.paid_at OR
           NEW.recorded_at <> OLD.recorded_at THEN
            RAISE EXCEPTION 'Payment attributes (payment_id, booking_id, amount, kind, method, reference, paid_at, recorded_at) are immutable'
            USING ERRCODE = 'restrict_violation';
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_payment_immutability
BEFORE UPDATE OR DELETE ON payment
FOR EACH ROW
EXECUTE FUNCTION m4_enforce_payment_immutability();

-- Trigger: Audit payment events (creation and reversal) to audit_log if available
CREATE OR REPLACE FUNCTION m4_audit_payment_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF to_regclass('audit_log') IS NOT NULL THEN
        IF TG_OP = 'INSERT' THEN
            INSERT INTO audit_log (user_id, entity_name, entity_id, action, after_value, changed_at)
            VALUES (
                NEW.recorded_by,
                'payment',
                NEW.payment_id::text,
                'CREATE',
                json_build_object(
                    'kind', NEW.kind,
                    'amount', NEW.amount,
                    'status', NEW.status,
                    'method', NEW.method,
                    'reference', NEW.reference,
                    'paid_at', NEW.paid_at
                )::text,
                NEW.recorded_at
            );
        ELSIF TG_OP = 'UPDATE' THEN
            INSERT INTO audit_log (user_id, entity_name, entity_id, action, before_value, after_value, changed_at)
            VALUES (
                NEW.recorded_by,
                'payment',
                NEW.payment_id::text,
                'REVERSE',
                json_build_object('status', OLD.status)::text,
                json_build_object('status', NEW.status)::text,
                CURRENT_TIMESTAMP
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_payment
AFTER INSERT OR UPDATE ON payment
FOR EACH ROW
EXECUTE FUNCTION m4_audit_payment_event();
