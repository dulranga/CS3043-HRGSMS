-- M2-S06: database-side reservation, assignment and inventory integrity guards.
-- Depends on M1 branch, M2-S02 room_type, M2-S03 booking/room lines,
-- M2-S04 rooms/blocks and M2-S05 assignments.
-- Capacity reductions and room-type reassignment remain M2-S28.

CREATE INDEX IF NOT EXISTS room_block_room_dates_idx
    ON room_block (room_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS room_room_type_idx
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

CREATE FUNCTION m2_guard_room_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'BOOKED' THEN
            RAISE EXCEPTION 'a new room line must start as BOOKED'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
        RAISE EXCEPTION 'a room line cannot move between booking headers'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'BOOKED'
             AND NEW.status IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW'))
            OR (OLD.status = 'CHECKED_IN' AND NEW.status = 'CHECKED_OUT')
        ) THEN
            RAISE EXCEPTION 'invalid room-line transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23514';
        END IF;

        IF NEW.stay_start_date IS DISTINCT FROM OLD.stay_start_date
           OR NEW.stay_end_date IS DISTINCT FROM OLD.stay_end_date
           OR NEW.guest_count IS DISTINCT FROM OLD.guest_count
           OR NEW.rate_snapshot IS DISTINCT FROM OLD.rate_snapshot THEN
            RAISE EXCEPTION 'a status transition cannot also rewrite room-line values'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.status <> 'BOOKED' AND (
        NEW.stay_start_date IS DISTINCT FROM OLD.stay_start_date
        OR NEW.stay_end_date IS DISTINCT FROM OLD.stay_end_date
        OR NEW.guest_count IS DISTINCT FROM OLD.guest_count
        OR NEW.rate_snapshot IS DISTINCT FROM OLD.rate_snapshot
    ) THEN
        RAISE EXCEPTION 'room-line values are immutable after check-in or termination'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_room_line_write_guard
BEFORE INSERT OR UPDATE ON booking_room_line
FOR EACH ROW
EXECUTE FUNCTION m2_guard_room_line_write();

CREATE FUNCTION m2_recheck_room_line_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_assignment_id uuid;
    v_room_id uuid;
BEGIN
    IF NEW.status NOT IN ('BOOKED', 'CHECKED_IN') THEN
        RETURN NULL;
    END IF;

    SELECT assignment.assignment_id, assignment.room_id
      INTO v_assignment_id, v_room_id
      FROM booking_room_assignment AS assignment
     WHERE assignment.line_id = NEW.line_id
       AND assignment.unassigned_at IS NULL;

    IF FOUND THEN
        PERFORM m2_validate_assignment_target(
            v_assignment_id,
            NEW.line_id,
            v_room_id,
            true
        );
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER m2_room_line_target_guard
AFTER INSERT OR UPDATE OF stay_start_date, stay_end_date, status ON booking_room_line
FOR EACH ROW
EXECUTE FUNCTION m2_recheck_room_line_target();

CREATE FUNCTION m2_assert_room_line_lifecycle(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_status booking_room_line_status_enum;
    v_open_count integer;
    v_valid_open_count integer;
    v_previous_status booking_room_line_status_enum;
    v_history_count integer := 0;
    v_history record;
BEGIN
    SELECT line.status
      INTO v_status
      FROM booking_room_line AS line
     WHERE line.line_id = p_line_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT count(*) FILTER (WHERE assignment.unassigned_at IS NULL),
           count(*) FILTER (
               WHERE assignment.unassigned_at IS NULL
                 AND (
                     (v_status = 'BOOKED'
                      AND assignment.occupied_from IS NULL
                      AND assignment.occupied_to IS NULL)
                     OR (v_status = 'CHECKED_IN'
                         AND assignment.occupied_from IS NOT NULL
                         AND assignment.occupied_to IS NULL)
                 )
           )
      INTO v_open_count, v_valid_open_count
      FROM booking_room_assignment AS assignment
     WHERE assignment.line_id = p_line_id;

    IF v_status IN ('BOOKED', 'CHECKED_IN') THEN
        IF v_open_count <> 1 OR v_valid_open_count <> 1 THEN
            RAISE EXCEPTION 'active room line % requires one lifecycle-consistent open assignment',
                p_line_id
                USING ERRCODE = '23514';
        END IF;
    ELSIF v_open_count <> 0 THEN
        RAISE EXCEPTION 'terminal room line % cannot keep an open assignment', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
         WHERE assignment.line_id = p_line_id
           AND assignment.unassigned_at IS NOT NULL
           AND assignment.occupied_from IS NOT NULL
           AND assignment.occupied_to IS NULL
    ) THEN
        RAISE EXCEPTION 'closed assignments must end any actual occupancy segment'
            USING ERRCODE = '23514';
    END IF;

    IF v_status = 'CHECKED_OUT' AND NOT EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
         WHERE assignment.line_id = p_line_id
           AND assignment.occupied_from IS NOT NULL
           AND assignment.occupied_to IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'checked-out room line % requires completed occupancy history', p_line_id
            USING ERRCODE = '23514';
    END IF;

    IF v_status IN ('CANCELLED', 'NO_SHOW') AND EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
         WHERE assignment.line_id = p_line_id
           AND assignment.occupied_from IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'cancelled or no-show room line % cannot contain occupancy history', p_line_id
            USING ERRCODE = '23514';
    END IF;

    FOR v_history IN
        SELECT history.old_status, history.new_status
          FROM booking_room_line_status_history AS history
         WHERE history.line_id = p_line_id
         ORDER BY history.changed_at, history.history_id
    LOOP
        v_history_count := v_history_count + 1;

        IF v_history_count = 1 THEN
            IF v_history.old_status IS NOT NULL OR v_history.new_status <> 'BOOKED' THEN
                RAISE EXCEPTION 'room line % must begin with an initial BOOKED history row',
                    p_line_id
                    USING ERRCODE = '23514';
            END IF;
        ELSIF v_history.old_status IS DISTINCT FROM v_previous_status THEN
            RAISE EXCEPTION 'room line % has a discontinuous status history', p_line_id
                USING ERRCODE = '23514';
        END IF;

        v_previous_status := v_history.new_status;
    END LOOP;

    IF v_history_count = 0 OR v_previous_status IS DISTINCT FROM v_status THEN
        RAISE EXCEPTION 'room line % status must match its complete status history', p_line_id
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION m2_deferred_room_line_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM m2_assert_room_line_lifecycle(OLD.line_id);
    ELSE
        PERFORM m2_assert_room_line_lifecycle(NEW.line_id);

        IF TG_OP = 'UPDATE' AND OLD.line_id IS DISTINCT FROM NEW.line_id THEN
            PERFORM m2_assert_room_line_lifecycle(OLD.line_id);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER m2_room_line_lifecycle_deferred
AFTER INSERT OR UPDATE ON booking_room_line
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION m2_deferred_room_line_lifecycle_guard();

CREATE CONSTRAINT TRIGGER m2_assignment_lifecycle_deferred
AFTER INSERT OR UPDATE OR DELETE ON booking_room_assignment
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION m2_deferred_room_line_lifecycle_guard();

CREATE CONSTRAINT TRIGGER m2_status_history_lifecycle_deferred
AFTER INSERT ON booking_room_line_status_history
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION m2_deferred_room_line_lifecycle_guard();

CREATE FUNCTION m2_guard_room_block_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1
      FROM room
     WHERE room_id = NEW.room_id
     FOR UPDATE;

    IF EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
          JOIN booking_room_line AS line
            ON line.line_id = assignment.line_id
         WHERE assignment.room_id = NEW.room_id
           AND assignment.unassigned_at IS NULL
           AND line.status IN ('BOOKED', 'CHECKED_IN')
           AND line.stay_start_date < NEW.end_date
           AND NEW.start_date < line.stay_end_date
    ) THEN
        RAISE EXCEPTION 'room block overlaps an active room-line assignment'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_room_block_write_guard
BEFORE INSERT OR UPDATE OF room_id, start_date, end_date ON room_block
FOR EACH ROW
EXECUTE FUNCTION m2_guard_room_block_write();

CREATE FUNCTION m2_guard_room_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
         WHERE assignment.room_id = OLD.room_id
    ) THEN
        RAISE EXCEPTION 'a room with assignment history cannot move to another branch'
            USING ERRCODE = '23514';
    END IF;

    IF (
        (OLD.active AND NOT NEW.active)
        OR (OLD.operational_status <> 'OUT_OF_SERVICE'
            AND NEW.operational_status = 'OUT_OF_SERVICE')
    ) AND EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
          JOIN booking_room_line AS line
            ON line.line_id = assignment.line_id
         WHERE assignment.room_id = OLD.room_id
           AND assignment.unassigned_at IS NULL
           AND line.status IN ('BOOKED', 'CHECKED_IN')
    ) THEN
        RAISE EXCEPTION 'room has a current BOOKED or CHECKED_IN assignment'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_room_inventory_change_guard
BEFORE UPDATE OF active, operational_status, branch_id ON room
FOR EACH ROW
EXECUTE FUNCTION m2_guard_room_inventory_change();

CREATE FUNCTION m2_guard_branch_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.active AND NOT NEW.active AND EXISTS (
        SELECT 1
          FROM room AS target_room
          JOIN booking_room_assignment AS assignment
            ON assignment.room_id = target_room.room_id
          JOIN booking_room_line AS line
            ON line.line_id = assignment.line_id
         WHERE target_room.branch_id = OLD.branch_id
           AND assignment.unassigned_at IS NULL
           AND line.status IN ('BOOKED', 'CHECKED_IN')
    ) THEN
        RAISE EXCEPTION 'branch has a current BOOKED or CHECKED_IN room assignment'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_branch_deactivation_guard
BEFORE UPDATE OF active ON branch
FOR EACH ROW
EXECUTE FUNCTION m2_guard_branch_deactivation();

CREATE FUNCTION m2_guard_room_type_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.active AND NOT NEW.active AND EXISTS (
        SELECT 1
          FROM room AS target_room
          JOIN booking_room_assignment AS assignment
            ON assignment.room_id = target_room.room_id
          JOIN booking_room_line AS line
            ON line.line_id = assignment.line_id
         WHERE target_room.room_type_id = OLD.room_type_id
           AND assignment.unassigned_at IS NULL
           AND line.status IN ('BOOKED', 'CHECKED_IN')
    ) THEN
        RAISE EXCEPTION 'room type has a current BOOKED or CHECKED_IN room assignment'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_room_type_deactivation_guard
BEFORE UPDATE OF active ON room_type
FOR EACH ROW
EXECUTE FUNCTION m2_guard_room_type_deactivation();
