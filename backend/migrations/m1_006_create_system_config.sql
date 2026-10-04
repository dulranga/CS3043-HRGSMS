DROP TABLE IF EXISTS system_config;

CREATE TABLE system_config (
    config_key varchar(255) PRIMARY KEY,
    config_value text NOT NULL,
    effective_from date NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT system_config_key_format_check CHECK (
        config_key ~ '^[a-z][a-z0-9_]*$'
    ),
    CONSTRAINT system_config_non_financial_key_check CHECK (
        config_key !~ '(^|_)(tax|taxes|fee|fees|rate|rates|discount|discounts|charge|charges|price|prices|amount|amounts|percent|percentage|billing|cancellation|no_show|noshow|late_checkout|grace|refund|payment|invoice|password|secret|token)(_|$)'
    ),
    CONSTRAINT system_config_value_check CHECK (btrim(config_value) <> ''),
    CONSTRAINT system_config_value_length_check CHECK (
        char_length(config_value) <= 65535
    ),
    CONSTRAINT system_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES user_account (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Version-controlled registry of approved non-financial keys and an optional
-- per-key value pattern. Empty until the team approves keys (M1-S07 decision).
CREATE FUNCTION system_config_key_registry()
RETURNS TABLE (config_key text, value_pattern text)
LANGUAGE sql STABLE AS $$
    SELECT NULL::text, NULL::text WHERE false
$$;

CREATE FUNCTION system_config_before_write() RETURNS trigger AS $$
DECLARE
    actor_is_admin boolean;
    key_registered boolean;
    allowed_pattern text;
BEGIN
    SELECT EXISTS (
        SELECT 1
          FROM user_account ua
          JOIN officer o ON o.officer_id = ua.user_id
          JOIN role r ON r.role_id = o.role_id
         WHERE ua.user_id = NEW.updated_by
           AND ua.active
           AND o.active
           AND r.role_name = 'SYSTEM_ADMINISTRATOR'
    ) INTO actor_is_admin;

    IF NOT actor_is_admin THEN
        RAISE EXCEPTION 'system_config changes require an active SYSTEM_ADMINISTRATOR officer'
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.config_key IS DISTINCT FROM OLD.config_key THEN
        RAISE EXCEPTION 'system_config.config_key cannot be changed'
            USING ERRCODE = '23514';
    END IF;

    SELECT true, r.value_pattern
      INTO key_registered, allowed_pattern
      FROM system_config_key_registry() AS r
     WHERE r.config_key = NEW.config_key;

    IF key_registered IS NOT TRUE THEN
        RAISE EXCEPTION 'system_config key "%" is not a registered non-financial setting', NEW.config_key
            USING ERRCODE = '23514';
    END IF;

    IF allowed_pattern IS NOT NULL AND NEW.config_value !~ allowed_pattern THEN
        RAISE EXCEPTION 'system_config value for "%" is invalid', NEW.config_key
            USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := clock_timestamp();
    NEW.effective_from := (NEW.updated_at AT TIME ZONE 'Asia/Colombo')::date;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_config_before_write_trigger
    BEFORE INSERT OR UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION system_config_before_write();

-- Raw old/new values (each capped at 65,535 chars) fit audit_log's text caps;
-- actor and time are in audit_log.user_id/changed_at.
CREATE FUNCTION system_config_audit_write() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (user_id, entity_name, entity_id, action, before_value, after_value, changed_at)
    VALUES (
        NEW.updated_by,
        'system_config',
        NEW.config_key,
        CASE TG_OP WHEN 'INSERT' THEN 'CREATE' ELSE 'UPDATE' END,
        CASE TG_OP WHEN 'UPDATE' THEN OLD.config_value END,
        NEW.config_value,
        NEW.updated_at
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_config_audit_write_trigger
    AFTER INSERT OR UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION system_config_audit_write();

CREATE FUNCTION system_config_no_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'system_config settings cannot be deleted; retire a key by migration'
        USING ERRCODE = '55000';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_config_no_delete_trigger
    BEFORE DELETE ON system_config
    FOR EACH ROW EXECUTE FUNCTION system_config_no_delete();

CREATE TRIGGER system_config_no_truncate_trigger
    BEFORE TRUNCATE ON system_config
    FOR EACH STATEMENT EXECUTE FUNCTION system_config_no_delete();