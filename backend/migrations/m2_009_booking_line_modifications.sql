-- M2-S12: atomic staff line add/change and physical-room move operations.
-- The routines are installed before Member 4 by the shared migration order;
-- invoice objects are resolved when these routines are invoked after the full
-- dependency chain has been installed.

CREATE FUNCTION m2_require_reservation_actor(
    p_actor_id uuid,
    p_staff_branch_id uuid,
    p_allowed_roles text[]
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_role_name text;
    v_actor_branch_id uuid;
BEGIN
    SELECT target_role.role_name, officer.branch_id
      INTO v_role_name, v_actor_branch_id
      FROM user_account AS account
      JOIN officer ON officer.officer_id = account.user_id
      JOIN role AS target_role ON target_role.role_id = officer.role_id
     WHERE account.user_id = p_actor_id
       AND account.active
       AND officer.active
       AND target_role.role_name = ANY (p_allowed_roles)
     FOR KEY SHARE OF account, officer, target_role;

    IF NOT FOUND OR v_actor_branch_id IS DISTINCT FROM p_staff_branch_id THEN
        RAISE EXCEPTION 'reservation modification requires an active authorized own-branch staff actor'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_role_name;
END;
$$;

CREATE FUNCTION m2_validate_modified_line_target(
    p_room_id uuid,
    p_staff_branch_id uuid,
    p_stay_start date,
    p_stay_end date,
    p_guest_count smallint,
    p_quoted_room_type_id uuid,
    p_quoted_base_daily_rate numeric,
    p_excluded_assignment_id uuid DEFAULT NULL,
    p_require_ready boolean DEFAULT false
)
RETURNS TABLE (
    result_room_type_id uuid,
    result_base_daily_rate numeric(12, 2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_room_branch_id uuid;
    v_room_type_id uuid;
    v_room_active boolean;
    v_room_condition room_condition_enum;
    v_branch_active boolean;
    v_type_active boolean;
    v_type_capacity smallint;
    v_current_rate numeric(12, 2);
BEGIN
    IF p_stay_start IS NULL OR p_stay_end IS NULL OR p_stay_end <= p_stay_start
       OR p_guest_count IS NULL OR p_guest_count <= 0 THEN
        RAISE EXCEPTION 'room-line dates and guest count are invalid'
            USING ERRCODE = '22023';
    END IF;

    IF p_quoted_base_daily_rate IS NULL
       OR p_quoted_base_daily_rate < 0
       OR p_quoted_base_daily_rate = 'NaN'::numeric
       OR p_quoted_base_daily_rate <> round(p_quoted_base_daily_rate, 2) THEN
        RAISE EXCEPTION 'quoted room rate must be a non-negative two-decimal amount'
            USING ERRCODE = '22023';
    END IF;

    SELECT target_room.branch_id,
           target_room.room_type_id,
           target_room.active,
           target_room.operational_status
      INTO v_room_branch_id,
           v_room_type_id,
           v_room_active,
           v_room_condition
      FROM room AS target_room
     WHERE target_room.room_id = p_room_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'selected room was not found' USING ERRCODE = 'P2102';
    END IF;

    SELECT target_branch.active
      INTO v_branch_active
      FROM branch AS target_branch
     WHERE target_branch.branch_id = v_room_branch_id
     FOR UPDATE;

    SELECT target_type.active,
           target_type.capacity,
           target_type.base_daily_rate
      INTO v_type_active, v_type_capacity, v_current_rate
      FROM room_type AS target_type
     WHERE target_type.room_type_id = v_room_type_id
     FOR UPDATE;

    IF v_room_branch_id IS DISTINCT FROM p_staff_branch_id THEN
        RAISE EXCEPTION 'selected room is outside the authorized branch'
            USING ERRCODE = '42501';
    END IF;

    IF NOT v_room_active OR NOT v_branch_active OR NOT v_type_active
       OR v_room_condition = 'OUT_OF_SERVICE'
       OR (p_require_ready AND v_room_condition <> 'READY') THEN
        RAISE EXCEPTION 'selected room, branch and room type must be active and serviceable'
            USING ERRCODE = '23514';
    END IF;

    IF p_guest_count > v_type_capacity THEN
        RAISE EXCEPTION 'guest count exceeds the selected room type capacity'
            USING ERRCODE = '23514';
    END IF;

    IF p_quoted_room_type_id IS DISTINCT FROM v_room_type_id
       OR p_quoted_base_daily_rate IS DISTINCT FROM v_current_rate THEN
        RAISE EXCEPTION 'the selected room type or catalogue rate changed; request a fresh quote'
            USING ERRCODE = 'P2101';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM room_block AS block
         WHERE block.room_id = p_room_id
           AND block.start_date < p_stay_end
           AND p_stay_start < block.end_date
    ) THEN
        RAISE EXCEPTION 'selected room is blocked during the requested stay'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
          JOIN booking_room_line AS line ON line.line_id = assignment.line_id
         WHERE assignment.room_id = p_room_id
           AND assignment.unassigned_at IS NULL
           AND assignment.assignment_id IS DISTINCT FROM p_excluded_assignment_id
           AND line.status IN ('BOOKED', 'CHECKED_IN')
           AND line.stay_start_date < p_stay_end
           AND p_stay_start < line.stay_end_date
    ) THEN
        RAISE EXCEPTION 'selected room has an overlapping active room line'
            USING ERRCODE = '23514';
    END IF;

    RETURN QUERY SELECT v_room_type_id, v_current_rate;
END;
$$;

CREATE FUNCTION m2_refresh_modified_booking_invoice(
    p_booking_id uuid,
    p_actor_id uuid
)
RETURNS TABLE (
    result_invoice_id uuid,
    result_invoice_total numeric(14, 2),
    result_balance numeric(14, 2),
    result_is_credit boolean,
    result_credit_amount numeric(14, 2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice_id uuid;
    v_invoice_status text;
    v_approved_discount numeric(14, 2);
    v_total numeric(14, 2);
    v_balance numeric(14, 2);
BEGIN
    SELECT target_invoice.invoice_id, target_invoice.status::text
      INTO v_invoice_id, v_invoice_status
      FROM invoice AS target_invoice
     WHERE target_invoice.booking_id = p_booking_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking has no invoice' USING ERRCODE = 'P2102';
    END IF;

    IF v_invoice_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'only a DRAFT invoice may be refreshed'
            USING ERRCODE = 'P2104';
    END IF;

    SELECT COALESCE(-sum(invoice_line.amount), 0)::numeric(14, 2)
      INTO v_approved_discount
      FROM invoice_line
     WHERE invoice_line.invoice_id = v_invoice_id
       AND invoice_line.line_type = 'DISCOUNT';

    PERFORM set_config('app.current_user_id', p_actor_id::text, true);
    PERFORM fn_refresh_draft_invoice_lines(v_invoice_id, v_approved_discount);

    SELECT COALESCE(sum(invoice_line.amount), 0)::numeric(14, 2)
      INTO v_total
      FROM invoice_line
     WHERE invoice_line.invoice_id = v_invoice_id;

    IF v_total < 0 THEN
        RAISE EXCEPTION 'approved credits cannot make the invoice total negative'
            USING ERRCODE = '23514';
    END IF;

    SELECT balance
      INTO v_balance
      FROM fn_booking_balance(p_booking_id);

    RETURN QUERY SELECT
        v_invoice_id,
        v_total,
        v_balance,
        v_balance < 0,
        CASE WHEN v_balance < 0 THEN -v_balance ELSE 0::numeric END::numeric(14, 2);
END;
$$;

CREATE FUNCTION sp_add_booking_room_line(
    p_booking_id uuid,
    p_room_id uuid,
    p_stay_start date,
    p_stay_end date,
    p_guest_count smallint,
    p_quoted_room_type_id uuid,
    p_quoted_base_daily_rate numeric,
    p_actor_id uuid,
    p_staff_branch_id uuid,
    p_reason varchar(255)
)
RETURNS TABLE (
    result_booking_id uuid,
    result_line_id uuid,
    result_assignment_id uuid,
    result_invoice_id uuid,
    result_invoice_total numeric(14, 2),
    result_balance numeric(14, 2),
    result_is_credit boolean,
    result_credit_amount numeric(14, 2)
)
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    v_line_id uuid;
    v_assignment_id uuid;
    v_rate numeric(12, 2);
    v_invoice record;
BEGIN
    PERFORM m2_require_reservation_actor(
        p_actor_id, p_staff_branch_id, ARRAY['FRONT_DESK']::text[]
    );

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'a non-blank modification reason is required'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking was not found' USING ERRCODE = 'P2102';
    END IF;

    PERFORM 1 FROM invoice
     WHERE booking_id = p_booking_id AND status = 'DRAFT'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking requires a DRAFT invoice for modification'
            USING ERRCODE = 'P2104';
    END IF;

    SELECT result_base_daily_rate
      INTO v_rate
      FROM m2_validate_modified_line_target(
          p_room_id,
          p_staff_branch_id,
          p_stay_start,
          p_stay_end,
          p_guest_count,
          p_quoted_room_type_id,
          p_quoted_base_daily_rate
      );

    INSERT INTO booking_room_line (
        booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status
    ) VALUES (
        p_booking_id, p_stay_start, p_stay_end, p_guest_count, v_rate, 'BOOKED'
    ) RETURNING line_id INTO v_line_id;

    INSERT INTO booking_room_line_status_history (
        line_id, old_status, new_status, changed_by, reason
    ) VALUES (
        v_line_id, NULL, 'BOOKED', p_actor_id, p_reason
    );

    INSERT INTO booking_room_assignment (line_id, room_id)
    VALUES (v_line_id, p_room_id)
    RETURNING assignment_id INTO v_assignment_id;

    UPDATE booking SET updated_at = clock_timestamp() WHERE booking_id = p_booking_id;

    INSERT INTO audit_log (
        user_id, entity_name, entity_id, action, after_value, changed_at
    ) VALUES (
        p_actor_id,
        'booking_room_line',
        v_line_id::text,
        'CREATE',
        json_build_object(
            'booking_id', p_booking_id,
            'room_id', p_room_id,
            'stay_start_date', p_stay_start,
            'stay_end_date', p_stay_end,
            'guest_count', p_guest_count,
            'rate_snapshot', v_rate,
            'reason', p_reason
        )::text,
        clock_timestamp()
    );

    SELECT * INTO v_invoice
      FROM m2_refresh_modified_booking_invoice(p_booking_id, p_actor_id);

    RETURN QUERY SELECT
        p_booking_id,
        v_line_id,
        v_assignment_id,
        v_invoice.result_invoice_id,
        v_invoice.result_invoice_total,
        v_invoice.result_balance,
        v_invoice.result_is_credit,
        v_invoice.result_credit_amount;
END;
$$;

CREATE FUNCTION sp_change_booking_room_line(
    p_booking_id uuid,
    p_line_id uuid,
    p_stay_start date,
    p_stay_end date,
    p_guest_count smallint,
    p_quoted_room_type_id uuid,
    p_quoted_base_daily_rate numeric,
    p_actor_id uuid,
    p_staff_branch_id uuid,
    p_reason varchar(255)
)
RETURNS TABLE (
    result_booking_id uuid,
    result_line_id uuid,
    result_assignment_id uuid,
    result_invoice_id uuid,
    result_invoice_total numeric(14, 2),
    result_balance numeric(14, 2),
    result_is_credit boolean,
    result_credit_amount numeric(14, 2)
)
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    v_line booking_room_line%ROWTYPE;
    v_assignment_id uuid;
    v_room_id uuid;
    v_rate numeric(12, 2);
    v_invoice record;
BEGIN
    PERFORM m2_require_reservation_actor(
        p_actor_id, p_staff_branch_id, ARRAY['FRONT_DESK']::text[]
    );

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'a non-blank modification reason is required'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking was not found' USING ERRCODE = 'P2102';
    END IF;

    PERFORM 1 FROM invoice
     WHERE booking_id = p_booking_id AND status = 'DRAFT'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking requires a DRAFT invoice for modification'
            USING ERRCODE = 'P2104';
    END IF;

    SELECT * INTO v_line
      FROM booking_room_line
     WHERE booking_id = p_booking_id AND line_id = p_line_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking room line was not found' USING ERRCODE = 'P2102';
    END IF;

    IF v_line.status <> 'BOOKED' THEN
        RAISE EXCEPTION 'only a BOOKED room line may change dates, guests or rate'
            USING ERRCODE = 'P2103';
    END IF;

    SELECT assignment.assignment_id, assignment.room_id
      INTO v_assignment_id, v_room_id
      FROM booking_room_assignment AS assignment
     WHERE assignment.line_id = p_line_id
       AND assignment.unassigned_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'active room line has no current assignment'
            USING ERRCODE = '23514';
    END IF;

    SELECT result_base_daily_rate
      INTO v_rate
      FROM m2_validate_modified_line_target(
          v_room_id,
          p_staff_branch_id,
          p_stay_start,
          p_stay_end,
          p_guest_count,
          p_quoted_room_type_id,
          p_quoted_base_daily_rate,
          v_assignment_id
      );

    IF ROW(
        v_line.stay_start_date,
        v_line.stay_end_date,
        v_line.guest_count,
        v_line.rate_snapshot
    ) IS NOT DISTINCT FROM ROW(
        p_stay_start,
        p_stay_end,
        p_guest_count,
        v_rate
    ) THEN
        RAISE EXCEPTION 'the room-line change does not alter any agreed value'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO booking_room_line_revision (
        line_id,
        old_stay_start_date,
        old_stay_end_date,
        old_guest_count,
        old_rate_snapshot,
        new_stay_start_date,
        new_stay_end_date,
        new_guest_count,
        new_rate_snapshot,
        changed_by,
        reason
    ) VALUES (
        p_line_id,
        v_line.stay_start_date,
        v_line.stay_end_date,
        v_line.guest_count,
        v_line.rate_snapshot,
        p_stay_start,
        p_stay_end,
        p_guest_count,
        v_rate,
        p_actor_id,
        p_reason
    );

    UPDATE booking_room_line
       SET stay_start_date = p_stay_start,
           stay_end_date = p_stay_end,
           guest_count = p_guest_count,
           rate_snapshot = v_rate,
           updated_at = clock_timestamp()
     WHERE line_id = p_line_id;

    UPDATE booking SET updated_at = clock_timestamp() WHERE booking_id = p_booking_id;

    INSERT INTO audit_log (
        user_id, entity_name, entity_id, action, before_value, after_value, changed_at
    ) VALUES (
        p_actor_id,
        'booking_room_line',
        p_line_id::text,
        'UPDATE',
        json_build_object(
            'stay_start_date', v_line.stay_start_date,
            'stay_end_date', v_line.stay_end_date,
            'guest_count', v_line.guest_count,
            'rate_snapshot', v_line.rate_snapshot
        )::text,
        json_build_object(
            'stay_start_date', p_stay_start,
            'stay_end_date', p_stay_end,
            'guest_count', p_guest_count,
            'rate_snapshot', v_rate,
            'reason', p_reason
        )::text,
        clock_timestamp()
    );

    SELECT * INTO v_invoice
      FROM m2_refresh_modified_booking_invoice(p_booking_id, p_actor_id);

    RETURN QUERY SELECT
        p_booking_id,
        p_line_id,
        v_assignment_id,
        v_invoice.result_invoice_id,
        v_invoice.result_invoice_total,
        v_invoice.result_balance,
        v_invoice.result_is_credit,
        v_invoice.result_credit_amount;
END;
$$;

CREATE FUNCTION sp_move_booking_room_line(
    p_booking_id uuid,
    p_line_id uuid,
    p_new_room_id uuid,
    p_quoted_room_type_id uuid,
    p_quoted_base_daily_rate numeric,
    p_actor_id uuid,
    p_staff_branch_id uuid,
    p_reason varchar(200),
    p_approved_price_adjustment numeric DEFAULT NULL
)
RETURNS TABLE (
    result_booking_id uuid,
    result_line_id uuid,
    result_assignment_id uuid,
    result_invoice_id uuid,
    result_invoice_total numeric(14, 2),
    result_balance numeric(14, 2),
    result_is_credit boolean,
    result_credit_amount numeric(14, 2)
)
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    v_role_name text;
    v_line booking_room_line%ROWTYPE;
    v_old_assignment booking_room_assignment%ROWTYPE;
    v_new_assignment_id uuid;
    v_target_rate numeric(12, 2);
    v_move_time timestamptz := clock_timestamp();
    v_invoice_id uuid;
    v_adjustment_id uuid;
    v_invoice record;
BEGIN
    v_role_name := m2_require_reservation_actor(
        p_actor_id,
        p_staff_branch_id,
        ARRAY['FRONT_DESK', 'BRANCH_MANAGER']::text[]
    );

    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'a non-blank room-move reason is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_approved_price_adjustment IS NOT NULL AND (
        p_approved_price_adjustment = 'NaN'::numeric
        OR p_approved_price_adjustment <> round(p_approved_price_adjustment, 2)
        OR abs(p_approved_price_adjustment) >= 1000000000000
    ) THEN
        RAISE EXCEPTION 'price adjustment must be a signed two-decimal LKR amount'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM booking WHERE booking_id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking was not found' USING ERRCODE = 'P2102';
    END IF;

    SELECT target_invoice.invoice_id
      INTO v_invoice_id
      FROM invoice AS target_invoice
     WHERE target_invoice.booking_id = p_booking_id
       AND target_invoice.status = 'DRAFT'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking requires a DRAFT invoice for modification'
            USING ERRCODE = 'P2104';
    END IF;

    SELECT * INTO v_line
      FROM booking_room_line
     WHERE booking_id = p_booking_id AND line_id = p_line_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking room line was not found' USING ERRCODE = 'P2102';
    END IF;

    IF v_line.status NOT IN ('BOOKED', 'CHECKED_IN') THEN
        RAISE EXCEPTION 'only a BOOKED or CHECKED_IN room line may move rooms'
            USING ERRCODE = 'P2103';
    END IF;

    SELECT assignment.* INTO v_old_assignment
      FROM booking_room_assignment AS assignment
     WHERE assignment.line_id = p_line_id
       AND assignment.unassigned_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'active room line has no current assignment'
            USING ERRCODE = '23514';
    END IF;

    IF v_old_assignment.room_id = p_new_room_id THEN
        RAISE EXCEPTION 'new room must differ from the current room'
            USING ERRCODE = '22023';
    END IF;

    -- Pre-lock both physical rooms in UUID order so simultaneous swaps cannot
    -- acquire the same room pair in opposite order.
    PERFORM 1
      FROM room
     WHERE room_id IN (v_old_assignment.room_id, p_new_room_id)
     ORDER BY room_id
     FOR UPDATE;

    SELECT result_base_daily_rate
      INTO v_target_rate
      FROM m2_validate_modified_line_target(
          p_new_room_id,
          p_staff_branch_id,
          v_line.stay_start_date,
          v_line.stay_end_date,
          v_line.guest_count,
          p_quoted_room_type_id,
          p_quoted_base_daily_rate,
          v_old_assignment.assignment_id,
          v_line.status = 'CHECKED_IN'
      );

    IF v_line.status = 'BOOKED'
       AND COALESCE(p_approved_price_adjustment, 0) <> 0 THEN
        RAISE EXCEPTION 'a pending room move changes the revisioned rate instead of adding an adjustment'
            USING ERRCODE = '22023';
    END IF;

    IF v_line.status = 'CHECKED_IN'
       AND COALESCE(p_approved_price_adjustment, 0) <> 0
       AND v_role_name <> 'BRANCH_MANAGER' THEN
        RAISE EXCEPTION 'a checked-in price adjustment requires BRANCH_MANAGER approval'
            USING ERRCODE = '42501';
    END IF;

    IF v_line.status = 'BOOKED' AND v_line.rate_snapshot IS DISTINCT FROM v_target_rate THEN
        INSERT INTO booking_room_line_revision (
            line_id,
            old_stay_start_date,
            old_stay_end_date,
            old_guest_count,
            old_rate_snapshot,
            new_stay_start_date,
            new_stay_end_date,
            new_guest_count,
            new_rate_snapshot,
            changed_by,
            reason
        ) VALUES (
            p_line_id,
            v_line.stay_start_date,
            v_line.stay_end_date,
            v_line.guest_count,
            v_line.rate_snapshot,
            v_line.stay_start_date,
            v_line.stay_end_date,
            v_line.guest_count,
            v_target_rate,
            p_actor_id,
            p_reason
        );

        UPDATE booking_room_line
           SET rate_snapshot = v_target_rate,
               updated_at = v_move_time
         WHERE line_id = p_line_id;
    END IF;

    UPDATE booking_room_assignment
       SET unassigned_at = v_move_time,
           occupied_to = CASE
               WHEN v_line.status = 'CHECKED_IN' THEN v_move_time
               ELSE occupied_to
           END
     WHERE assignment_id = v_old_assignment.assignment_id;

    INSERT INTO booking_room_assignment (
        line_id, room_id, assigned_at, occupied_from
    ) VALUES (
        p_line_id,
        p_new_room_id,
        v_move_time,
        CASE WHEN v_line.status = 'CHECKED_IN' THEN v_move_time ELSE NULL END
    ) RETURNING assignment_id INTO v_new_assignment_id;

    IF v_line.status = 'CHECKED_IN'
       AND COALESCE(p_approved_price_adjustment, 0) <> 0 THEN
        INSERT INTO invoice_line (
            invoice_id,
            line_type,
            booking_room_line_id,
            description,
            amount
        ) VALUES (
            v_invoice_id,
            'PRICE_ADJUSTMENT',
            p_line_id,
            'Approved room-move difference: ' || btrim(p_reason),
            p_approved_price_adjustment
        ) RETURNING invoice_line_id INTO v_adjustment_id;
    END IF;

    UPDATE booking SET updated_at = v_move_time WHERE booking_id = p_booking_id;

    INSERT INTO audit_log (
        user_id, entity_name, entity_id, action, before_value, after_value, changed_at
    ) VALUES (
        p_actor_id,
        'booking_room_assignment',
        v_new_assignment_id::text,
        'UPDATE',
        json_build_object(
            'assignment_id', v_old_assignment.assignment_id,
            'room_id', v_old_assignment.room_id,
            'rate_snapshot', v_line.rate_snapshot
        )::text,
        json_build_object(
            'assignment_id', v_new_assignment_id,
            'room_id', p_new_room_id,
            'rate_snapshot', CASE
                WHEN v_line.status = 'BOOKED' THEN v_target_rate
                ELSE v_line.rate_snapshot
            END,
            'price_adjustment_id', v_adjustment_id,
            'price_adjustment', p_approved_price_adjustment,
            'reason', p_reason
        )::text,
        v_move_time
    );

    SELECT * INTO v_invoice
      FROM m2_refresh_modified_booking_invoice(p_booking_id, p_actor_id);

    RETURN QUERY SELECT
        p_booking_id,
        p_line_id,
        v_new_assignment_id,
        v_invoice.result_invoice_id,
        v_invoice.result_invoice_total,
        v_invoice.result_balance,
        v_invoice.result_is_credit,
        v_invoice.result_credit_amount;
END;
$$;

CREATE FUNCTION m2_reject_booking_room_line_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'booking room lines are historical records; cancel through the controlled Member 4 workflow'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER m2_booking_room_line_no_delete
BEFORE DELETE ON booking_room_line
FOR EACH ROW
EXECUTE FUNCTION m2_reject_booking_room_line_delete();

COMMENT ON FUNCTION sp_add_booking_room_line(
    uuid, uuid, date, date, smallint, uuid, numeric, uuid, uuid, varchar
) IS 'M2-S12: atomically add a quoted BOOKED room line and refresh its DRAFT invoice.';

COMMENT ON FUNCTION sp_change_booking_room_line(
    uuid, uuid, date, date, smallint, uuid, numeric, uuid, uuid, varchar
) IS 'M2-S12: revision and DRAFT-invoice refresh for a still-BOOKED room line.';

COMMENT ON FUNCTION sp_move_booking_room_line(
    uuid, uuid, uuid, uuid, numeric, uuid, uuid, varchar, numeric
) IS 'M2-S12: atomically preserve assignment history during BOOKED/CHECKED_IN room moves.';
