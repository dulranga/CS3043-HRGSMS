-- M1-S08: session-expiry configuration and login-throttle lookup support.
-- Registers the first approved non-financial system_config key (FR-005): the
-- inactivity period after which a staff or online-guest session expires, in
-- whole minutes from 1 to 999. No value is seeded because only an active
-- SYSTEM_ADMINISTRATOR may write system_config; the application uses its
-- documented 30-minute default until an administrator sets the key.
-- Approved keys are added here with CREATE OR REPLACE, per m1_006.

CREATE OR REPLACE FUNCTION system_config_key_registry()
RETURNS TABLE (config_key text, value_pattern text)
LANGUAGE sql STABLE AS $$
    VALUES ('session_idle_timeout_minutes'::text, '^[1-9][0-9]{0,2}$'::text)
$$;

-- Login attempts are LOGIN audit rows keyed by entity; the throttle counts recent
-- failures for one account (or one unknown username) since its last success.
CREATE INDEX IF NOT EXISTS idx_audit_log_login_attempts
    ON audit_log (entity_name, entity_id, changed_at DESC)
    WHERE action = 'LOGIN';
