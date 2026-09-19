-- M2-S04: physical rooms and dated room blocks.
-- Depends on M2-S02 room_type, M2-S03 booking, and Member 1's branch and
-- user_account tables. room.booking_id is only the nullable current checked-in
-- booking pointer; M2-S06 will add assignment/pointer consistency guards.

CREATE TYPE room_status_enum AS ENUM (
    'AVAILABLE',
    'RESERVED',
    'OCCUPIED',
    'CLEANING',
    'OUT_OF_SERVICE'
);

CREATE TABLE room (
    room_id uuid PRIMARY KEY DEFAULT uuidv7(),
    room_number varchar(255) NOT NULL,
    operational_status room_status_enum NOT NULL DEFAULT 'AVAILABLE',
    active boolean NOT NULL DEFAULT true,
    branch_id uuid NOT NULL,
    booking_id uuid,
    room_type_id uuid NOT NULL,
    CONSTRAINT room_uuidv7_check
        CHECK ((uuid_extract_version(room_id) = 7) IS TRUE),
    CONSTRAINT room_number_check CHECK (btrim(room_number) <> ''),
    CONSTRAINT room_branch_number_unique UNIQUE (branch_id, room_number),
    CONSTRAINT room_branch_fkey FOREIGN KEY (branch_id)
        REFERENCES branch (branch_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT room_booking_fkey FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT room_room_type_fkey FOREIGN KEY (room_type_id)
        REFERENCES room_type (room_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE room_block (
    block_id uuid PRIMARY KEY DEFAULT uuidv7(),
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    room_id uuid NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT room_block_uuidv7_check
        CHECK ((uuid_extract_version(block_id) = 7) IS TRUE),
    CONSTRAINT room_block_dates_check CHECK (end_date > start_date),
    CONSTRAINT room_block_reason_check CHECK (btrim(reason) <> ''),
    CONSTRAINT room_block_room_fkey FOREIGN KEY (room_id)
        REFERENCES room (room_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT room_block_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
