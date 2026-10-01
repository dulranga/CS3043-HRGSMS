-- M4-S05: Audited DRAFT invoice creation/refresh, single FINAL issuance,
-- shared balance calculation, and booking-confirmation hook.
-- SRS §4.7.4 (Version 1 Billing Policy), §4.8 (Checkout, balance gate, and final issuance)

-- 1. Ensure unique invoice_number for FINAL invoices while allowing NULL in DRAFT
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_number_unique 
    ON invoice (invoice_number) 
 WHERE invoice_number IS NOT NULL;

-- 2. Sequence for generating human-readable sequential invoice numbers
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1001;

-- Function: Generate a unique invoice number (e.g., INV-20261001-01001)
CREATE OR REPLACE FUNCTION fn_generate_invoice_number()
RETURNS varchar(255)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN 'INV-' || to_char(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-' || LPAD(nextval('invoice_number_seq')::text, 5, '0');
END;
$$;

-- 3. Trigger Function: Enforce strict immutability of FINAL invoices
-- Blocks UPDATE or DELETE once invoice status is FINAL.
CREATE OR REPLACE FUNCTION m4_enforce_invoice_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'FINAL' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Cannot delete FINAL invoice %', OLD.invoice_id
                USING ERRCODE = 'object_not_in_prerequisite_state';
        ELSIF TG_OP = 'UPDATE' THEN
            RAISE EXCEPTION 'Cannot modify FINAL invoice %', OLD.invoice_id
                USING ERRCODE = 'object_not_in_prerequisite_state';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_invoice_immutability
BEFORE UPDATE OR DELETE ON invoice
FOR EACH ROW
EXECUTE FUNCTION m4_enforce_invoice_immutability();

-- 4. Trigger Function: Audit invoice creation and status changes into audit_log
CREATE OR REPLACE FUNCTION m4_audit_invoice_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    IF to_regclass('audit_log') IS NOT NULL THEN
        BEGIN
            v_user_id := current_setting('app.current_user_id', true)::uuid;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;

        IF TG_OP = 'INSERT' THEN
            INSERT INTO audit_log (user_id, entity_name, entity_id, action, after_value, changed_at)
            VALUES (
                v_user_id,
                'invoice',
                NEW.invoice_id::text,
                'CREATE',
                json_build_object(
                    'booking_id', NEW.booking_id,
                    'billing_policy_id', NEW.billing_policy_id,
                    'status', NEW.status,
                    'created_at', NEW.created_at
                )::text,
                NEW.created_at
            );
        ELSIF TG_OP = 'UPDATE' AND OLD.status = 'DRAFT' AND NEW.status = 'FINAL' THEN
            INSERT INTO audit_log (user_id, entity_name, entity_id, action, before_value, after_value, changed_at)
            VALUES (
                v_user_id,
                'invoice',
                NEW.invoice_id::text,
                'STATUS_CHANGE',
                json_build_object('status', OLD.status)::text,
                json_build_object(
                    'status', NEW.status,
                    'invoice_number', NEW.invoice_number,
                    'issued_at', NEW.issued_at
                )::text,
                CURRENT_TIMESTAMP
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_invoice
AFTER INSERT OR UPDATE ON invoice
FOR EACH ROW
EXECUTE FUNCTION m4_audit_invoice_event();

-- 5. Function: fn_refresh_draft_invoice_lines
-- Recalculates and replaces invoice lines for a DRAFT invoice using its linked billing policy.
-- Preserves any manual price adjustments (PRICE_ADJUSTMENT).
CREATE OR REPLACE FUNCTION fn_refresh_draft_invoice_lines(
    p_invoice_id uuid,
    p_approved_discount numeric DEFAULT 0.00
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice record;
    v_inserted_count integer := 0;
BEGIN
    SELECT invoice_id, booking_id, status, billing_policy_id 
      INTO v_invoice 
      FROM invoice 
     WHERE invoice_id = p_invoice_id;

    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice % not found', p_invoice_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF v_invoice.status = 'FINAL' THEN
        RAISE EXCEPTION 'Invoice % is FINAL. Cannot refresh lines.', p_invoice_id
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Remove previously generated auto lines (preserving explicit manual price adjustments)
    DELETE FROM invoice_line 
     WHERE invoice_id = p_invoice_id 
       AND line_type != 'PRICE_ADJUSTMENT';

    -- Insert refreshed lines from fn_calculate_booking_invoice_lines
    INSERT INTO invoice_line (invoice_id, line_type, booking_room_line_id, description, amount)
    SELECT p_invoice_id, line_type, booking_room_line_id, description, amount
      FROM fn_calculate_booking_invoice_lines(v_invoice.booking_id, p_approved_discount)
     ORDER BY sort_order;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    RETURN v_inserted_count;
END;
$$;

-- 6. Booking Confirmation Hook for Member 2: fn_create_booking_draft_invoice
-- Selects effective billing policy at confirmation, creates DRAFT invoice, and populates initial lines.
-- Idempotent / retry safe: returns existing invoice_id if already created in DRAFT.
-- Fails with rollback if no applicable policy exists.
CREATE OR REPLACE FUNCTION fn_create_booking_draft_invoice(
    p_booking_id uuid,
    p_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_id uuid;
    v_existing_status invoice_status_enum;
    v_policy_id uuid;
    v_invoice_id uuid;
BEGIN
    -- 1. Check if invoice already exists for this booking
    SELECT invoice_id, status 
      INTO v_existing_id, v_existing_status
      FROM invoice
     WHERE booking_id = p_booking_id;

    IF FOUND THEN
        IF v_existing_status = 'FINAL' THEN
            RAISE EXCEPTION 'Invoice for booking % is already FINAL', p_booking_id
                USING ERRCODE = 'object_not_in_prerequisite_state';
        END IF;
        -- Idempotent retry: refresh draft lines and return existing invoice ID
        PERFORM fn_refresh_draft_invoice_lines(v_existing_id);
        RETURN v_existing_id;
    END IF;

    -- 2. Select effective billing policy version
    -- Ordered descending by (effective_from, created_at, billing_policy_id) where effective_from <= CURRENT_DATE
    SELECT billing_policy_id
      INTO v_policy_id
      FROM billing_policy
     WHERE effective_from <= CURRENT_DATE
       AND created_at <= CURRENT_TIMESTAMP
     ORDER BY effective_from DESC, created_at DESC, billing_policy_id DESC
     LIMIT 1;

    IF v_policy_id IS NULL THEN
        RAISE EXCEPTION 'No applicable billing policy found for confirmation date %', CURRENT_DATE
            USING ERRCODE = 'data_exception';
    END IF;

    -- 3. Optionally set current user for audit trigger
    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id::text, true);
    END IF;

    -- 4. Create DRAFT invoice row linked to effective policy
    INSERT INTO invoice (booking_id, billing_policy_id, status)
    VALUES (p_booking_id, v_policy_id, 'DRAFT')
    RETURNING invoice_id INTO v_invoice_id;

    -- 5. Populate initial invoice lines
    PERFORM fn_refresh_draft_invoice_lines(v_invoice_id);

    RETURN v_invoice_id;
END;
$$;

-- 7. Function: fn_refresh_draft_invoice
-- Refresh draft invoice lines by booking_id
CREATE OR REPLACE FUNCTION fn_refresh_draft_invoice(
    p_booking_id uuid,
    p_user_id uuid DEFAULT NULL,
    p_approved_discount numeric DEFAULT 0.00
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice_id uuid;
BEGIN
    SELECT invoice_id INTO v_invoice_id
      FROM invoice
     WHERE booking_id = p_booking_id;

    IF v_invoice_id IS NULL THEN
        RAISE EXCEPTION 'No invoice found for booking %', p_booking_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id::text, true);
    END IF;

    PERFORM fn_refresh_draft_invoice_lines(v_invoice_id, p_approved_discount);
    RETURN v_invoice_id;
END;
$$;

-- 8. Function: fn_booking_balance
-- Shared balance calculation per SRS §4.7.4, §4.8.3, and M4-S07:
-- invoice total amount - successful payments + successful refunds (failed/reversed excluded).
CREATE OR REPLACE FUNCTION fn_booking_balance(p_booking_id uuid)
RETURNS TABLE (
    invoice_id uuid,
    status invoice_status_enum,
    total_amount numeric(14, 2),
    successful_payments numeric(14, 2),
    successful_refunds numeric(14, 2),
    net_paid numeric(14, 2),
    balance numeric(14, 2),
    is_settled boolean
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_inv_id uuid;
    v_status invoice_status_enum;
    v_total numeric(14, 2) := 0.00;
    v_payments numeric(14, 2) := 0.00;
    v_refunds numeric(14, 2) := 0.00;
    v_net numeric(14, 2) := 0.00;
    v_bal numeric(14, 2) := 0.00;
BEGIN
    SELECT i.invoice_id, i.status 
      INTO v_inv_id, v_status
      FROM invoice i
     WHERE i.booking_id = p_booking_id;

    IF v_inv_id IS NOT NULL THEN
        SELECT COALESCE(SUM(il.amount), 0.00)
          INTO v_total
          FROM invoice_line il
         WHERE il.invoice_id = v_inv_id;
    END IF;

    SELECT 
        COALESCE(SUM(CASE WHEN p.kind = 'PAYMENT' THEN p.amount ELSE 0 END), 0.00),
        COALESCE(SUM(CASE WHEN p.kind = 'REFUND' THEN p.amount ELSE 0 END), 0.00)
      INTO v_payments, v_refunds
      FROM payment p
     WHERE p.booking_id = p_booking_id
       AND p.status = 'SUCCESSFUL';

    v_net := v_payments - v_refunds;
    v_bal := v_total - v_net;

    RETURN QUERY SELECT 
        v_inv_id,
        v_status,
        v_total,
        v_payments,
        v_refunds,
        v_net,
        v_bal,
        (v_bal = 0.00);
END;
$$;

-- 9. Function: fn_issue_final_invoice
-- Transitions DRAFT invoice to FINAL only when:
-- 1. All room lines of the booking are terminal (CHECKED_OUT, CANCELLED, NO_SHOW).
--    Partial checkout keeps the invoice in DRAFT.
-- 2. All charges are refreshed and recorded.
-- 3. Consolidated balance is exactly zero (0.00). Unsettled debt or unrefunded credit blocks finalization.
CREATE OR REPLACE FUNCTION fn_issue_final_invoice(
    p_booking_id uuid,
    p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    invoice_id uuid,
    invoice_number varchar(255),
    status invoice_status_enum,
    issued_at timestamptz,
    total_amount numeric(14, 2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice record;
    v_non_terminal_count integer;
    v_total_line_count integer;
    v_bal record;
    v_new_inv_num varchar(255);
    v_issued_time timestamptz;
BEGIN
    -- 1. Lock invoice row for update
    SELECT * INTO v_invoice
      FROM invoice
     WHERE booking_id = p_booking_id
       FOR UPDATE;

    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'No invoice found for booking %', p_booking_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF v_invoice.status = 'FINAL' THEN
        RAISE EXCEPTION 'Invoice for booking % is already FINAL (invoice_number: %)', p_booking_id, v_invoice.invoice_number
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- 2. Check room line terminals:
    -- Every booking room line must be CHECKED_OUT, CANCELLED, or NO_SHOW
    SELECT count(*),
           count(*) FILTER (WHERE bl.status NOT IN ('CHECKED_OUT', 'CANCELLED', 'NO_SHOW'))
      INTO v_total_line_count, v_non_terminal_count
      FROM booking_room_line bl
     WHERE bl.booking_id = p_booking_id;

    IF v_total_line_count = 0 THEN
        RAISE EXCEPTION 'Cannot finalize invoice: booking % has no room lines', p_booking_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_non_terminal_count > 0 THEN
        RAISE EXCEPTION 'Cannot finalize invoice: booking % has % active/non-terminal room line(s). Partial checkout keeps invoice in DRAFT.', p_booking_id, v_non_terminal_count
            USING ERRCODE = 'check_violation';
    END IF;

    -- 3. Refresh draft invoice to ensure all charges are recorded
    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id::text, true);
    END IF;
    PERFORM fn_refresh_draft_invoice_lines(v_invoice.invoice_id);

    -- 4. Check shared balance: must be exactly zero
    SELECT * INTO v_bal FROM fn_booking_balance(p_booking_id);

    IF v_bal.balance > 0.00 THEN
        RAISE EXCEPTION 'Cannot finalize invoice: outstanding balance of % LKR must be settled first', v_bal.balance
            USING ERRCODE = 'check_violation';
    ELSIF v_bal.balance < 0.00 THEN
        RAISE EXCEPTION 'Cannot finalize invoice: credit balance of % LKR must be refunded first', (-v_bal.balance)
            USING ERRCODE = 'check_violation';
    END IF;

    -- 5. Issue single FINAL invoice
    v_new_inv_num := fn_generate_invoice_number();
    v_issued_time := CURRENT_TIMESTAMP;

    UPDATE invoice
       SET status = 'FINAL',
           invoice_number = v_new_inv_num,
           issued_at = v_issued_time
     WHERE invoice.invoice_id = v_invoice.invoice_id;

    RETURN QUERY SELECT 
        v_invoice.invoice_id,
        v_new_inv_num,
        'FINAL'::invoice_status_enum,
        v_issued_time,
        v_bal.total_amount;
END;
$$;
