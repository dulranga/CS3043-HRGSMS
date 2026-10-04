-- M2-S09: parameterized room availability for staff and direct guests.
-- Availability is derived from active inventory, dated blocks and current
-- line assignments. It does not store an AVAILABLE/RESERVED room condition.

CREATE INDEX booking_room_line_active_stay_idx
    ON booking_room_line (stay_start_date, stay_end_date, line_id)
    WHERE status IN ('BOOKED', 'CHECKED_IN');

CREATE FUNCTION fn_available_rooms(
    p_branch_id uuid,
    p_stay_start_date date,
    p_stay_end_date date,
    p_required_capacity integer,
    p_immediate_check_in boolean,
    p_room_type_id uuid DEFAULT NULL
)
RETURNS TABLE (
    room_id uuid,
    room_number varchar(255),
    operational_status room_condition_enum,
    branch_id uuid,
    room_type_id uuid,
    room_type_name varchar(255),
    room_type_capacity smallint,
    base_daily_rate numeric(12, 2),
    amenities jsonb
)
LANGUAGE plpgsql
STABLE
SET search_path FROM CURRENT
AS $$
BEGIN
    IF p_branch_id IS NULL THEN
        RAISE EXCEPTION 'branch ID is required' USING ERRCODE = '22023';
    END IF;

    IF p_stay_start_date IS NULL OR p_stay_end_date IS NULL
       OR p_stay_end_date <= p_stay_start_date THEN
        RAISE EXCEPTION 'stay end date must be later than stay start date'
            USING ERRCODE = '22023';
    END IF;

    IF p_required_capacity IS NULL OR p_required_capacity <= 0 THEN
        RAISE EXCEPTION 'required capacity must be positive' USING ERRCODE = '22023';
    END IF;

    IF p_immediate_check_in IS NULL THEN
        RAISE EXCEPTION 'immediate-check-in flag is required' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT target_room.room_id,
           target_room.room_number,
           target_room.operational_status,
           target_room.branch_id,
           target_type.room_type_id,
           target_type.name,
           target_type.capacity,
           target_type.base_daily_rate,
           COALESCE((
               SELECT jsonb_agg(
                          jsonb_build_object(
                              'amenity_id', linked_amenity.amenity_id,
                              'name', linked_amenity.name,
                              'description', linked_amenity.description
                          )
                          ORDER BY linked_amenity.name, linked_amenity.amenity_id
                      )
                 FROM room_type_amenity AS link
                 JOIN amenity AS linked_amenity
                   ON linked_amenity.amenity_id = link.amenity_id
                  AND linked_amenity.active
                WHERE link.room_type_id = target_type.room_type_id
           ), '[]'::jsonb)
      FROM room AS target_room
      JOIN branch AS target_branch
        ON target_branch.branch_id = target_room.branch_id
      JOIN room_type AS target_type
        ON target_type.room_type_id = target_room.room_type_id
     WHERE target_room.branch_id = p_branch_id
       AND target_room.active
       AND target_branch.active
       AND target_type.active
       AND target_type.capacity >= p_required_capacity
       AND (p_room_type_id IS NULL OR target_type.room_type_id = p_room_type_id)
       AND target_room.operational_status <> 'OUT_OF_SERVICE'
       AND (NOT p_immediate_check_in OR target_room.operational_status = 'READY')
       AND NOT EXISTS (
           SELECT 1
             FROM room_block AS block
            WHERE block.room_id = target_room.room_id
              AND block.start_date < p_stay_end_date
              AND p_stay_start_date < block.end_date
       )
       AND NOT EXISTS (
           SELECT 1
             FROM booking_room_assignment AS assignment
             JOIN booking_room_line AS line
               ON line.line_id = assignment.line_id
            WHERE assignment.room_id = target_room.room_id
              AND assignment.unassigned_at IS NULL
              AND line.status IN ('BOOKED', 'CHECKED_IN')
              AND line.stay_start_date < p_stay_end_date
              AND p_stay_start_date < line.stay_end_date
       )
     ORDER BY target_type.name, target_room.room_number, target_room.room_id;
END;
$$;

COMMENT ON FUNCTION fn_available_rooms(uuid, date, date, integer, boolean, uuid)
IS 'Returns sellable rooms for one branch and half-open stay interval, optionally filtered by room type.';
