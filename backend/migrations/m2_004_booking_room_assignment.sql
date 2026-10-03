-- M2-S05: line-to-room assignment history for the normalized booking model.
-- Depends on M2-S03 booking_room_line and M2-S04 room.
-- Same-room overlap, active-line lifecycle, branch and occupancy guards remain M2-S06.

CREATE TABLE booking_room_assignment (
    assignment_id uuid PRIMARY KEY DEFAULT uuidv7(),
    line_id uuid NOT NULL,
    room_id uuid NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unassigned_at timestamptz,
    occupied_from timestamptz,
    occupied_to timestamptz,
    CONSTRAINT booking_room_assignment_uuidv7_check
        CHECK ((uuid_extract_version(assignment_id) = 7) IS TRUE),
    CONSTRAINT booking_room_assignment_decision_times_check
        CHECK (unassigned_at IS NULL OR unassigned_at > assigned_at),
    CONSTRAINT booking_room_assignment_occupancy_pair_check
        CHECK (occupied_to IS NULL OR occupied_from IS NOT NULL),
    CONSTRAINT booking_room_assignment_occupancy_times_check
        CHECK (occupied_to IS NULL OR occupied_to > occupied_from),
    CONSTRAINT booking_room_assignment_line_fkey FOREIGN KEY (line_id)
        REFERENCES booking_room_line (line_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT booking_room_assignment_room_fkey FOREIGN KEY (room_id)
        REFERENCES room (room_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX booking_room_assignment_one_open_per_line
    ON booking_room_assignment (line_id)
    WHERE unassigned_at IS NULL;

CREATE INDEX booking_room_assignment_line_history_idx
    ON booking_room_assignment (line_id, assigned_at, assignment_id);

CREATE INDEX booking_room_assignment_room_open_idx
    ON booking_room_assignment (room_id, line_id)
    WHERE unassigned_at IS NULL;
