-- M2-S03: normalized booking header, multi-room lines and immutable histories.
-- Depends on Member 1's guest(guest_id) and user_account(user_id) UUID tables.
-- One booking may own any number of separately dated and priced room lines;
-- booking creation will later require at least one line in one transaction.

CREATE TYPE booking_channel_enum AS ENUM (
    'DIRECT_ONLINE',
    'FRONT_DESK',
    'PHONE',
    'EMAIL'
);

CREATE TYPE booking_room_line_status_enum AS ENUM (
    'BOOKED',
    'CHECKED_IN',
    'CHECKED_OUT',
    'CANCELLED',
    'NO_SHOW'
);

CREATE TABLE booking (
    booking_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_ref varchar(255) NOT NULL,
    booking_channel booking_channel_enum NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    guest_id uuid NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT booking_uuidv7_check
        CHECK ((uuid_extract_version(booking_id) = 7) IS TRUE),
    CONSTRAINT booking_ref_unique UNIQUE (booking_ref),
    CONSTRAINT booking_ref_check CHECK (btrim(booking_ref) <> ''),
    CONSTRAINT booking_guest_fkey FOREIGN KEY (guest_id)
        REFERENCES guest (guest_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT booking_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE booking_room_line (
    line_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_id uuid NOT NULL,
    stay_start_date date NOT NULL,
    stay_end_date date NOT NULL,
    guest_count smallint NOT NULL,
    rate_snapshot numeric(12, 2) NOT NULL,
    status booking_room_line_status_enum NOT NULL DEFAULT 'BOOKED',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT booking_room_line_uuidv7_check
        CHECK ((uuid_extract_version(line_id) = 7) IS TRUE),
    CONSTRAINT booking_room_line_stay_dates_check
        CHECK (stay_end_date > stay_start_date),
    CONSTRAINT booking_room_line_guest_count_check
        CHECK (guest_count > 0),
    CONSTRAINT booking_room_line_rate_snapshot_check CHECK (
        rate_snapshot >= 0 AND rate_snapshot <> 'NaN'::numeric
    ),
    CONSTRAINT booking_room_line_booking_fkey FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX booking_room_line_booking_status_dates_idx
    ON booking_room_line (
        booking_id,
        status,
        stay_start_date,
        stay_end_date
    );

CREATE TABLE booking_room_line_status_history (
    history_id uuid PRIMARY KEY DEFAULT uuidv7(),
    line_id uuid NOT NULL,
    old_status booking_room_line_status_enum,
    new_status booking_room_line_status_enum NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by uuid NOT NULL,
    reason varchar(255),
    CONSTRAINT booking_room_line_status_history_uuidv7_check
        CHECK ((uuid_extract_version(history_id) = 7) IS TRUE),
    CONSTRAINT booking_room_line_status_history_transition_check CHECK ((
        (old_status IS NULL AND new_status = 'BOOKED')
        OR (old_status = 'BOOKED' AND new_status IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW'))
        OR (old_status = 'CHECKED_IN' AND new_status = 'CHECKED_OUT')
    ) IS TRUE),
    CONSTRAINT booking_room_line_status_history_line_fkey FOREIGN KEY (line_id)
        REFERENCES booking_room_line (line_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT booking_room_line_status_history_changed_by_fkey FOREIGN KEY (changed_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX booking_room_line_status_history_line_time_idx
    ON booking_room_line_status_history (line_id, changed_at, history_id);

CREATE TABLE booking_room_line_revision (
    revision_id uuid PRIMARY KEY DEFAULT uuidv7(),
    line_id uuid NOT NULL,
    old_stay_start_date date NOT NULL,
    old_stay_end_date date NOT NULL,
    old_guest_count smallint NOT NULL,
    old_rate_snapshot numeric(12, 2) NOT NULL,
    new_stay_start_date date NOT NULL,
    new_stay_end_date date NOT NULL,
    new_guest_count smallint NOT NULL,
    new_rate_snapshot numeric(12, 2) NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by uuid NOT NULL,
    reason varchar(255) NOT NULL,
    CONSTRAINT booking_room_line_revision_uuidv7_check
        CHECK ((uuid_extract_version(revision_id) = 7) IS TRUE),
    CONSTRAINT booking_room_line_revision_old_dates_check
        CHECK (old_stay_end_date > old_stay_start_date),
    CONSTRAINT booking_room_line_revision_new_dates_check
        CHECK (new_stay_end_date > new_stay_start_date),
    CONSTRAINT booking_room_line_revision_old_guests_check
        CHECK (old_guest_count > 0),
    CONSTRAINT booking_room_line_revision_new_guests_check
        CHECK (new_guest_count > 0),
    CONSTRAINT booking_room_line_revision_old_rate_check CHECK (
        old_rate_snapshot >= 0 AND old_rate_snapshot <> 'NaN'::numeric
    ),
    CONSTRAINT booking_room_line_revision_new_rate_check CHECK (
        new_rate_snapshot >= 0 AND new_rate_snapshot <> 'NaN'::numeric
    ),
    CONSTRAINT booking_room_line_revision_change_check CHECK (
        ROW(
            old_stay_start_date,
            old_stay_end_date,
            old_guest_count,
            old_rate_snapshot
        ) IS DISTINCT FROM ROW(
            new_stay_start_date,
            new_stay_end_date,
            new_guest_count,
            new_rate_snapshot
        )
    ),
    CONSTRAINT booking_room_line_revision_reason_check
        CHECK (btrim(reason) <> ''),
    CONSTRAINT booking_room_line_revision_line_fkey FOREIGN KEY (line_id)
        REFERENCES booking_room_line (line_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT booking_room_line_revision_changed_by_fkey FOREIGN KEY (changed_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX booking_room_line_revision_line_time_idx
    ON booking_room_line_revision (line_id, changed_at, revision_id);

CREATE FUNCTION m2_reject_room_line_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
        USING ERRCODE = 'object_not_in_prerequisite_state';
END;
$$;

CREATE TRIGGER m2_room_line_status_history_immutable
BEFORE UPDATE OR DELETE ON booking_room_line_status_history
FOR EACH ROW
EXECUTE FUNCTION m2_reject_room_line_history_mutation();

CREATE TRIGGER m2_room_line_revision_immutable
BEFORE UPDATE OR DELETE ON booking_room_line_revision
FOR EACH ROW
EXECUTE FUNCTION m2_reject_room_line_history_mutation();
