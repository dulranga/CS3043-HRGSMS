-- M4-S11: Per-line and whole-booking cancellation before linked-policy cutoff
-- SRS §4.8 (Table 25: FR-062 - FR-065, FR-084), Table 44 (DBR-015, DBR-018), Table 45

-- 1. Per-Line Cancellation Transaction Function
CREATE OR REPLACE FUNCTION fn_cancel_room_line(
    p_booking_id uuid,
    p_line_id uuid,
    p_actor_id uuid,
    p_reason varchar(255) DEFAULT 'Guest requested cancellation',
    p_cancel_time timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS TABLE (
    booking_id uuid,
    line_id uuid,
    status booking_room_line_status_enum,
    cancelled_at timestamptz,
    cancelled_by uuid,
    cancellation_fee numeric(14, 2),
    remaining_active_lines integer,
    new_outstanding_balance numeric(14, 2),
    is_credit boolean,
    credit_amount numeric(14, 2)
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_booking_id uuid;
    v_guest_id uuid;
    v_invoice_id uuid;
    v_invoice_status invoice_status_enum;
    v_policy_id uuid;
    v_line_id uuid;
    v_line_booking_id uuid;
    v_stay_start_date date;
    v_stay_end_date date;
    v_line_status booking_room_line_status_enum;
    v_assignment_id uuid;
    v_assigned_at timestamptz;
    v_cancellation_fee numeric(14, 2);
    v_grace_days smallint;
    v_cutoff_time timestamptz;
    v_effective_cancel_time timestamptz;
    v_assignment_unassigned_at timestamptz;
    v_remaining_active integer;
    v_balance numeric(14, 2);
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
    SELECT inv.invoice_id, inv.status, inv.billing_policy_id
      INTO v_invoice_id, v_invoice_status, v_policy_id
      FROM invoice inv
     WHERE inv.booking_id = p_booking_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invoice for booking % does not exist', p_booking_id
            USING ERRCODE = '02000';
    END IF;

    IF v_invoice_status = 'FINAL' THEN
        RAISE EXCEPTION 'cannot cancel: invoice is already FINAL for booking %', p_booking_id
            USING ERRCODE = '55000';
    END IF;

    -- 3. Pessimistic Row Lock: Target Room Line (DBR-015)
    SELECT l.line_id, l.booking_id, l.stay_start_date, l.stay_end_date, l.status
      INTO v_line_id, v_line_booking_id, v_stay_start_date, v_stay_end_date, v_line_status
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

    IF v_line_status = 'CANCELLED' THEN
        RAISE EXCEPTION 'room line % is already CANCELLED', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF v_line_status = 'CHECKED_IN' THEN
        RAISE EXCEPTION 'room line % cannot be cancelled after check-in', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF v_line_status = 'CHECKED_OUT' THEN
        RAISE EXCEPTION 'room line % is already CHECKED_OUT and cannot be cancelled', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF v_line_status = 'NO_SHOW' THEN
        RAISE EXCEPTION 'room line % is marked NO_SHOW and cannot be cancelled', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF v_line_status <> 'BOOKED' THEN
        RAISE EXCEPTION 'room line % cannot be cancelled (current status: %; must be BOOKED)',
            p_line_id, v_line_status
            USING ERRCODE = '23514';
    END IF;

    -- 4. Check Cutoff Deadline from linked billing policy version (FR-062, FR-064, BR-012)
    SELECT bp.cancellation_fee, bp.no_show_grace_days
      INTO v_cancellation_fee, v_grace_days
      FROM billing_policy bp
     WHERE bp.billing_policy_id = v_policy_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'linked billing policy % for invoice % not found', v_policy_id, v_invoice_id
            USING ERRCODE = '02000';
    END IF;

    -- Local-midnight no-show cutoff: 00:00:00 Asia/Colombo on (stay_start_date + no_show_grace_days)
    v_cutoff_time := ((v_stay_start_date + v_grace_days)::text || ' 00:00:00+05:30')::timestamptz;
    v_effective_cancel_time := COALESCE(p_cancel_time, CURRENT_TIMESTAMP);

    IF v_effective_cancel_time >= v_cutoff_time THEN
        RAISE EXCEPTION 'cannot cancel room line %: cutoff deadline % (Asia/Colombo) has passed for stay start date % with % grace day(s)',
            p_line_id,
            to_char(v_cutoff_time AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD HH24:MI:SS'),
            v_stay_start_date,
            v_grace_days
            USING ERRCODE = '23514';
    END IF;

    -- 5. Close open assignment (FR-062, DBR-032) without occupancy
    SELECT a.assignment_id, a.assigned_at
      INTO v_assignment_id, v_assigned_at
      FROM booking_room_assignment a
     WHERE a.line_id = p_line_id
       AND a.unassigned_at IS NULL
       FOR UPDATE;

    IF FOUND THEN
        IF v_effective_cancel_time <= v_assigned_at THEN
            v_assignment_unassigned_at := v_assigned_at + interval '1 millisecond';
        ELSE
            v_assignment_unassigned_at := v_effective_cancel_time;
        END IF;

        UPDATE booking_room_assignment
           SET unassigned_at = v_assignment_unassigned_at
         WHERE assignment_id = v_assignment_id;
    END IF;

    -- 6. Transition line status to CANCELLED and append status history (FR-063, DBR-018)
    UPDATE booking_room_line
       SET status = 'CANCELLED'::booking_room_line_status_enum,
           updated_at = v_effective_cancel_time
     WHERE line_id = p_line_id;

    INSERT INTO booking_room_line_status_history (
        line_id, old_status, new_status, changed_by, reason, changed_at
    ) VALUES (
        p_line_id,
        'BOOKED'::booking_room_line_status_enum,
        'CANCELLED'::booking_room_line_status_enum,
        p_actor_id,
        COALESCE(p_reason, 'Guest requested cancellation'),
        v_effective_cancel_time
    );

    -- 7. Audit log (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log') THEN
        INSERT INTO audit_log (user_id, entity_name, entity_id, action, after_value)
        VALUES (
            p_actor_id,
            'booking_room_line',
            p_line_id::text,
            'STATUS_CHANGE',
            jsonb_build_object(
                'action', 'CANCEL_LINE',
                'status', 'CANCELLED',
                'reason', p_reason,
                'booking_id', p_booking_id,
                'stay_start_date', v_stay_start_date,
                'cancellation_fee', v_cancellation_fee
            )::text
        );
    END IF;

    -- 8. Refresh DRAFT invoice lines (FR-063, §4.7.4)
    PERFORM fn_refresh_draft_invoice_lines(v_invoice_id);

    -- 9. Evaluate surviving active lines and outstanding balance
    SELECT COUNT(*)::integer
      INTO v_remaining_active
      FROM booking_room_line
     WHERE booking_id = p_booking_id
       AND status IN ('BOOKED', 'CHECKED_IN');

    v_balance := fn_outstanding_balance(p_booking_id);

    RETURN QUERY
    SELECT p_booking_id,
           p_line_id,
           'CANCELLED'::booking_room_line_status_enum,
           v_effective_cancel_time,
           p_actor_id,
           v_cancellation_fee,
           v_remaining_active,
           v_balance,
           (v_balance < 0),
           CASE WHEN v_balance < 0 THEN abs(v_balance) ELSE 0.00 END;
END;
$$;

-- 2. Whole-Booking Cancellation Transaction Function
CREATE OR REPLACE FUNCTION fn_cancel_whole_booking(
    p_booking_id uuid,
    p_actor_id uuid,
    p_reason varchar(255) DEFAULT 'Guest requested whole booking cancellation',
    p_cancel_time timestamptz DEFAULT CURRENT_TIMESTAMP
)
RETURNS TABLE (
    booking_id uuid,
    cancelled_lines_count integer,
    cancelled_line_ids uuid[],
    cancelled_at timestamptz,
    cancelled_by uuid,
    total_cancellation_fees numeric(14, 2),
    remaining_active_lines integer,
    new_outstanding_balance numeric(14, 2),
    is_credit boolean,
    credit_amount numeric(14, 2)
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_booking_id uuid;
    v_guest_id uuid;
    v_invoice_id uuid;
    v_invoice_status invoice_status_enum;
    v_policy_id uuid;
    v_cancellation_fee numeric(14, 2);
    v_grace_days smallint;
    v_effective_cancel_time timestamptz;
    r_line RECORD;
    v_cutoff_time timestamptz;
    v_cancelled_count integer := 0;
    v_cancelled_ids uuid[] := '{}';
    v_total_fees numeric(14, 2) := 0.00;
    v_assignment_id uuid;
    v_assigned_at timestamptz;
    v_assignment_unassigned_at timestamptz;
    v_balance numeric(14, 2);
    v_has_booked_lines boolean := false;
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
    SELECT inv.invoice_id, inv.status, inv.billing_policy_id
      INTO v_invoice_id, v_invoice_status, v_policy_id
      FROM invoice inv
     WHERE inv.booking_id = p_booking_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'invoice for booking % does not exist', p_booking_id
            USING ERRCODE = '02000';
    END IF;

    IF v_invoice_status = 'FINAL' THEN
        RAISE EXCEPTION 'cannot cancel: invoice is already FINAL for booking %', p_booking_id
            USING ERRCODE = '55000';
    END IF;

    -- 3. Fetch linked billing policy parameters
    SELECT bp.cancellation_fee, bp.no_show_grace_days
      INTO v_cancellation_fee, v_grace_days
      FROM billing_policy bp
     WHERE bp.billing_policy_id = v_policy_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'linked billing policy % for invoice % not found', v_policy_id, v_invoice_id
            USING ERRCODE = '02000';
    END IF;

    v_effective_cancel_time := COALESCE(p_cancel_time, CURRENT_TIMESTAMP);

    -- 4. Lock ALL room lines in deterministic UUID order and check eligibility (FR-062)
    -- Whole-booking cancellation requires EVERY line to be eligible; otherwise rejected atomically.
    FOR r_line IN
        SELECT l.line_id, l.stay_start_date, l.stay_end_date, l.status
          FROM booking_room_line l
         WHERE l.booking_id = p_booking_id
         ORDER BY l.line_id
           FOR UPDATE
    LOOP
        IF r_line.status = 'CHECKED_IN' THEN
            RAISE EXCEPTION 'cannot cancel whole booking %: room line % is CHECKED_IN',
                p_booking_id, r_line.line_id
                USING ERRCODE = '23514';
        END IF;

        IF r_line.status = 'CHECKED_OUT' THEN
            RAISE EXCEPTION 'cannot cancel whole booking %: room line % is CHECKED_OUT',
                p_booking_id, r_line.line_id
                USING ERRCODE = '23514';
        END IF;

        IF r_line.status = 'NO_SHOW' THEN
            RAISE EXCEPTION 'cannot cancel whole booking %: room line % is marked NO_SHOW',
                p_booking_id, r_line.line_id
                USING ERRCODE = '23514';
        END IF;

        IF r_line.status = 'BOOKED' THEN
            v_has_booked_lines := true;
            -- Check cutoff
            v_cutoff_time := ((r_line.stay_start_date + v_grace_days)::text || ' 00:00:00+05:30')::timestamptz;
            IF v_effective_cancel_time >= v_cutoff_time THEN
                RAISE EXCEPTION 'cannot cancel whole booking %: cutoff deadline % (Asia/Colombo) has passed for room line %',
                    p_booking_id,
                    to_char(v_cutoff_time AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD HH24:MI:SS'),
                    r_line.line_id
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END LOOP;

    IF NOT v_has_booked_lines THEN
        RAISE EXCEPTION 'booking % has no active booked lines to cancel', p_booking_id
            USING ERRCODE = '23514';
    END IF;

    -- 5. Atomically cancel each BOOKED line
    FOR r_line IN
        SELECT l.line_id, l.stay_start_date
          FROM booking_room_line l
         WHERE l.booking_id = p_booking_id
           AND l.status = 'BOOKED'
         ORDER BY l.line_id
    LOOP
        -- Close assignment
        SELECT a.assignment_id, a.assigned_at
          INTO v_assignment_id, v_assigned_at
          FROM booking_room_assignment a
         WHERE a.line_id = r_line.line_id
           AND a.unassigned_at IS NULL
           FOR UPDATE;

        IF FOUND THEN
            IF v_effective_cancel_time <= v_assigned_at THEN
                v_assignment_unassigned_at := v_assigned_at + interval '1 millisecond';
            ELSE
                v_assignment_unassigned_at := v_effective_cancel_time;
            END IF;

            UPDATE booking_room_assignment
               SET unassigned_at = v_assignment_unassigned_at
             WHERE assignment_id = v_assignment_id;
        END IF;

        -- Update line status to CANCELLED
        UPDATE booking_room_line
           SET status = 'CANCELLED'::booking_room_line_status_enum,
               updated_at = v_effective_cancel_time
         WHERE line_id = r_line.line_id;

        -- Insert status history
        INSERT INTO booking_room_line_status_history (
            line_id, old_status, new_status, changed_by, reason, changed_at
        ) VALUES (
            r_line.line_id,
            'BOOKED'::booking_room_line_status_enum,
            'CANCELLED'::booking_room_line_status_enum,
            p_actor_id,
            COALESCE(p_reason, 'Guest requested whole booking cancellation'),
            v_effective_cancel_time
        );

        v_cancelled_count := v_cancelled_count + 1;
        v_cancelled_ids := array_append(v_cancelled_ids, r_line.line_id);
        v_total_fees := v_total_fees + v_cancellation_fee;
    END LOOP;

    -- 6. Audit whole booking cancellation
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log') THEN
        INSERT INTO audit_log (user_id, entity_name, entity_id, action, after_value)
        VALUES (
            p_actor_id,
            'booking',
            p_booking_id::text,
            'STATUS_CHANGE',
            jsonb_build_object(
                'action', 'CANCEL_WHOLE_BOOKING',
                'cancelled_lines_count', v_cancelled_count,
                'cancelled_line_ids', v_cancelled_ids,
                'reason', p_reason,
                'total_cancellation_fees', v_total_fees
            )::text
        );
    END IF;

    -- 7. Refresh DRAFT invoice lines (FR-063, §4.7.4)
    PERFORM fn_refresh_draft_invoice_lines(v_invoice_id);

    -- 8. Calculate new outstanding balance
    v_balance := fn_outstanding_balance(p_booking_id);

    RETURN QUERY
    SELECT p_booking_id,
           v_cancelled_count,
           v_cancelled_ids,
           v_effective_cancel_time,
           p_actor_id,
           v_total_fees,
           0::integer,
           v_balance,
           (v_balance < 0),
           CASE WHEN v_balance < 0 THEN abs(v_balance) ELSE 0.00 END;
END;
$$;

-- 3. Stored Procedure sp_cancel_room_line
CREATE OR REPLACE PROCEDURE sp_cancel_room_line(
    p_booking_id uuid,
    p_line_id uuid,
    p_actor_id uuid,
    p_reason varchar(255) DEFAULT 'Guest requested cancellation'
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM fn_cancel_room_line(p_booking_id, p_line_id, p_actor_id, p_reason);
END;
$$;

-- 4. Stored Procedure sp_cancel_booking (Table 45)
CREATE OR REPLACE PROCEDURE sp_cancel_booking(
    p_booking_id uuid,
    p_actor_id uuid,
    p_reason varchar(255) DEFAULT 'Guest requested whole booking cancellation'
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM fn_cancel_whole_booking(p_booking_id, p_actor_id, p_reason);
END;
$$;
