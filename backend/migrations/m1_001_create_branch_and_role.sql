-- M1-S03: chain-wide branch catalogue and staff role catalogue.
-- Depends on nothing (base parents of the identity graph).
-- branch carries no unique-name constraint: TBD-14 leaves ER-unstated natural
-- keys open, so branches are identified by branch_id only.
-- role_name is unique per SRS §6.1.4 "seeded unique role.role_name values".

CREATE TABLE branch (
    branch_id uuid PRIMARY KEY DEFAULT uuidv7(),
    name varchar(255) NOT NULL,
    city varchar(255) NOT NULL,
    address text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT branch_uuidv7_check
        CHECK ((uuid_extract_version(branch_id) = 7) IS TRUE),
    CONSTRAINT branch_name_check CHECK (btrim(name) <> ''),
    CONSTRAINT branch_city_check CHECK (btrim(city) <> ''),
    CONSTRAINT branch_address_length_check CHECK (char_length(address) <= 65535)
);

CREATE TABLE role (
    role_id uuid PRIMARY KEY DEFAULT uuidv7(),
    role_name varchar(255) NOT NULL,
    description varchar(255),
    CONSTRAINT role_uuidv7_check
        CHECK ((uuid_extract_version(role_id) = 7) IS TRUE),
    CONSTRAINT role_name_unique UNIQUE (role_name),
    CONSTRAINT role_name_check CHECK (btrim(role_name) <> '')
);

-- Minimal fictional seed data: the three chain branches (A/D-01, FR-008).
INSERT INTO branch (name, city, address) VALUES
    ('Colombo', 'Colombo', '1 Galle Road, Colombo 03'),
    ('Kandy', 'Kandy', '12 Peradeniya Road, Kandy'),
    ('Galle', 'Galle', '45 Matara Road, Galle');

-- Seeded role set from the SRS §6.1.4 staff-permission mapping.
INSERT INTO role (role_name, description) VALUES
    ('FRONT_DESK', 'Handles own-branch reservations, check-in, checkout, payments and service-usage recording.'),
    ('SERVICE_STAFF', 'Records own-branch service usage and physical room-condition changes.'),
    ('BRANCH_MANAGER', 'Maintains own-branch rooms, dated blocks, discounts and reports.'),
    ('CHAIN_MANAGER', 'Manages chain-wide room-type/amenity/service catalogues and publishes billing policy.'),
    ('SYSTEM_ADMINISTRATOR', 'Manages branch records, accounts, roles and non-financial configuration.'),
    ('AUDITOR', 'Read-only cross-branch report and audit access.')
ON CONFLICT (role_name) DO NOTHING;
