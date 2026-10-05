-- M2-S10: atomic staff-assisted multi-room booking confirmation.
-- This function is created before Member 4 migrations by the shared runner;
-- fn_create_booking_draft_invoice is resolved when the function is invoked,
-- after the full dependency chain has been installed.

CREATE FUNCTION sp_create_booking(
    p_guest_id uuid,
    p_booking_channel booking_channel_enum,
    p_created_by uuid,
    p_staff_branch_id uuid,
    p_quoted_billing_policy_id uuid,
    p_room_lines jsonb
)
RETURNS TABLE (
    booking_id uuid,
    booking_ref varchar(255),
    billing_policy_id uuid,
    invoice_id uuid
)
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    v_actor_branch_id uuid;
    v_confirmation_time timestamptz := transaction_timestamp();
    v_policy_id uuid;
    v_booking_id uuid;
    v_booking_ref varchar(255);
    v_invoice_id uuid;
    v_invoice_policy_id uuid;
    v_line jsonb;
    v_room_id uuid;
    v_stay_start date;
    v_stay_end date;
    v_guest_count smallint;
    v_quoted_room_type_id uuid;
    v_quoted_rate numeric(12, 2);
    v_room_branch_id uuid;
    v_room_type_id uuid;
    v_room_active boolean;
    v_room_condition room_condition_enum;
    v_branch_active boolean;
    v_type_active boolean;
    v_type_capacity smallint;
    v_current_rate numeric(12, 2);
    v_line_id uuid;
BEGIN
    -- Member 1 publishes under the matching exclusive advisory lock. Shared
    -- booking locks allow concurrent confirmations while preventing a policy
    -- publication from changing the effective quote during this transaction.
    PERFORM pg_advisory_xact_lock_shared(
        hashtextextended('skynest.billing_policy.publish', 0)
    );
    PERFORM set_config('TimeZone', 'Asia/Colombo', true);

    SELECT officer.branch_id
      INTO v_actor_branch_id
      FROM user_account AS account
      JOIN officer ON officer.officer_id = account.user_id
      JOIN role ON role.role_id = officer.role_id
     WHERE account.user_id = p_created_by
       AND account.active
       AND officer.active
       AND role.role_name = 'FRONT_DESK'
     FOR KEY SHARE OF account, officer, role;

    IF NOT FOUND OR v_actor_branch_id IS DISTINCT FROM p_staff_branch_id THEN
        RAISE EXCEPTION 'staff booking creation requires an active own-branch FRONT_DESK actor'
            USING ERRCODE = '42501';
    END IF;

    IF p_booking_channel = 'DIRECT_ONLINE' THEN
        RAISE EXCEPTION 'staff booking creation cannot use DIRECT_ONLINE channel'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
      FROM guest
     WHERE guest_id = p_guest_id
       AND active
     FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'active guest was not found' USING ERRCODE = 'P2003';
    END IF;

    IF p_room_lines IS NULL
       OR jsonb_typeof(p_room_lines) <> 'array'
       OR jsonb_array_length(p_room_lines) = 0 THEN
        RAISE EXCEPTION 'at least one room line is required' USING ERRCODE = '22023';
    END IF;

    SELECT policy.billing_policy_id
      INTO v_policy_id
      FROM billing_policy AS policy
     WHERE policy.effective_from <=
               (v_confirmation_time AT TIME ZONE 'Asia/Colombo')::date
       AND policy.created_at <= v_confirmation_time
       AND NOT policy.is_demo
     ORDER BY policy.effective_from DESC,
              policy.created_at DESC,
              policy.billing_policy_id DESC
     LIMIT 1;

    IF v_policy_id IS NULL THEN
        RAISE EXCEPTION 'no approved billing policy is available for booking confirmation'
            USING ERRCODE = 'P2002';
    END IF;

    IF p_quoted_billing_policy_id IS DISTINCT FROM v_policy_id THEN
        RAISE EXCEPTION 'the billing policy quote changed; request a fresh quote and reconfirm'
            USING ERRCODE = 'P2001';
    END IF;

    v_booking_id := uuidv7();
    v_booking_ref := 'SKY-' || replace(v_booking_id::text, '-', '');

    INSERT INTO booking (
        booking_id,
        booking_ref,
        booking_channel,
        guest_id,
        created_by
    ) VALUES (
        v_booking_id,
        v_booking_ref,
        p_booking_channel,
        p_guest_id,
        p_created_by
    );

    FOR v_line IN
        SELECT requested.value
          FROM jsonb_array_elements(p_room_lines) AS requested(value)
         ORDER BY (requested.value ->> 'roomId')::uuid,
                  (requested.value ->> 'checkIn')::date,
                  (requested.value ->> 'checkOut')::date
    LOOP
        IF jsonb_typeof(v_line) <> 'object'
           OR v_line ->> 'roomId' IS NULL
           OR v_line ->> 'checkIn' IS NULL
           OR v_line ->> 'checkOut' IS NULL
           OR v_line ->> 'guestCount' IS NULL
           OR v_line ->> 'quotedRoomTypeId' IS NULL
           OR v_line ->> 'quotedBaseDailyRate' IS NULL THEN
            RAISE EXCEPTION 'each room line requires room, dates, guests, type and rate quote'
                USING ERRCODE = '22023';
        END IF;

        v_room_id := (v_line ->> 'roomId')::uuid;
        v_stay_start := (v_line ->> 'checkIn')::date;
        v_stay_end := (v_line ->> 'checkOut')::date;
        v_guest_count := (v_line ->> 'guestCount')::smallint;
        v_quoted_room_type_id := (v_line ->> 'quotedRoomTypeId')::uuid;
        v_quoted_rate := (v_line ->> 'quotedBaseDailyRate')::numeric(12, 2);

        IF v_stay_end <= v_stay_start OR v_guest_count <= 0 OR v_quoted_rate < 0 THEN
            RAISE EXCEPTION 'room line dates, guest count or quoted rate are invalid'
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
         WHERE target_room.room_id = v_room_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'selected room was not found' USING ERRCODE = 'P2004';
        END IF;

        SELECT target_branch.active
          INTO v_branch_active
          FROM branch AS target_branch
         WHERE target_branch.branch_id = v_room_branch_id
         FOR UPDATE;

        SELECT target_type.active,
               target_type.capacity,
               target_type.base_daily_rate
          INTO v_type_active,
               v_type_capacity,
               v_current_rate
          FROM room_type AS target_type
         WHERE target_type.room_type_id = v_room_type_id
         FOR UPDATE;

        IF v_room_branch_id IS DISTINCT FROM p_staff_branch_id THEN
            RAISE EXCEPTION 'selected rooms must belong to the FRONT_DESK actor branch'
                USING ERRCODE = '42501';
        END IF;

        IF NOT v_room_active OR NOT v_branch_active OR NOT v_type_active
           OR v_room_condition = 'OUT_OF_SERVICE' THEN
            RAISE EXCEPTION 'selected room, branch and room type must be active and serviceable'
                USING ERRCODE = '23514';
        END IF;

        IF v_guest_count > v_type_capacity THEN
            RAISE EXCEPTION 'guest count exceeds the selected room type capacity'
                USING ERRCODE = '23514';
        END IF;

        IF v_quoted_room_type_id IS DISTINCT FROM v_room_type_id
           OR v_quoted_rate IS DISTINCT FROM v_current_rate THEN
            RAISE EXCEPTION 'a room type or base-rate quote changed; request a fresh quote and reconfirm'
                USING ERRCODE = 'P2001';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM room_block AS block
             WHERE block.room_id = v_room_id
               AND block.start_date < v_stay_end
               AND v_stay_start < block.end_date
        ) THEN
            RAISE EXCEPTION 'selected room is blocked during the requested stay'
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM booking_room_assignment AS assignment
              JOIN booking_room_line AS existing_line
                ON existing_line.line_id = assignment.line_id
             WHERE assignment.room_id = v_room_id
               AND assignment.unassigned_at IS NULL
               AND existing_line.status IN ('BOOKED', 'CHECKED_IN')
               AND existing_line.stay_start_date < v_stay_end
               AND v_stay_start < existing_line.stay_end_date
        ) THEN
            RAISE EXCEPTION 'selected room is no longer available for the requested stay'
                USING ERRCODE = '23514';
        END IF;

        INSERT INTO booking_room_line (
            booking_id,
            stay_start_date,
            stay_end_date,
            guest_count,
            rate_snapshot,
            status
        ) VALUES (
            v_booking_id,
            v_stay_start,
            v_stay_end,
            v_guest_count,
            v_current_rate,
            'BOOKED'
        )
        RETURNING line_id INTO v_line_id;

        INSERT INTO booking_room_line_status_history (
            line_id,
            old_status,
            new_status,
            changed_by,
            reason
        ) VALUES (
            v_line_id,
            NULL,
            'BOOKED',
            p_created_by,
            'Initial staff booking confirmation'
        );

        INSERT INTO booking_room_assignment (line_id, room_id)
        VALUES (v_line_id, v_room_id);
    END LOOP;

    v_invoice_id := fn_create_booking_draft_invoice(v_booking_id, p_created_by);

    SELECT target_invoice.billing_policy_id
      INTO v_invoice_policy_id
      FROM invoice AS target_invoice
     WHERE target_invoice.invoice_id = v_invoice_id;

    IF v_invoice_policy_id IS DISTINCT FROM v_policy_id THEN
        RAISE EXCEPTION 'the invoice policy changed during confirmation; request a fresh quote'
            USING ERRCODE = 'P2001';
    END IF;

    INSERT INTO audit_log (
        user_id,
        entity_name,
        entity_id,
        action,
        after_value
    ) VALUES (
        p_created_by,
        'booking',
        v_booking_id::text,
        'CREATE',
        jsonb_build_object(
            'bookingRef', v_booking_ref,
            'guestId', p_guest_id,
            'bookingChannel', p_booking_channel,
            'lineCount', jsonb_array_length(p_room_lines),
            'billingPolicyId', v_policy_id
        )::text
    );

    RETURN QUERY
    SELECT v_booking_id, v_booking_ref, v_policy_id, v_invoice_id;
END;
$$;

COMMENT ON FUNCTION sp_create_booking(
    uuid,
    booking_channel_enum,
    uuid,
    uuid,
    uuid,
    jsonb
)
IS 'Atomically confirms a staff-assisted multi-room booking and its initial DRAFT invoice after quote and availability revalidation.';
