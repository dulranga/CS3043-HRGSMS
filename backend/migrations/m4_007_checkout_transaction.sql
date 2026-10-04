-- M4-S09: One-line checkout transaction with consolidated balance gate, assignment closure, room cleaning transition, and conditional finalization
-- SRS §4.8 (Table 24, Table 25: FR-059 - FR-061), Table 44 (DBR-015, DBR-018), Table 45 (sp_checkout_booking)

CREATE OR REPLACE FUNCTION fn_checkout_room_line(
    p_booking_id uuid,
    p_line_id uuid,
    p_actor_id uuid,
    p_reason varchar(255) DEFAULT 'Guest checkout'
)
RETURNS TABLE (
    booking_id uuid,
    line_id uuid,
    room_id uuid,
    room_number varchar(255),
    room_condition room_condition_enum,
    checked_out_at timestamptz,
    checked_out_by uuid,
    remaining_active_lines integer,
    is_finalized boolean,
    invoice_id uuid,
    invoice_number varchar(255),
    issued_at timestamptz,
    provisional_statement_ref varchar(255)
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_booking_id uuid;
    v_guest_id uuid;
    v_invoice_id uuid;
    v_invoice_status invoice_status_enum;
    v_invoice_number varchar(255);
    v_invoice_issued_at timestamptz;
    v_line_id uuid;
    v_line_booking_id uuid;
    v_line_status booking_room_line_status_enum;
    v_assignment_id uuid;
    v_room_id uuid;
    v_room_number varchar(255);
    v_assigned_at timestamptz;
    v_occupied_from timestamptz;
    v_occupied_to timestamptz;
    v_balance numeric(14, 2);
    v_checkout_time timestamptz;
    v_remaining_active integer;
    v_is_finalized boolean := false;
    v_stmt_ref varchar(255);
BEGIN
    -- 1. Pessimistic Row Lock: Booking (DBR-015)
    SELECT b.booking_id, b.guest_id
      INTO v_booking_id, v_guest_id
      FROM booking b
     WHERE b.booking_id = p_booking_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking % does not exist', p_booking_id
            USING ERRCODE = '02000';
    END IF;

    -- 2. Pessimistic Row Lock: Invoice (DBR-015)
    SELECT inv.invoice_id, inv.status, inv.invoice_number, inv.issued_at
      INTO v_invoice_id, v_invoice_status, v_invoice_number, v_invoice_issued_at
      FROM invoice inv
     WHERE inv.booking_id = p_booking_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invoice for booking % does not exist', p_booking_id
            USING ERRCODE = '02000';
    END IF;

    -- 3. Pessimistic Row Lock: Selected Room Line (DBR-015)
    SELECT l.line_id, l.booking_id, l.status
      INTO v_line_id, v_line_booking_id, v_line_status
      FROM booking_room_line l
     WHERE l.line_id = p_line_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'room line % does not exist', p_line_id
            USING ERRCODE = '02000';
    END IF;

    IF v_line_booking_id <> p_booking_id THEN
        RAISE EXCEPTION 'room line % does not belong to booking %', p_line_id, p_booking_id
            USING ERRCODE = '23514';
    END IF;

    IF v_line_status = 'CHECKED_OUT' THEN
        RAISE EXCEPTION 'room line % is already CHECKED_OUT', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF v_line_status <> 'CHECKED_IN' THEN
        RAISE EXCEPTION 'room line % cannot be checked out (current status: %; must be CHECKED_IN)',
            p_line_id, v_line_status
            USING ERRCODE = '23514';
    END IF;

    IF v_invoice_status = 'FINAL' THEN
        RAISE EXCEPTION 'cannot check out: invoice is already FINAL for booking %', p_booking_id
            USING ERRCODE = '55000';
    END IF;

    -- 4. Pessimistic Row Lock: Open Assignment (DBR-015)
    SELECT a.assignment_id, a.room_id, a.assigned_at, a.occupied_from, a.occupied_to
      INTO v_assignment_id, v_room_id, v_assigned_at, v_occupied_from, v_occupied_to
      FROM booking_room_assignment a
     WHERE a.line_id = p_line_id
       AND a.unassigned_at IS NULL
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checked-in room line % has no open assignment', p_line_id
            USING ERRCODE = '23514';
    END IF;

    -- 5. Pessimistic Row Lock: Physical Room (DBR-015)
    SELECT r.room_id, r.room_number
      INTO v_room_id, v_room_number
      FROM room r
     WHERE r.room_id = v_room_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'room % does not exist', v_room_id
            USING ERRCODE = '23503';
    END IF;

    -- 6. Consolidated Zero Balance Gate (FR-059, BR-008)
    v_balance := fn_outstanding_balance(p_booking_id);

    IF v_balance > 0 THEN
        RAISE EXCEPTION 'cannot check out line %: booking has an outstanding balance of LKR % that must be settled first',
            p_line_id, v_balance
            USING ERRCODE = '23514';
    ELSIF v_balance < 0 THEN
        RAISE EXCEPTION 'cannot check out line %: booking has an unrefunded credit balance of LKR % that must be refunded first',
            p_line_id, abs(v_balance)
            USING ERRCODE = '23514';
    END IF;

    -- 7. Determine consistent checkout timestamp respecting strict ordering constraints
    v_checkout_time := CURRENT_TIMESTAMP;
    IF v_occupied_from IS NOT NULL AND v_checkout_time <= v_occupied_from THEN
        v_checkout_time := v_occupied_from + interval '1 millisecond';
    END IF;
    IF v_assigned_at IS NOT NULL AND v_checkout_time <= v_assigned_at THEN
        v_checkout_time := v_assigned_at + interval '1 millisecond';
    END IF;

    -- 8. End occupancy segment and close assignment (FR-060, DBR-018)
    UPDATE booking_room_assignment
       SET occupied_to = v_checkout_time,
           unassigned_at = v_checkout_time
     WHERE assignment_id = v_assignment_id;

    -- 9. Update line status to CHECKED_OUT (FR-060, DBR-018)
    UPDATE booking_room_line AS target_line
       SET status = 'CHECKED_OUT',
           updated_at = v_checkout_time
     WHERE target_line.line_id = p_line_id;

    -- 10. Record immutable line status history (FR-061, DBR-018)
    INSERT INTO booking_room_line_status_history (
        line_id,
        old_status,
        new_status,
        changed_at,
        changed_by,
        reason
    ) VALUES (
        p_line_id,
        'CHECKED_IN',
        'CHECKED_OUT',
        v_checkout_time,
        p_actor_id,
        COALESCE(p_reason, 'Guest checkout')
    );

    -- 11. Transition physical room condition to CLEANING through Member 3 condition operation (FR-060, M3-S18)
    PERFORM fn_set_room_condition(
        v_room_id,
        'CLEANING'::room_condition_enum,
        p_actor_id,
        'Room released to cleaning after checkout'
    );

    -- 12. Audit checkout event if audit_log table exists
    IF EXISTS (
        SELECT 1
          FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name = 'audit_log'
    ) THEN
        INSERT INTO audit_log (
            entity_name,
            entity_id,
            action,
            before_value,
            after_value,
            changed_at,
            user_id
        ) VALUES (
            'booking_room_line',
            p_line_id::varchar(255),
            'UPDATE',
            'CHECKED_IN',
            'CHECKED_OUT',
            v_checkout_time,
            p_actor_id
        );
    END IF;

    -- 13. Evaluate remaining active lines (FR-059, FR-060)
    SELECT count(*)::integer
      INTO v_remaining_active
      FROM booking_room_line AS active_check
     WHERE active_check.booking_id = p_booking_id
       AND active_check.status IN ('BOOKED', 'CHECKED_IN');

    -- 14. Conditional FINAL Invoice Issuance
    -- Issue FINAL only if ALL lines are terminal and balance is zero. Partial checkout keeps DRAFT.
    IF v_remaining_active = 0 THEN
        PERFORM fn_issue_final_invoice(p_booking_id, p_actor_id);

        SELECT inv.invoice_id, inv.invoice_number, inv.issued_at
          INTO v_invoice_id, v_invoice_number, v_invoice_issued_at
          FROM invoice inv
         WHERE inv.booking_id = p_booking_id;

        v_is_finalized := true;
        v_stmt_ref := v_invoice_number;
    ELSE
        v_is_finalized := false;
        v_stmt_ref := 'PROV-' || to_char(v_checkout_time, 'YYYYMMDD') || '-' || substr(p_line_id::text, 1, 8);
    END IF;

    -- 15. Return checkout receipt / execution record
    RETURN QUERY
    SELECT
        p_booking_id,
        p_line_id,
        v_room_id,
        v_room_number,
        'CLEANING'::room_condition_enum,
        v_checkout_time,
        p_actor_id,
        v_remaining_active,
        v_is_finalized,
        v_invoice_id,
        v_invoice_number,
        v_invoice_issued_at,
        v_stmt_ref;
END;
$$;

-- Stored procedure sp_checkout_booking per SRS Table 45
CREATE OR REPLACE PROCEDURE sp_checkout_booking(
    p_booking_id uuid,
    p_line_id uuid,
    p_actor_id uuid,
    p_reason varchar(255) DEFAULT 'Guest checkout'
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM fn_checkout_room_line(p_booking_id, p_line_id, p_actor_id, p_reason);
END;
$$;
