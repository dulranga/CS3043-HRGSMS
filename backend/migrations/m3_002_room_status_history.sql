-- M3-S03: immutable physical room-condition history.

CREATE TYPE room_condition_enum AS ENUM (
    'READY',
    'CLEANING',
    'OUT_OF_SERVICE'
);

CREATE TABLE room_status_history (
    room_history_id uuid PRIMARY KEY DEFAULT uuidv7(),
    room_id uuid NOT NULL,
    old_status room_condition_enum NOT NULL,
    new_status room_condition_enum NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by uuid NOT NULL,
    CONSTRAINT room_status_history_uuidv7_check
        CHECK ((uuid_extract_version(room_history_id) = 7) IS TRUE),
    CONSTRAINT room_status_history_change_check
        CHECK (old_status <> new_status),
    CONSTRAINT room_status_history_room_fkey FOREIGN KEY (room_id)
        REFERENCES room (room_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT room_status_history_changed_by_fkey FOREIGN KEY (changed_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX room_status_history_room_changed_at_idx
    ON room_status_history (room_id, changed_at DESC);

CREATE OR REPLACE FUNCTION prevent_room_status_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'room_status_history is append-only'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trg_room_status_history_immutable
BEFORE UPDATE OR DELETE ON room_status_history
FOR EACH ROW
EXECUTE FUNCTION prevent_room_status_history_mutation();