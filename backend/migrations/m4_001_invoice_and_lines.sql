-- M4-S02: Invoice and Invoice Line schema

CREATE TYPE invoice_status_enum AS ENUM ('DRAFT', 'FINAL');
CREATE TYPE invoice_line_type_enum AS ENUM (
    'ROOM', 
    'SERVICE', 
    'DISCOUNT', 
    'PERCENT_SERVICE_CHARGE', 
    'TAX', 
    'CANCELLATION_FEE', 
    'NO_SHOW_FEE', 
    'LATE_CHECKOUT_FEE', 
    'PRICE_ADJUSTMENT'
);

CREATE TABLE invoice (
    invoice_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_id uuid NOT NULL,
    billing_policy_id uuid NOT NULL,
    invoice_number varchar(255),
    status invoice_status_enum NOT NULL DEFAULT 'DRAFT',
    issued_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT invoice_uuidv7_check
        CHECK ((uuid_extract_version(invoice_id) = 7) IS TRUE),
    CONSTRAINT invoice_booking_id_unique UNIQUE (booking_id),
    CONSTRAINT invoice_status_checks CHECK (
        (status = 'DRAFT' AND invoice_number IS NULL AND issued_at IS NULL)
        OR (status = 'FINAL' AND invoice_number IS NOT NULL AND issued_at IS NOT NULL)
    ),
    CONSTRAINT invoice_booking_fkey FOREIGN KEY (booking_id) 
        REFERENCES booking (booking_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT invoice_billing_policy_fkey FOREIGN KEY (billing_policy_id) 
        REFERENCES billing_policy (billing_policy_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Note: We avoid adding a `total_amount` column, as the SRS explicitly states totals derive from lines.

CREATE TABLE invoice_line (
    invoice_line_id uuid PRIMARY KEY DEFAULT uuidv7(),
    invoice_id uuid NOT NULL,
    line_type invoice_line_type_enum NOT NULL,
    booking_room_line_id uuid,
    description varchar(255) NOT NULL,
    amount numeric(14,2) NOT NULL,
    CONSTRAINT invoice_line_uuidv7_check
        CHECK ((uuid_extract_version(invoice_line_id) = 7) IS TRUE),
    CONSTRAINT invoice_line_amount_sign_check CHECK (
        (line_type = 'DISCOUNT' AND amount <= 0) 
        OR (line_type IN ('ROOM', 'SERVICE', 'PERCENT_SERVICE_CHARGE', 'TAX', 'CANCELLATION_FEE', 'NO_SHOW_FEE', 'LATE_CHECKOUT_FEE') AND amount >= 0)
        OR (line_type = 'PRICE_ADJUSTMENT') -- Can be anything (signed)
    ),
    CONSTRAINT invoice_line_attribution_check CHECK (
        (line_type IN ('ROOM', 'CANCELLATION_FEE', 'NO_SHOW_FEE', 'LATE_CHECKOUT_FEE') AND booking_room_line_id IS NOT NULL)
        OR (line_type IN ('DISCOUNT', 'PERCENT_SERVICE_CHARGE', 'TAX') AND booking_room_line_id IS NULL)
        OR (line_type IN ('SERVICE', 'PRICE_ADJUSTMENT')) -- Can be either
    ),
    CONSTRAINT invoice_line_invoice_fkey FOREIGN KEY (invoice_id) 
        REFERENCES invoice (invoice_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT invoice_line_room_line_fkey FOREIGN KEY (booking_room_line_id) 
        REFERENCES booking_room_line (line_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Trigger: Ensure any linked room line belongs to the same booking as the invoice
CREATE OR REPLACE FUNCTION m4_check_cross_booking_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice_booking_id uuid;
    v_line_booking_id uuid;
BEGIN
    IF NEW.booking_room_line_id IS NOT NULL THEN
        -- Get booking_id from invoice
        SELECT booking_id INTO v_invoice_booking_id
        FROM invoice WHERE invoice_id = NEW.invoice_id;
        
        -- Get booking_id from room_line
        SELECT booking_id INTO v_line_booking_id
        FROM booking_room_line WHERE line_id = NEW.booking_room_line_id;

        IF v_invoice_booking_id != v_line_booking_id THEN
            RAISE EXCEPTION 'booking_room_line_id % does not belong to the same booking as invoice %', NEW.booking_room_line_id, NEW.invoice_id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_cross_booking_line
BEFORE INSERT OR UPDATE ON invoice_line
FOR EACH ROW
EXECUTE FUNCTION m4_check_cross_booking_line();


-- Trigger: Immutable FINAL lines (do not allow adding, updating, or deleting lines for a FINAL invoice)
CREATE OR REPLACE FUNCTION m4_reject_final_invoice_edits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_status invoice_status_enum;
BEGIN
    -- Depending on operation, grab the relevant invoice_id
    IF TG_OP = 'DELETE' THEN
        SELECT status INTO v_status FROM invoice WHERE invoice_id = OLD.invoice_id;
    ELSE
        SELECT status INTO v_status FROM invoice WHERE invoice_id = NEW.invoice_id;
    END IF;

    IF v_status = 'FINAL' THEN
        RAISE EXCEPTION 'Invoice is FINAL. No changes to invoice lines are permitted.'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reject_final_invoice_edits
BEFORE INSERT OR UPDATE OR DELETE ON invoice_line
FOR EACH ROW
EXECUTE FUNCTION m4_reject_final_invoice_edits();
