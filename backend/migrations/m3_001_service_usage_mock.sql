-- M3-S04 mock dependency: Service catalogue and service usage schema
-- SRS Table 40, §4.6 (FR-042 - FR-048), §6.1.4

CREATE TABLE IF NOT EXISTS service (
    service_id uuid PRIMARY KEY DEFAULT uuidv7(),
    name varchar(255) NOT NULL,
    category varchar(255) NOT NULL,
    current_price numeric(12, 2) NOT NULL CHECK (current_price >= 0),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT service_uuidv7_check
        CHECK ((uuid_extract_version(service_id) = 7) IS TRUE),
    CONSTRAINT service_name_unique UNIQUE (name),
    CONSTRAINT service_name_check CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS service_usage (
    usage_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_id uuid NOT NULL,
    booking_room_line_id uuid,
    service_id uuid NOT NULL,
    used_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    quantity numeric(10, 2) NOT NULL CHECK (quantity > 0),
    unit_price_snapshot numeric(12, 2) NOT NULL CHECK (unit_price_snapshot >= 0),
    voided boolean NOT NULL DEFAULT false,
    voided_at timestamptz,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by uuid NOT NULL,
    voided_by uuid,
    CONSTRAINT service_usage_uuidv7_check
        CHECK ((uuid_extract_version(usage_id) = 7) IS TRUE),
    CONSTRAINT service_usage_booking_fkey FOREIGN KEY (booking_id)
        REFERENCES booking (booking_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT service_usage_line_fkey FOREIGN KEY (booking_room_line_id)
        REFERENCES booking_room_line (line_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT service_usage_service_fkey FOREIGN KEY (service_id)
        REFERENCES service (service_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT service_usage_recorded_by_fkey FOREIGN KEY (recorded_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT service_usage_voided_by_fkey FOREIGN KEY (voided_by)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_service_usage_booking ON service_usage (booking_id);
CREATE INDEX IF NOT EXISTS idx_service_usage_line ON service_usage (booking_room_line_id);
