
CREATE TABLE room_type (
    room_type_id uuid PRIMARY KEY DEFAULT uuidv7(),
    name varchar(255) NOT NULL,
    capacity smallint NOT NULL,
    base_daily_rate numeric(12, 2) NOT NULL,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT room_type_uuidv7_check CHECK ((uuid_extract_version(room_type_id) = 7) IS TRUE),
    CONSTRAINT room_type_name_check CHECK (btrim(name) <> ''),
    CONSTRAINT room_type_capacity_check CHECK (capacity > 0),
    CONSTRAINT room_type_rate_check CHECK (
        base_daily_rate >= 0 AND base_daily_rate <> 'NaN'::numeric
    )
);

CREATE TABLE amenity (
    amenity_id uuid PRIMARY KEY DEFAULT uuidv7(),
    name varchar(255) NOT NULL,
    description varchar(255),
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT amenity_uuidv7_check CHECK ((uuid_extract_version(amenity_id) = 7) IS TRUE),
    CONSTRAINT amenity_name_check CHECK (btrim(name) <> '')
);

CREATE TABLE room_type_amenity (
    room_type_id uuid NOT NULL,
    amenity_id uuid NOT NULL,
    CONSTRAINT room_type_amenity_pkey PRIMARY KEY (room_type_id, amenity_id),
    CONSTRAINT room_type_amenity_room_type_fkey FOREIGN KEY (room_type_id)
        REFERENCES room_type (room_type_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT room_type_amenity_amenity_fkey FOREIGN KEY (amenity_id)
        REFERENCES amenity (amenity_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
