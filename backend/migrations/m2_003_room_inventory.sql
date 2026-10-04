-- M2-S04: target physical rooms and dated room blocks.
-- Depends on M2-S02 room_type and Member 1's branch and user_account tables.
-- Physical room condition is independent of reservation and occupancy state;
-- M2-S05 will later link a booking room line to a physical room.

CREATE TYPE room_condition_enum AS ENUM (
    'READY',
    'CLEANING',
    'OUT_OF_SERVICE'
);

CREATE TABLE room (
    room_id uuid PRIMARY KEY DEFAULT uuidv7(),
    room_number varchar(255) NOT NULL,
    operational_status room_condition_enum NOT NULL DEFAULT 'READY',
    active boolean NOT NULL DEFAULT true,
    branch_id uuid NOT NULL,
    room_type_id uuid NOT NULL,
    CONSTRAINT room_uuidv7_check
        CHECK ((uuid_extract_version(room_id) = 7) IS TRUE),
    CONSTRAINT room_number_check CHECK (btrim(room_number) <> ''),
    CONSTRAINT room_branch_number_unique UNIQUE (branch_id, room_number),
    CONSTRAINT room_branch_fkey FOREIGN KEY (branch_id)
        REFERENCES branch (branch_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
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
