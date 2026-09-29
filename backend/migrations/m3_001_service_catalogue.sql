-- M3-S02: chain-wide chargeable service catalogue.

CREATE TABLE service (
    service_id uuid PRIMARY KEY DEFAULT uuidv7(),
    name varchar(255) NOT NULL,
    category varchar(255) NOT NULL,
    current_price numeric(12, 2) NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT service_uuidv7_check
        CHECK ((uuid_extract_version(service_id) = 7) IS TRUE),
    CONSTRAINT service_name_check CHECK (btrim(name) <> ''),
    CONSTRAINT service_category_check CHECK (btrim(category) <> ''),
    CONSTRAINT service_current_price_check CHECK (
        current_price >= 0 AND current_price <> 'NaN'::numeric
    ),
    CONSTRAINT service_name_unique UNIQUE (name)
);