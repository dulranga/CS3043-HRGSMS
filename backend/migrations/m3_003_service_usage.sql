-- M3-S04: service usage events and historical price snapshots.
-- Upgrade m3_001's published mock in place; do not recreate or delete usages.

CREATE TABLE IF NOT EXISTS service_usage (
    usage_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_id uuid NOT NULL,
    service_id uuid NOT NULL,
    booking_room_line_id uuid,
    used_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    quantity numeric(10, 2) NOT NULL,
    unit_price_snapshot numeric(12, 2) NOT NULL,
    voided boolean NOT NULL DEFAULT false,
    voided_at timestamptz,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by uuid NOT NULL,
    voided_by uuid,
    CONSTRAINT service_usage_uuidv7_check
        CHECK ((uuid_extract_version(usage_id) = 7) IS TRUE),
    CONSTRAINT service_usage_quantity_check CHECK (
        quantity > 0 AND quantity <> 'NaN'::numeric
    ),
    CONSTRAINT service_usage_unit_price_snapshot_check CHECK (
        unit_price_snapshot >= 0 AND unit_price_snapshot <> 'NaN'::numeric
    ),
    CONSTRAINT service_usage_void_consistency_check CHECK (
        (voided = false AND voided_at IS NULL AND voided_by IS NULL)
        OR (voided = true AND voided_at IS NOT NULL AND voided_by IS NOT NULL)
    ),
    CONSTRAINT service_usage_booking_fkey FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT service_usage_service_fkey FOREIGN KEY (service_id)
        REFERENCES service (service_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT service_usage_booking_room_line_fkey FOREIGN KEY (booking_room_line_id)
        REFERENCES booking_room_line (line_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT service_usage_recorded_by_fkey FOREIGN KEY (recorded_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT service_usage_voided_by_fkey FOREIGN KEY (voided_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

ALTER TABLE service_usage DROP CONSTRAINT IF EXISTS service_usage_quantity_check;
ALTER TABLE service_usage ADD CONSTRAINT service_usage_quantity_check CHECK (
    quantity > 0 AND quantity <> 'NaN'::numeric
);
ALTER TABLE service_usage DROP CONSTRAINT IF EXISTS service_usage_unit_price_snapshot_check;
ALTER TABLE service_usage ADD CONSTRAINT service_usage_unit_price_snapshot_check CHECK (
    unit_price_snapshot >= 0 AND unit_price_snapshot <> 'NaN'::numeric
);
ALTER TABLE service_usage DROP CONSTRAINT IF EXISTS service_usage_void_consistency_check;
ALTER TABLE service_usage ADD CONSTRAINT service_usage_void_consistency_check CHECK (
    (voided = false AND voided_at IS NULL AND voided_by IS NULL)
    OR (voided = true AND voided_at IS NOT NULL AND voided_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS service_usage_booking_used_at_idx
    ON service_usage (booking_id, used_at);

CREATE INDEX IF NOT EXISTS service_usage_used_at_idx
    ON service_usage (used_at);

CREATE INDEX IF NOT EXISTS service_usage_service_idx
    ON service_usage (service_id);

CREATE OR REPLACE FUNCTION validate_service_usage_stay()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    line_booking_id uuid;
    line_status text;
BEGIN
    IF NEW.booking_room_line_id IS NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM booking_room_line
            WHERE booking_id = NEW.booking_id
              AND status = 'CHECKED_IN'
        ) THEN
            RAISE EXCEPTION 'service usage requires a checked-in room line for the booking'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    SELECT booking_id, status::text
      INTO line_booking_id, line_status
      FROM booking_room_line
     WHERE line_id = NEW.booking_room_line_id;

    IF line_booking_id IS NULL THEN
        RAISE EXCEPTION 'service usage room line does not exist'
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF line_booking_id <> NEW.booking_id THEN
        RAISE EXCEPTION 'service usage room line must belong to the same booking'
            USING ERRCODE = 'check_violation';
    END IF;

    IF line_status <> 'CHECKED_IN' THEN
        RAISE EXCEPTION 'service usage room line must be CHECKED_IN'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_usage_stay_guard ON service_usage;
CREATE TRIGGER trg_service_usage_stay_guard
BEFORE INSERT OR UPDATE OF booking_id, booking_room_line_id ON service_usage
FOR EACH ROW
EXECUTE FUNCTION validate_service_usage_stay();
