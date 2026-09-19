-- M2-S03: booking records and their status history.
-- Depends on Member 1's guest(guest_id) and user_account(user_id) UUID tables.
-- Booking creation stays disabled until M2-S05 adds booking_room_assignment;
-- later transactional functions must create a booking, open assignment and initial
-- history row atomically.

CREATE TYPE booking_channel_enum AS ENUM (
    'DIRECT_ONLINE',
    'FRONT_DESK',
    'PHONE',
    'EMAIL'
);

CREATE TYPE booking_status_enum AS ENUM (
    'BOOKED',
    'CHECKED_IN',
    'CHECKED_OUT',
    'CANCELLED',
    'NO_SHOW'
);

CREATE TABLE booking (
    booking_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_ref varchar(255) NOT NULL,
    check_in_date date NOT NULL,
    check_out_date date NOT NULL,
    booking_channel booking_channel_enum NOT NULL,
    guest_count smallint NOT NULL,
    rate_snapshot numeric(12, 2) NOT NULL,
    status booking_status_enum NOT NULL DEFAULT 'BOOKED',
    actual_check_in timestamptz,
    actual_check_out timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    guest_id uuid NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT booking_uuidv7_check
        CHECK ((uuid_extract_version(booking_id) = 7) IS TRUE),
    CONSTRAINT booking_ref_unique UNIQUE (booking_ref),
    CONSTRAINT booking_ref_check CHECK (btrim(booking_ref) <> ''),
    CONSTRAINT booking_stay_dates_check CHECK (check_out_date > check_in_date),
    CONSTRAINT booking_guest_count_check CHECK (guest_count > 0),
    CONSTRAINT booking_rate_snapshot_check CHECK (
        rate_snapshot >= 0 AND rate_snapshot <> 'NaN'::numeric
    ),
    CONSTRAINT booking_actual_times_check CHECK (
        actual_check_out IS NULL
        OR (actual_check_in IS NOT NULL AND actual_check_out >= actual_check_in)
    ),
    CONSTRAINT booking_guest_fkey FOREIGN KEY (guest_id)
        REFERENCES guest (guest_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT booking_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE booking_status_history (
    history_id uuid PRIMARY KEY DEFAULT uuidv7(),
    old_status booking_status_enum,
    new_status booking_status_enum NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason varchar(255),
    booking_id uuid NOT NULL,
    changed_by uuid NOT NULL,
    CONSTRAINT booking_status_history_uuidv7_check
        CHECK ((uuid_extract_version(history_id) = 7) IS TRUE),
    CONSTRAINT booking_status_history_transition_check CHECK ((
        (old_status IS NULL AND new_status = 'BOOKED')
        OR (old_status = 'BOOKED' AND new_status IN ('CHECKED_IN', 'CANCELLED', 'NO_SHOW'))
        OR (old_status = 'CHECKED_IN' AND new_status = 'CHECKED_OUT')
    ) IS TRUE),
    CONSTRAINT booking_status_history_booking_fkey FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT booking_status_history_changed_by_fkey FOREIGN KEY (changed_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
