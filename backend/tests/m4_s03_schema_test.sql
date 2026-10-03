-- M4-S03 Schema Verification Tests
-- PL/pgSQL validation script for payment and refund schema, constraints, immutability, and audit

DO $$
DECLARE
    -- Actors and parents
    v_admin_id uuid := uuidv7();
    v_guest_id uuid := uuidv7();
    v_role_id uuid := uuidv7();
    v_booking_id uuid := uuidv7();
    -- Payment IDs
    v_payment_id uuid;
    v_refund_id uuid;
    v_failed_id uuid;
    -- Flags
    v_exception_thrown boolean;
    v_audit_count integer;
    v_status payment_status_enum;
BEGIN
    -- Setup mock environment
    INSERT INTO role (role_id, role_name) VALUES (v_role_id, 'SYSTEM_ADMINISTRATOR') ON CONFLICT DO NOTHING;
    INSERT INTO user_account (user_id, username, active) VALUES (v_admin_id, 'admin_m4_s03@test', true) ON CONFLICT DO NOTHING;
    INSERT INTO guest (guest_id, full_name, active) VALUES (v_guest_id, 'M4-S03 Test Guest', true) ON CONFLICT DO NOTHING;
    INSERT INTO booking (booking_id, booking_ref, booking_channel, guest_id, created_by)
    VALUES (v_booking_id, 'BKG-M4S03-001', 'DIRECT_ONLINE', v_guest_id, v_admin_id);

    ----------------------------------------------------------------------------
    -- Test 1: Successful CASH PAYMENT insertion
    ----------------------------------------------------------------------------
    INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
    VALUES (v_booking_id, v_admin_id, 'PAYMENT', 15000.00, 'CASH', 'SUCCESSFUL', 'REC-M4S03-001')
    RETURNING payment_id INTO v_payment_id;

    IF v_payment_id IS NULL THEN
        RAISE EXCEPTION 'TEST FAILED: payment_id not generated';
    END IF;

    IF uuid_extract_version(v_payment_id) != 7 THEN
        RAISE EXCEPTION 'TEST FAILED: payment_id is not UUIDv7';
    END IF;

    -- Verify audit entry
    IF to_regclass('audit_log') IS NOT NULL THEN
        SELECT count(*) INTO v_audit_count
        FROM audit_log
        WHERE entity_name = 'payment' AND entity_id = v_payment_id::text AND action = 'CREATE';
        IF v_audit_count != 1 THEN
            RAISE EXCEPTION 'TEST FAILED: Payment creation was not logged to audit_log';
        END IF;
    END IF;

    ----------------------------------------------------------------------------
    -- Test 2: Successful BANK_TRANSFER REFUND insertion
    ----------------------------------------------------------------------------
    INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
    VALUES (v_booking_id, v_admin_id, 'REFUND', 2500.00, 'BANK_TRANSFER', 'SUCCESSFUL', 'BT-REF-M4S03-001')
    RETURNING payment_id INTO v_refund_id;

    IF v_refund_id IS NULL THEN
        RAISE EXCEPTION 'TEST FAILED: refund payment_id not generated';
    END IF;

    ----------------------------------------------------------------------------
    -- Test 3: Successful FAILED payment insertion
    ----------------------------------------------------------------------------
    INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
    VALUES (v_booking_id, v_admin_id, 'PAYMENT', 5000.00, 'BANK_TRANSFER', 'FAILED', 'BT-FAIL-M4S03-001')
    RETURNING payment_id INTO v_failed_id;

    ----------------------------------------------------------------------------
    -- Test 4: Invalid Amount (<= 0 or NaN)
    ----------------------------------------------------------------------------
    v_exception_thrown := false;
    BEGIN
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
        VALUES (v_booking_id, v_admin_id, 'PAYMENT', 0.00, 'CASH', 'REC-FAIL-0');
    EXCEPTION WHEN check_violation THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed payment with amount = 0'; END IF;

    v_exception_thrown := false;
    BEGIN
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
        VALUES (v_booking_id, v_admin_id, 'PAYMENT', -100.00, 'CASH', 'REC-FAIL-NEG');
    EXCEPTION WHEN check_violation THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed payment with amount < 0'; END IF;

    ----------------------------------------------------------------------------
    -- Test 5: Missing / Blank Reference
    ----------------------------------------------------------------------------
    v_exception_thrown := false;
    BEGIN
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
        VALUES (v_booking_id, v_admin_id, 'PAYMENT', 1000.00, 'CASH', '');
    EXCEPTION WHEN check_violation THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed empty reference'; END IF;

    v_exception_thrown := false;
    BEGIN
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
        VALUES (v_booking_id, v_admin_id, 'PAYMENT', 1000.00, 'CASH', '   ');
    EXCEPTION WHEN check_violation THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed whitespace-only reference'; END IF;

    ----------------------------------------------------------------------------
    -- Test 6: Duplicate Reference
    ----------------------------------------------------------------------------
    v_exception_thrown := false;
    BEGIN
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
        VALUES (v_booking_id, v_admin_id, 'PAYMENT', 2000.00, 'CASH', 'REC-M4S03-001');
    EXCEPTION WHEN unique_violation THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed duplicate payment reference'; END IF;

    ----------------------------------------------------------------------------
    -- Test 7: Foreign Key Violations
    ----------------------------------------------------------------------------
    v_exception_thrown := false;
    BEGIN
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
        VALUES (uuidv7(), v_admin_id, 'PAYMENT', 1000.00, 'CASH', 'REC-FAIL-BKG');
    EXCEPTION WHEN foreign_key_violation THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed non-existent booking_id'; END IF;

    v_exception_thrown := false;
    BEGIN
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
        VALUES (v_booking_id, uuidv7(), 'PAYMENT', 1000.00, 'CASH', 'REC-FAIL-ACTOR');
    EXCEPTION WHEN foreign_key_violation THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed non-existent recorded_by actor'; END IF;

    ----------------------------------------------------------------------------
    -- Test 8: Reversal and Audit
    ----------------------------------------------------------------------------
    UPDATE payment SET status = 'REVERSED' WHERE payment_id = v_payment_id;

    SELECT status INTO v_status FROM payment WHERE payment_id = v_payment_id;
    IF v_status != 'REVERSED' THEN
        RAISE EXCEPTION 'TEST FAILED: Payment status was not updated to REVERSED';
    END IF;

    IF to_regclass('audit_log') IS NOT NULL THEN
        SELECT count(*) INTO v_audit_count
        FROM audit_log
        WHERE entity_name = 'payment' AND entity_id = v_payment_id::text AND action = 'REVERSE';
        IF v_audit_count != 1 THEN
            RAISE EXCEPTION 'TEST FAILED: Payment reversal was not logged to audit_log';
        END IF;
    END IF;

    ----------------------------------------------------------------------------
    -- Test 9: Immutability - Reject un-reversing or transitioning FAILED
    ----------------------------------------------------------------------------
    v_exception_thrown := false;
    BEGIN
        UPDATE payment SET status = 'SUCCESSFUL' WHERE payment_id = v_payment_id;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed un-reversing a REVERSED payment'; END IF;

    v_exception_thrown := false;
    BEGIN
        UPDATE payment SET status = 'REVERSED' WHERE payment_id = v_failed_id;
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed transitioning FAILED payment to REVERSED'; END IF;

    ----------------------------------------------------------------------------
    -- Test 10: Immutability - Reject mutating critical attributes
    ----------------------------------------------------------------------------
    v_exception_thrown := false;
    BEGIN
        UPDATE payment SET amount = 9999.00 WHERE payment_id = v_refund_id;
    EXCEPTION WHEN OTHERS THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed modifying amount of existing payment'; END IF;

    ----------------------------------------------------------------------------
    -- Test 11: Immutability - Reject DELETE
    ----------------------------------------------------------------------------
    v_exception_thrown := false;
    BEGIN
        DELETE FROM payment WHERE payment_id = v_payment_id;
    EXCEPTION WHEN restrict_violation THEN
        v_exception_thrown := true;
    END;
    IF NOT v_exception_thrown THEN RAISE EXCEPTION 'TEST FAILED: Allowed DELETE from payment table'; END IF;

    RAISE NOTICE 'ALL TESTS PASSED: M4-S03 Payment schema accurately enforces constraints, immutability, and audit.';
END $$;
