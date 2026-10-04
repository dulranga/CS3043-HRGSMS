-- M1-S06: append-only audit_log with the controlled SRS §6.1.4 audit-action set.
-- Reconciles the legacy placeholder table created by the 0000 bootstrap (nullable
-- actor, unconstrained action, UUIDv4 IDs, no mutation guard). That placeholder is
-- pre-contract demo scaffolding with no real actor or business evidence, so it is
-- dropped and rebuilt here under the Member 1 audit contract. Going forward the
-- table is append-only: UPDATE and DELETE are rejected by a trigger so ordinary
-- application users cannot rewrite or remove audit evidence (FR-079, DBR-011,
-- NFR-SAF-04). user_id is a required FK to user_account.user_id (the dedicated
-- non-login system principal for automated events, or the authenticated account),
-- matching the shared actor contract (TBD-11).

DROP TABLE IF EXISTS audit_log;

CREATE TABLE audit_log (
    audit_id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL,
    entity_name varchar(255) NOT NULL,
    entity_id varchar(255) NOT NULL,
    action varchar(50) NOT NULL,
    before_value text,
    after_value text,
    changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address varchar(255),
    CONSTRAINT audit_log_uuidv7_check
        CHECK ((uuid_extract_version(audit_id) = 7) IS TRUE),
    CONSTRAINT audit_log_entity_name_check CHECK (btrim(entity_name) <> ''),
    CONSTRAINT audit_log_entity_id_check CHECK (btrim(entity_id) <> ''),
    CONSTRAINT audit_log_action_check CHECK (action IN (
        'CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE', 'REACTIVATE',
        'STATUS_CHANGE', 'VOID', 'REVERSE', 'PUBLISH', 'LOGIN', 'LOGOUT'
    )),
    CONSTRAINT audit_log_before_value_length_check
        CHECK (before_value IS NULL OR char_length(before_value) <= 65535),
    CONSTRAINT audit_log_after_value_length_check
        CHECK (after_value IS NULL OR char_length(after_value) <= 65535),
    CONSTRAINT audit_log_user_fkey FOREIGN KEY (user_id)
        REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_audit_log_changed_at ON audit_log (changed_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log (user_id, changed_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log (entity_name, entity_id);
CREATE INDEX idx_audit_log_action ON audit_log (action);

-- Append-only: deny any UPDATE or DELETE against audit_log so audit evidence
-- cannot be silently rewritten or removed through the application (FR-079/DBR-011).
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are not permitted'
        USING ERRCODE = '55000';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only_trigger
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
