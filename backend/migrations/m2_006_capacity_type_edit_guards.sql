-- M2-S28: capacity and room-type edit guards for active room assignments.
-- Depends on M2-S06 reservation integrity and its lock order.

CREATE OR REPLACE FUNCTION m2_validate_assignment_target(
    p_assignment_id uuid,
    p_line_id uuid,
    p_room_id uuid,
    p_is_open boolean
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_id uuid;
    v_stay_start date;
    v_stay_end date;
    v_guest_count smallint;
    v_status booking_room_line_status_enum;
    v_branch_id uuid;
    v_room_type_id uuid;
    v_room_active boolean;
    v_room_condition room_condition_enum;
    v_branch_active boolean;
    v_room_type_active boolean;
    v_room_type_capacity smallint;
BEGIN
    SELECT line.booking_id,
           line.stay_start_date,
           line.stay_end_date,
           line.guest_count,
           line.status
      INTO v_booking_id,
           v_stay_start,
           v_stay_end,
           v_guest_count,
           v_status
      FROM booking_room_line AS line
     WHERE line.line_id = p_line_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking room line % does not exist', p_line_id
            USING ERRCODE = '23503';
    END IF;

    PERFORM 1
      FROM booking
     WHERE booking_id = v_booking_id
     FOR UPDATE;

    SELECT target_room.branch_id,
           target_room.room_type_id,
           target_room.active,
           target_room.operational_status
      INTO v_branch_id,
           v_room_type_id,
           v_room_active,
           v_room_condition
      FROM room AS target_room
     WHERE target_room.room_id = p_room_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'room % does not exist', p_room_id
            USING ERRCODE = '23503';
    END IF;

    SELECT target_branch.active
      INTO v_branch_active
      FROM branch AS target_branch
     WHERE target_branch.branch_id = v_branch_id
     FOR UPDATE;

    SELECT target_type.active, target_type.capacity
      INTO v_room_type_active, v_room_type_capacity
      FROM room_type AS target_type
     WHERE target_type.room_type_id = v_room_type_id
     FOR UPDATE;

    IF NOT p_is_open THEN
        RETURN;
    END IF;

    IF v_status NOT IN ('BOOKED', 'CHECKED_IN') THEN
        RAISE EXCEPTION 'terminal room line % cannot keep an open assignment', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF NOT v_room_active OR NOT v_branch_active OR NOT v_room_type_active THEN
        RAISE EXCEPTION 'room %, its branch and its room type must all be active', p_room_id
            USING ERRCODE = '23514';
    END IF;

    IF v_guest_count > v_room_type_capacity THEN
        RAISE EXCEPTION
            'room line % guest count % exceeds room type capacity %',
            p_line_id,
            v_guest_count,
            v_room_type_capacity
            USING ERRCODE = '23514';
    END IF;

    IF v_room_condition = 'OUT_OF_SERVICE' THEN
        RAISE EXCEPTION 'room % is out of service', p_room_id
            USING ERRCODE = '23514';
    END IF;

    IF v_status = 'CHECKED_IN' AND v_room_condition <> 'READY' THEN
        RAISE EXCEPTION 'checked-in room line % requires a READY room', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM booking_room_assignment AS other_assignment
          JOIN booking_room_line AS other_line
            ON other_line.line_id = other_assignment.line_id
          JOIN room AS other_room
            ON other_room.room_id = other_assignment.room_id
         WHERE other_line.booking_id = v_booking_id
           AND other_assignment.assignment_id IS DISTINCT FROM p_assignment_id
           AND other_room.branch_id <> v_branch_id
    ) THEN
        RAISE EXCEPTION 'all room lines in booking % must stay in one branch', v_booking_id
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM room_block AS block
         WHERE block.room_id = p_room_id
           AND block.start_date < v_stay_end
           AND v_stay_start < block.end_date
    ) THEN
        RAISE EXCEPTION 'room % is blocked during the room line stay', p_room_id
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM booking_room_assignment AS other_assignment
          JOIN booking_room_line AS other_line
            ON other_line.line_id = other_assignment.line_id
         WHERE other_assignment.room_id = p_room_id
           AND other_assignment.unassigned_at IS NULL
           AND other_assignment.assignment_id IS DISTINCT FROM p_assignment_id
           AND other_line.status IN ('BOOKED', 'CHECKED_IN')
           AND other_line.stay_start_date < v_stay_end
           AND v_stay_start < other_line.stay_end_date
    ) THEN
        RAISE EXCEPTION 'room % already has an overlapping active room line', p_room_id
            USING ERRCODE = '23514';
    END IF;

    IF v_status = 'CHECKED_IN' AND EXISTS (
        SELECT 1
          FROM booking_room_assignment AS other_assignment
          JOIN booking_room_line AS other_line
            ON other_line.line_id = other_assignment.line_id
         WHERE other_assignment.room_id = p_room_id
           AND other_assignment.unassigned_at IS NULL
           AND other_assignment.assignment_id IS DISTINCT FROM p_assignment_id
           AND other_line.status = 'CHECKED_IN'
    ) THEN
        RAISE EXCEPTION 'room % already has a checked-in room line', p_room_id
            USING ERRCODE = '23514';
    END IF;
END;
$$;

DROP TRIGGER m2_room_line_target_guard ON booking_room_line;

CREATE TRIGGER m2_room_line_target_guard
AFTER INSERT OR UPDATE OF stay_start_date, stay_end_date, guest_count, status
ON booking_room_line
FOR EACH ROW
EXECUTE FUNCTION m2_recheck_room_line_target();

CREATE FUNCTION m2_guard_room_type_capacity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.capacity < OLD.capacity AND EXISTS (
        SELECT 1
          FROM room AS target_room
          JOIN booking_room_assignment AS assignment
            ON assignment.room_id = target_room.room_id
          JOIN booking_room_line AS line
            ON line.line_id = assignment.line_id
         WHERE target_room.room_type_id = OLD.room_type_id
           AND assignment.unassigned_at IS NULL
           AND line.status IN ('BOOKED', 'CHECKED_IN')
           AND line.guest_count > NEW.capacity
    ) THEN
        RAISE EXCEPTION
            'room type capacity % is below a current assigned room line guest count',
            NEW.capacity
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_room_type_capacity_change_guard
BEFORE UPDATE OF capacity ON room_type
FOR EACH ROW
EXECUTE FUNCTION m2_guard_room_type_capacity_change();

CREATE FUNCTION m2_guard_room_type_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.room_type_id IS DISTINCT FROM OLD.room_type_id AND EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
          JOIN booking_room_line AS line
            ON line.line_id = assignment.line_id
         WHERE assignment.room_id = OLD.room_id
           AND assignment.unassigned_at IS NULL
           AND line.status IN ('BOOKED', 'CHECKED_IN')
    ) THEN
        RAISE EXCEPTION 'a room with a current BOOKED or CHECKED_IN assignment cannot change type'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_room_type_change_guard
BEFORE UPDATE OF room_type_id ON room
FOR EACH ROW
EXECUTE FUNCTION m2_guard_room_type_change();
