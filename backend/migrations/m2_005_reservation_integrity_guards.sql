-- M2-S06: database-side reservation, assignment and inventory integrity guards.
-- Depends on M1 branch, M2-S02 room_type, M2-S03 booking/room lines,
-- M2-S04 rooms/blocks and M2-S05 assignments.
-- Capacity reductions and room-type reassignment remain M2-S28.

CREATE INDEX room_block_room_dates_idx
    ON room_block (room_id, start_date, end_date);

CREATE INDEX room_room_type_idx
    ON room (room_type_id, room_id);

CREATE FUNCTION m2_validate_assignment_target(
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
    v_status booking_room_line_status_enum;
    v_branch_id uuid;
    v_room_type_id uuid;
    v_room_active boolean;
    v_room_condition room_condition_enum;
    v_branch_active boolean;
    v_room_type_active boolean;
BEGIN
    SELECT line.booking_id,
           line.stay_start_date,
           line.stay_end_date,
           line.status
      INTO v_booking_id, v_stay_start, v_stay_end, v_status
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

    SELECT target_type.active
      INTO v_room_type_active
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

CREATE FUNCTION m2_guard_assignment_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'booking_room_assignment history is append-only'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
           OR NEW.line_id IS DISTINCT FROM OLD.line_id
           OR NEW.room_id IS DISTINCT FROM OLD.room_id
           OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
            RAISE EXCEPTION 'assignment identity, line, room and assigned_at are immutable'
                USING ERRCODE = '55000';
        END IF;

        IF OLD.unassigned_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'closed assignment history is immutable'
                USING ERRCODE = '55000';
        END IF;

        IF OLD.occupied_from IS NOT NULL
           AND NEW.occupied_from IS DISTINCT FROM OLD.occupied_from THEN
            RAISE EXCEPTION 'occupied_from is immutable once recorded'
                USING ERRCODE = '55000';
        END IF;

        IF OLD.occupied_to IS NOT NULL
           AND NEW.occupied_to IS DISTINCT FROM OLD.occupied_to THEN
            RAISE EXCEPTION 'occupied_to is immutable once recorded'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    PERFORM m2_validate_assignment_target(
        NEW.assignment_id,
        NEW.line_id,
        NEW.room_id,
        NEW.unassigned_at IS NULL
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_assignment_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON booking_room_assignment
FOR EACH ROW
EXECUTE FUNCTION m2_guard_assignment_write();
