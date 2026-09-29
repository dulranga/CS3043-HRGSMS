-- M2-S24: introduce the normalized room-reservation line used by the
-- Version 1.4 multi-room target. M2-S03 remains unchanged as migration
-- history; this migration copies each valid legacy booking into one line.
-- M2-S25 adds line histories, M2-S26 rekeys assignments, and M2-S27 removes
-- the duplicated room-specific booking-header columns after consumers move.

CREATE TYPE booking_room_line_status_enum AS ENUM (
    'BOOKED',
    'CHECKED_IN',
    'CHECKED_OUT',
    'CANCELLED',
    'NO_SHOW'
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

INSERT INTO booking_room_line (
    booking_id,
    stay_start_date,
    stay_end_date,
    guest_count,
    rate_snapshot,
    status,
    created_at,
    updated_at
)
SELECT
    booking_id,
    check_in_date,
    check_out_date,
    guest_count,
    rate_snapshot,
    status::text::booking_room_line_status_enum,
    created_at,
    updated_at
FROM booking;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM booking AS legacy_booking
        LEFT JOIN booking_room_line AS line
          ON line.booking_id = legacy_booking.booking_id
        GROUP BY legacy_booking.booking_id
        HAVING count(line.line_id) <> 1
    ) THEN
        RAISE EXCEPTION
            'M2-S24 backfill must create exactly one room line per legacy booking'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;
