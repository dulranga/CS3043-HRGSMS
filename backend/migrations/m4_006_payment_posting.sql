-- M4-S07: Locked Payment and Refund Posting
-- SRS Table 40, Table 44 (DBR-016), Table 45 (sp_record_payment, fn_outstanding_balance), §4.7.3, §4.7.4

-- 1. Helper function: fn_outstanding_balance
-- Returns signed invoice-line total minus successful payments plus successful refunds.
-- Negative value indicates credit.
CREATE OR REPLACE FUNCTION fn_outstanding_balance(p_booking_id uuid)
RETURNS numeric(14, 2)
LANGUAGE sql
STABLE
AS $$
    SELECT balance FROM fn_booking_balance(p_booking_id);
$$;

CREATE OR REPLACE FUNCTION fn_outstanding_balance(p_booking_id text)
RETURNS numeric(14, 2)
LANGUAGE sql
STABLE
AS $$
    SELECT balance FROM fn_booking_balance(p_booking_id::uuid);
$$;

-- 2. Core transactional function: fn_record_payment
-- Enforces row-level lock order (booking -> invoice), re-evaluates authoritative balance under lock,
-- enforces that payment cannot exceed positive balance, and refund cannot exceed existing credit.
CREATE OR REPLACE FUNCTION fn_record_payment(
    p_booking_id uuid,
    p_recorded_by uuid,
    p_kind payment_kind_enum,
    p_amount numeric,
    p_method payment_method_enum,
    p_reference varchar,
    p_status payment_status_enum DEFAULT 'SUCCESSFUL',
    p_paid_at timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS TABLE (
    payment_id uuid,
    booking_id uuid,
    recorded_by uuid,
    kind payment_kind_enum,
    amount numeric(14, 2),
    status payment_status_enum,
    method payment_method_enum,
    reference varchar(255),
    paid_at timestamptz,
    recorded_at timestamptz,
    previous_balance numeric(14, 2),
    new_balance numeric(14, 2),
    is_credit boolean,
    credit_amount numeric(14, 2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking record;
    v_invoice record;
    v_user record;
    v_amount_2dec numeric(14, 2);
    v_total_amount numeric(14, 2) := 0.00;
    v_successful_payments numeric(14, 2) := 0.00;
    v_successful_refunds numeric(14, 2) := 0.00;
    v_net_paid numeric(14, 2) := 0.00;
    v_current_balance numeric(14, 2) := 0.00;
    v_new_balance numeric(14, 2) := 0.00;
    v_credit_available numeric(14, 2) := 0.00;
    v_payment_id uuid;
    v_paid_at timestamptz;
    v_recorded_at timestamptz;
    v_is_credit boolean;
    v_credit_amount numeric(14, 2);
BEGIN
    -- 1. Input validations
    IF p_booking_id IS NULL THEN
        RAISE EXCEPTION 'booking_id cannot be null'
            USING ERRCODE = '23502'; -- not_null_violation
    END IF;

    IF p_recorded_by IS NULL THEN
        RAISE EXCEPTION 'recorded_by cannot be null'
            USING ERRCODE = '23502';
    END IF;

    IF p_kind IS NULL THEN
        RAISE EXCEPTION 'payment kind cannot be null'
            USING ERRCODE = '23502';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 OR p_amount = 'NaN'::numeric THEN
        RAISE EXCEPTION 'Payment amount must be a positive number (got %)', p_amount
            USING ERRCODE = '23514'; -- check_violation
    END IF;

    v_amount_2dec := ROUND(p_amount, 2);
    IF p_amount <> v_amount_2dec THEN
        RAISE EXCEPTION 'Payment amount % cannot exceed 2 decimal places', p_amount
            USING ERRCODE = '23514';
    END IF;

    IF p_reference IS NULL OR btrim(p_reference) = '' THEN
        RAISE EXCEPTION 'Payment reference cannot be empty or blank'
            USING ERRCODE = '23514';
    END IF;

    IF p_status NOT IN ('SUCCESSFUL', 'FAILED') THEN
        RAISE EXCEPTION 'Initial payment status must be SUCCESSFUL or FAILED (got %)', p_status
            USING ERRCODE = '23514';
    END IF;

    -- Verify recording user exists
    SELECT user_id INTO v_user
      FROM user_account
     WHERE user_id = p_recorded_by;

    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Recording user % does not exist in user_account', p_recorded_by
            USING ERRCODE = '23503'; -- foreign_key_violation
    END IF;

    -- 2. Lock rows in consistent hierarchy: booking -> invoice (ACID Pessimistic Concurrency)
    SELECT b.booking_id INTO v_booking
      FROM booking b
     WHERE b.booking_id = p_booking_id
       FOR UPDATE;

    IF v_booking IS NULL THEN
        RAISE EXCEPTION 'Booking % not found', p_booking_id
            USING ERRCODE = '02000'; -- no_data_found
    END IF;

    SELECT i.invoice_id, i.status INTO v_invoice
      FROM invoice i
     WHERE i.booking_id = p_booking_id
       FOR UPDATE;

    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'No invoice found for booking %', p_booking_id
            USING ERRCODE = '02000';
    END IF;

    IF v_invoice.status = 'FINAL' THEN
        RAISE EXCEPTION 'Invoice % is FINAL. Posting payments or refunds is prohibited.', v_invoice.invoice_id
            USING ERRCODE = '55000'; -- object_not_in_prerequisite_state
    END IF;

    -- 3. Calculate authoritative current balance under lock
    SELECT COALESCE(SUM(il.amount), 0.00)
      INTO v_total_amount
      FROM invoice_line il
     WHERE il.invoice_id = v_invoice.invoice_id;

    SELECT 
        COALESCE(SUM(CASE WHEN p.kind = 'PAYMENT' THEN p.amount ELSE 0 END), 0.00),
        COALESCE(SUM(CASE WHEN p.kind = 'REFUND' THEN p.amount ELSE 0 END), 0.00)
      INTO v_successful_payments, v_successful_refunds
      FROM payment p
     WHERE p.booking_id = p_booking_id
       AND p.status = 'SUCCESSFUL';

    v_net_paid := v_successful_payments - v_successful_refunds;
    v_current_balance := v_total_amount - v_net_paid;

    -- 4. Evaluate business rules for SUCCESSFUL transactions
    IF p_status = 'SUCCESSFUL' THEN
        IF p_kind = 'PAYMENT' THEN
            -- Payment cannot be posted if no positive balance is due
            IF v_current_balance <= 0.00 THEN
                RAISE EXCEPTION 'Cannot post payment of %: booking has no positive balance due (current balance: %)',
                    v_amount_2dec, v_current_balance
                    USING ERRCODE = '23514';
            END IF;

            -- Payment cannot exceed the current positive balance
            IF v_amount_2dec > v_current_balance THEN
                RAISE EXCEPTION 'Payment amount of % exceeds current outstanding balance of %',
                    v_amount_2dec, v_current_balance
                    USING ERRCODE = '23514';
            END IF;

            v_new_balance := v_current_balance - v_amount_2dec;

        ELSIF p_kind = 'REFUND' THEN
            -- Refund can only be posted if there is an existing credit (negative balance)
            IF v_current_balance >= 0.00 THEN
                RAISE EXCEPTION 'Cannot post refund of %: booking has no credit balance to refund (current balance: %)',
                    v_amount_2dec, v_current_balance
                    USING ERRCODE = '23514';
            END IF;

            v_credit_available := -v_current_balance; -- positive number representing available credit

            -- Refund cannot exceed the available credit
            IF v_amount_2dec > v_credit_available THEN
                RAISE EXCEPTION 'Refund amount of % exceeds available credit of %',
                    v_amount_2dec, v_credit_available
                    USING ERRCODE = '23514';
            END IF;

            v_new_balance := v_current_balance + v_amount_2dec;
        END IF;
    ELSE
        -- FAILED records do not change balance
        v_new_balance := v_current_balance;
    END IF;

    -- 5. Insert payment record (will trigger audit logging and immutability checks)
    INSERT INTO payment (
        booking_id,
        recorded_by,
        kind,
        amount,
        method,
        status,
        reference,
        paid_at,
        recorded_at
    ) VALUES (
        p_booking_id,
        p_recorded_by,
        p_kind,
        v_amount_2dec,
        p_method,
        p_status,
        btrim(p_reference),
        COALESCE(p_paid_at, CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP
    )
    RETURNING payment.payment_id, payment.paid_at, payment.recorded_at
      INTO v_payment_id, v_paid_at, v_recorded_at;

    -- 6. Derive credit status of new balance
    v_is_credit := (v_new_balance < 0.00);
    v_credit_amount := CASE WHEN v_new_balance < 0.00 THEN -v_new_balance ELSE 0.00 END;

    RETURN QUERY SELECT
        p.payment_id,
        p.booking_id,
        p.recorded_by,
        p.kind,
        p.amount,
        p.status,
        p.method,
        p.reference,
        p.paid_at,
        p.recorded_at,
        v_current_balance,
        v_new_balance,
        v_is_credit,
        v_credit_amount
      FROM payment p
     WHERE p.payment_id = v_payment_id;
END;
$$;

-- 3. Procedure: sp_record_payment per SRS Table 45
CREATE OR REPLACE PROCEDURE sp_record_payment(
    p_booking_id uuid,
    p_recorded_by uuid,
    p_kind payment_kind_enum,
    p_amount numeric,
    p_method payment_method_enum,
    p_reference varchar,
    INOUT p_payment_id uuid DEFAULT NULL,
    p_status payment_status_enum DEFAULT 'SUCCESSFUL',
    p_paid_at timestamptz DEFAULT CURRENT_TIMESTAMP
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_res record;
BEGIN
    SELECT * INTO v_res FROM fn_record_payment(
        p_booking_id,
        p_recorded_by,
        p_kind,
        p_amount,
        p_method,
        p_reference,
        p_status,
        p_paid_at
    );
    p_payment_id := v_res.payment_id;
END;
$$;

-- 4. Function: fn_reverse_payment
-- Transitions a SUCCESSFUL payment to REVERSED under locks and recalculates balance.
CREATE OR REPLACE FUNCTION fn_reverse_payment(
    p_payment_id uuid,
    p_user_id uuid
)
RETURNS TABLE (
    payment_id uuid,
    booking_id uuid,
    kind payment_kind_enum,
    amount numeric(14, 2),
    status payment_status_enum,
    reference varchar(255),
    previous_balance numeric(14, 2),
    new_balance numeric(14, 2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_payment record;
    v_booking record;
    v_invoice record;
    v_prev_bal numeric(14, 2);
    v_new_bal numeric(14, 2);
BEGIN
    SELECT * INTO v_payment
      FROM payment
     WHERE payment.payment_id = p_payment_id
       FOR UPDATE;

    IF v_payment IS NULL THEN
        RAISE EXCEPTION 'Payment % not found', p_payment_id
            USING ERRCODE = '02000';
    END IF;

    IF v_payment.status <> 'SUCCESSFUL' THEN
        RAISE EXCEPTION 'Only SUCCESSFUL payments can be reversed (current status: %)', v_payment.status
            USING ERRCODE = '55000';
    END IF;

    SELECT b.booking_id INTO v_booking
      FROM booking b
     WHERE b.booking_id = v_payment.booking_id
       FOR UPDATE;

    SELECT i.invoice_id, i.status INTO v_invoice
      FROM invoice i
     WHERE i.booking_id = v_payment.booking_id
       FOR UPDATE;

    IF v_invoice.status = 'FINAL' THEN
        RAISE EXCEPTION 'Invoice % is FINAL. Payment reversal is prohibited.', v_invoice.invoice_id
            USING ERRCODE = '55000';
    END IF;

    v_prev_bal := fn_outstanding_balance(v_payment.booking_id);

    UPDATE payment
       SET status = 'REVERSED'
     WHERE payment.payment_id = p_payment_id;

    v_new_bal := fn_outstanding_balance(v_payment.booking_id);

    RETURN QUERY SELECT
        p.payment_id,
        p.booking_id,
        p.kind,
        p.amount,
        p.status,
        p.reference,
        v_prev_bal,
        v_new_bal
      FROM payment p
     WHERE p.payment_id = p_payment_id;
END;
$$;
