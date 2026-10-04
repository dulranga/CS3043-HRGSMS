-- M3-S03 and M3-S18 mock dependency: Room status history and physical condition transition operation
-- SRS Table 40, §4.5, §6.1.4, Table 45

CREATE TABLE IF NOT EXISTS room_status_history (
    room_history_id uuid PRIMARY KEY DEFAULT uuidv7(),
    room_id uuid NOT NULL,
    old_status room_condition_enum,
    new_status room_condition_enum NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by uuid NOT NULL,
    reason varchar(255),
    CONSTRAINT room_status_history_uuidv7_check
        CHECK ((uuid_extract_version(room_history_id) = 7) IS TRUE),
    CONSTRAINT room_status_history_room_fkey FOREIGN KEY (room_id)
        REFERENCES room (room_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT room_status_history_changed_by_fkey FOREIGN KEY (changed_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_room_status_history_room ON room_status_history (room_id, changed_at);

-- Trigger to enforce immutability of room_status_history
CREATE OR REPLACE FUNCTION trg_enforce_room_status_history_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'room_status_history records cannot be deleted'
            USING ERRCODE = '55000';
    ELSIF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'room_status_history records are immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_room_status_history_immutability ON room_status_history;
CREATE TRIGGER trg_room_status_history_immutability
BEFORE UPDATE OR DELETE ON room_status_history
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_room_status_history_immutability();

-- Audited physical room condition transition operation (M3-S18)
CREATE OR REPLACE FUNCTION fn_set_room_condition(
    p_room_id uuid,
    p_new_condition room_condition_enum,
    p_changed_by uuid,
    p_reason varchar(255) DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_condition room_condition_enum;
BEGIN
    SELECT operational_status
      INTO v_old_condition
      FROM room
     WHERE room_id = p_room_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'room % does not exist', p_room_id
            USING ERRCODE = '23503';
    END IF;

    -- Write history only when physical condition actually changes (DBR-018)
    IF v_old_condition IS DISTINCT FROM p_new_condition THEN
        -- OUT_OF_SERVICE guard: reject if current active BOOKED/CHECKED_IN assignments exist (DBR-037 / M3-S18)
        IF p_new_condition = 'OUT_OF_SERVICE' AND EXISTS (
            SELECT 1
              FROM booking_room_assignment a
              JOIN booking_room_line l ON l.line_id = a.line_id
             WHERE a.room_id = p_room_id
               AND a.unassigned_at IS NULL
               AND l.status IN ('BOOKED', 'CHECKED_IN')
        ) THEN
            RAISE EXCEPTION 'cannot set room % to OUT_OF_SERVICE while current active assignments exist', p_room_id
                USING ERRCODE = '23514';
        END IF;

        UPDATE room
           SET operational_status = p_new_condition
         WHERE room_id = p_room_id;

        INSERT INTO room_status_history (
            room_id,
            old_status,
            new_status,
            changed_at,
            changed_by,
            reason
        ) VALUES (
            p_room_id,
            v_old_condition,
            p_new_condition,
            CURRENT_TIMESTAMP,
            p_changed_by,
            p_reason
        );
    END IF;
END;
$$;
