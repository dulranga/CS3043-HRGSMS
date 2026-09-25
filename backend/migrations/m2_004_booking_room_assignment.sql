-- M2-S05: durable booking-to-room assignment history.
-- Depends on M2-S03 booking and M2-S04 room. Same-room stay-date overlap and
-- room.booking_id pointer consistency remain M2-S06 responsibilities.

CREATE TABLE booking_room_assignment (
    assignment_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_id uuid NOT NULL,
    room_id uuid NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unassigned_at timestamptz,
    CONSTRAINT booking_room_assignment_uuidv7_check
        CHECK ((uuid_extract_version(assignment_id) = 7) IS TRUE),
    CONSTRAINT booking_room_assignment_times_check
        CHECK (unassigned_at IS NULL OR unassigned_at > assigned_at),
    CONSTRAINT booking_room_assignment_booking_fkey FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT booking_room_assignment_room_fkey FOREIGN KEY (room_id)
        REFERENCES room (room_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX booking_room_assignment_one_open_per_booking
    ON booking_room_assignment (booking_id)
    WHERE unassigned_at IS NULL;
