-- M2-S06: serialize room-affecting writes, reject active stay-date overlaps,
-- and validate the booking/assignment/current-room pointer contract at commit.
-- Multi-room operations should lock every affected room in UUID order by calling
-- m2_lock_room_ids(uuid[]) before making their coordinated writes.

CREATE INDEX booking_room_assignment_room_open_lookup
    ON booking_room_assignment (room_id, booking_id)
    WHERE unassigned_at IS NULL;

CREATE FUNCTION m2_lock_room_ids(p_room_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_room_id uuid;
BEGIN
    FOR v_room_id IN
        SELECT DISTINCT room_id
        FROM unnest(p_room_ids) AS requested(room_id)
        WHERE room_id IS NOT NULL
        ORDER BY room_id
    LOOP
        PERFORM pg_advisory_xact_lock(
            hashtextextended(v_room_id::text, 6206)
        );
    END LOOP;
END;
$$;

CREATE FUNCTION m2_assert_no_room_overlap(
    p_booking_id uuid,
    p_room_id uuid,
    p_assignment_id uuid,
    p_check_in_date date,
    p_check_out_date date,
    p_status booking_status_enum
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_status IN ('BOOKED', 'CHECKED_IN')
       AND EXISTS (
            SELECT 1
            FROM booking_room_assignment AS assignment
            JOIN booking AS other_booking
              ON other_booking.booking_id = assignment.booking_id
            WHERE assignment.room_id = p_room_id
              AND assignment.unassigned_at IS NULL
              AND assignment.assignment_id IS DISTINCT FROM p_assignment_id
              AND assignment.booking_id <> p_booking_id
              AND other_booking.status IN ('BOOKED', 'CHECKED_IN')
              AND daterange(
                    other_booking.check_in_date,
                    other_booking.check_out_date,
                    '[)'
                  ) && daterange(p_check_in_date, p_check_out_date, '[)')
       )
    THEN
        RAISE EXCEPTION 'room % has an overlapping active booking', p_room_id
            USING ERRCODE = 'exclusion_violation',
                  CONSTRAINT = 'booking_room_assignment_no_room_overlap';
    END IF;
END;
$$;

CREATE FUNCTION m2_guard_assignment_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking booking%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM m2_lock_room_ids(ARRAY[OLD.room_id]);
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        PERFORM m2_lock_room_ids(ARRAY[OLD.room_id, NEW.room_id]);
    ELSE
        PERFORM m2_lock_room_ids(ARRAY[NEW.room_id]);
    END IF;

    IF NEW.unassigned_at IS NULL THEN
        SELECT *
          INTO v_booking
          FROM booking
         WHERE booking_id = NEW.booking_id;

        IF FOUND THEN
            PERFORM m2_assert_no_room_overlap(
                NEW.booking_id,
                NEW.room_id,
                NEW.assignment_id,
                v_booking.check_in_date,
                v_booking.check_out_date,
                v_booking.status
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_assignment_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON booking_room_assignment
FOR EACH ROW
EXECUTE FUNCTION m2_guard_assignment_write();

CREATE FUNCTION m2_guard_booking_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_room_ids uuid[];
    v_assignment record;
BEGIN
    SELECT COALESCE(
               array_agg(DISTINCT room_id ORDER BY room_id),
               ARRAY[]::uuid[]
           )
      INTO v_room_ids
      FROM booking_room_assignment
     WHERE booking_id = NEW.booking_id
       AND unassigned_at IS NULL;

    PERFORM m2_lock_room_ids(v_room_ids);

    IF NEW.status IN ('BOOKED', 'CHECKED_IN') THEN
        FOR v_assignment IN
            SELECT assignment_id, room_id
            FROM booking_room_assignment
            WHERE booking_id = NEW.booking_id
              AND unassigned_at IS NULL
            ORDER BY room_id
        LOOP
            PERFORM m2_assert_no_room_overlap(
                NEW.booking_id,
                v_assignment.room_id,
                v_assignment.assignment_id,
                NEW.check_in_date,
                NEW.check_out_date,
                NEW.status
            );
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_booking_write_guard
BEFORE UPDATE OF check_in_date, check_out_date, status ON booking
FOR EACH ROW
EXECUTE FUNCTION m2_guard_booking_write();

CREATE FUNCTION m2_guard_room_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM m2_lock_room_ids(ARRAY[OLD.room_id]);
        RETURN OLD;
    END IF;

    PERFORM m2_lock_room_ids(ARRAY[NEW.room_id]);
    RETURN NEW;
END;
$$;

CREATE TRIGGER m2_room_write_guard
BEFORE INSERT OR UPDATE OF booking_id, operational_status OR DELETE ON room
FOR EACH ROW
EXECUTE FUNCTION m2_guard_room_write();

CREATE FUNCTION m2_assert_booking_integrity(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_status booking_status_enum;
    v_open_count integer;
    v_room_id uuid;
    v_room_booking_id uuid;
    v_room_status room_status_enum;
BEGIN
    SELECT status
      INTO v_status
      FROM booking
     WHERE booking_id = p_booking_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT count(*)::integer
      INTO v_open_count
      FROM booking_room_assignment
     WHERE booking_id = p_booking_id
       AND unassigned_at IS NULL;

    IF v_status IN ('BOOKED', 'CHECKED_IN') AND v_open_count <> 1 THEN
        RAISE EXCEPTION 'active booking % must have exactly one open assignment', p_booking_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'booking_active_open_assignment_check';
    END IF;

    IF v_status IN ('CHECKED_OUT', 'CANCELLED', 'NO_SHOW') AND v_open_count <> 0 THEN
        RAISE EXCEPTION 'terminal booking % cannot have an open assignment', p_booking_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'booking_terminal_open_assignment_check';
    END IF;

    IF v_status = 'CHECKED_IN' THEN
        SELECT room_id
          INTO v_room_id
          FROM booking_room_assignment
         WHERE booking_id = p_booking_id
           AND unassigned_at IS NULL;

        SELECT booking_id, operational_status
          INTO v_room_booking_id, v_room_status
          FROM room
         WHERE room_id = v_room_id;

        IF v_room_booking_id IS DISTINCT FROM p_booking_id
           OR v_room_status IS DISTINCT FROM 'OCCUPIED'::room_status_enum
        THEN
            RAISE EXCEPTION 'checked-in booking % must own its assigned OCCUPIED room pointer', p_booking_id
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'booking_checked_in_room_pointer_check';
        END IF;
    ELSIF EXISTS (
        SELECT 1
        FROM room
        WHERE booking_id = p_booking_id
    ) THEN
        RAISE EXCEPTION 'booking % cannot own a room pointer while status is %',
            p_booking_id, v_status
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'booking_non_checked_in_pointer_check';
    END IF;
END;
$$;

CREATE FUNCTION m2_assert_room_integrity(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_pointer_booking_id uuid;
    v_room_status room_status_enum;
    v_checked_in_bookings uuid[];
    v_checked_in_count integer;
BEGIN
    SELECT booking_id, operational_status
      INTO v_pointer_booking_id, v_room_status
      FROM room
     WHERE room_id = p_room_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT COALESCE(array_agg(assignment.booking_id), ARRAY[]::uuid[])
      INTO v_checked_in_bookings
      FROM booking_room_assignment AS assignment
      JOIN booking
        ON booking.booking_id = assignment.booking_id
     WHERE assignment.room_id = p_room_id
       AND assignment.unassigned_at IS NULL
       AND booking.status = 'CHECKED_IN';

    v_checked_in_count := cardinality(v_checked_in_bookings);

    IF v_pointer_booking_id IS NULL THEN
        IF v_room_status = 'OCCUPIED' OR v_checked_in_count <> 0 THEN
            RAISE EXCEPTION 'room % cannot be OCCUPIED or host a checked-in assignment without a pointer', p_room_id
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'room_missing_current_booking_pointer_check';
        END IF;
    ELSIF v_room_status <> 'OCCUPIED'
          OR v_checked_in_count <> 1
          OR v_checked_in_bookings[1] IS DISTINCT FROM v_pointer_booking_id
    THEN
        RAISE EXCEPTION 'room % pointer must identify its single checked-in open assignment', p_room_id
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'room_current_booking_pointer_check';
    END IF;
END;
$$;

CREATE FUNCTION m2_deferred_integrity_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking_id uuid;
    v_room_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'booking' THEN
        v_booking_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.booking_id ELSE NEW.booking_id END;
        PERFORM m2_assert_booking_integrity(v_booking_id);

        FOR v_room_id IN
            SELECT room_id
            FROM booking_room_assignment
            WHERE booking_id = v_booking_id
            UNION
            SELECT room_id
            FROM room
            WHERE booking_id = v_booking_id
        LOOP
            PERFORM m2_assert_room_integrity(v_room_id);
        END LOOP;
    ELSIF TG_TABLE_NAME = 'booking_room_assignment' THEN
        IF TG_OP <> 'INSERT' THEN
            PERFORM m2_assert_booking_integrity(OLD.booking_id);
            PERFORM m2_assert_room_integrity(OLD.room_id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            PERFORM m2_assert_booking_integrity(NEW.booking_id);
            PERFORM m2_assert_room_integrity(NEW.room_id);
        END IF;
    ELSIF TG_TABLE_NAME = 'room' THEN
        v_room_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.room_id ELSE NEW.room_id END;
        PERFORM m2_assert_room_integrity(v_room_id);

        IF TG_OP <> 'INSERT' AND OLD.booking_id IS NOT NULL THEN
            PERFORM m2_assert_booking_integrity(OLD.booking_id);
        END IF;
        IF TG_OP <> 'DELETE' AND NEW.booking_id IS NOT NULL THEN
            PERFORM m2_assert_booking_integrity(NEW.booking_id);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER m2_booking_integrity_check
AFTER INSERT OR UPDATE OR DELETE ON booking
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION m2_deferred_integrity_check();

CREATE CONSTRAINT TRIGGER m2_assignment_integrity_check
AFTER INSERT OR UPDATE OR DELETE ON booking_room_assignment
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION m2_deferred_integrity_check();

CREATE CONSTRAINT TRIGGER m2_room_integrity_check
AFTER INSERT OR UPDATE OR DELETE ON room
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION m2_deferred_integrity_check();
