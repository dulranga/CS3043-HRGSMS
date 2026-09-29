-- M1-S04: user_account and shared-key officer.
-- officer.officer_id is both its primary key and a foreign key to
-- user_account.user_id, giving the one-to-one shared-key staff relationship.
-- Staff role and branch live on officer, never on user_account (per the ER).
-- A single dedicated non-login system principal is seeded for automated
-- events (SRS §6.1.4 / TBD-11 working choice), marked by a null password_hash.

CREATE TABLE user_account (
    user_id uuid PRIMARY KEY DEFAULT uuidv7(),
    username varchar(255) NOT NULL,
    password_hash text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at timestamptz,
    CONSTRAINT user_account_uuidv7_check
        CHECK ((uuid_extract_version(user_id) = 7) IS TRUE),
    CONSTRAINT user_account_username_unique UNIQUE (username),
    CONSTRAINT user_account_username_check CHECK (btrim(username) <> ''),
    CONSTRAINT user_account_password_hash_length_check
        CHECK (char_length(password_hash) <= 65535)
);

CREATE TABLE officer (
    officer_id uuid PRIMARY KEY,
    full_name varchar(255) NOT NULL,
    email varchar(255),
    phone varchar(255),
    nic varchar(255),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    branch_id uuid NOT NULL,
    role_id uuid NOT NULL,
    CONSTRAINT officer_uuidv7_check
        CHECK ((uuid_extract_version(officer_id) = 7) IS TRUE),
    CONSTRAINT officer_full_name_check CHECK (btrim(full_name) <> ''),
    CONSTRAINT officer_nic_normalized_check CHECK (nic IS NULL OR nic = upper(btrim(nic))),
    CONSTRAINT officer_user_fkey FOREIGN KEY (officer_id)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT officer_branch_fkey FOREIGN KEY (branch_id)
        REFERENCES branch (branch_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT officer_role_fkey FOREIGN KEY (role_id)
        REFERENCES role (role_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Unique among non-null officers, per the SRS §6.1.4 identity contract.
CREATE UNIQUE INDEX officer_nic_unique ON officer (nic) WHERE nic IS NOT NULL;

-- Dedicated non-login system principal for automated events (no password_hash).
INSERT INTO user_account (user_id, username, password_hash, active)
VALUES ('01a0d81b-502c-7c85-95b8-401c6323f1db', 'system', NULL, true)
ON CONFLICT (username) DO NOTHING;
