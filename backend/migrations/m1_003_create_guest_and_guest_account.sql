-- M1-S05: guest and guest_account.
-- guest holds guest profile data; nic is optional, stored trimmed/uppercase and
-- unique among non-null guests (SRS §6.1.4 identity contract, no passport field).
-- guest_account is the one-to-one link between a guest profile and an online
-- user_account: each side is required and unique, so a guest has at most one
-- online account and an account owns at most one guest profile.
-- The two triggers enforce that a user_account cannot be both an officer and a
-- guest_account (disjoint staff/guest accounts, TBD-11 working choice).

CREATE TABLE guest (
    guest_id uuid PRIMARY KEY DEFAULT uuidv7(),
    full_name varchar(255) NOT NULL,
    email varchar(255),
    phone varchar(255),
    nic varchar(255),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT guest_uuidv7_check
        CHECK ((uuid_extract_version(guest_id) = 7) IS TRUE),
    CONSTRAINT guest_full_name_check CHECK (btrim(full_name) <> ''),
    CONSTRAINT guest_nic_normalized_check CHECK (nic IS NULL OR nic = upper(btrim(nic)))
);

-- Unique among non-null guests, per the SRS §6.1.4 identity contract.
CREATE UNIQUE INDEX guest_nic_unique ON guest (nic) WHERE nic IS NOT NULL;

CREATE TABLE guest_account (
    guest_account_id uuid PRIMARY KEY DEFAULT uuidv7(),
    guest_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT guest_account_uuidv7_check
        CHECK ((uuid_extract_version(guest_account_id) = 7) IS TRUE),
    CONSTRAINT guest_account_guest_id_unique UNIQUE (guest_id),
    CONSTRAINT guest_account_user_id_unique UNIQUE (user_id),
    CONSTRAINT guest_account_guest_fkey FOREIGN KEY (guest_id)
        REFERENCES guest (guest_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT guest_account_user_fkey FOREIGN KEY (user_id)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Reject linking a guest_account to a user_account that is already an officer.
CREATE FUNCTION reject_staff_as_guest_account() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM officer WHERE officer_id = NEW.user_id) THEN
        RAISE EXCEPTION 'a user_account cannot be both an officer and a guest_account'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guest_account_disjoint_staff_trigger
    BEFORE INSERT OR UPDATE OF user_id ON guest_account
    FOR EACH ROW EXECUTE FUNCTION reject_staff_as_guest_account();

-- Reject creating an officer whose user_account is already a guest_account.
CREATE FUNCTION reject_guest_account_as_officer() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM guest_account WHERE user_id = NEW.officer_id) THEN
        RAISE EXCEPTION 'a user_account cannot be both an officer and a guest_account'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER officer_disjoint_guest_trigger
    BEFORE INSERT OR UPDATE OF officer_id ON officer
    FOR EACH ROW EXECUTE FUNCTION reject_guest_account_as_officer();
