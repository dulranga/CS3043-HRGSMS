-- Lets an active SYSTEM_ADMINISTRATOR publish billing_policy versions from the
-- System Configuration page, matching the 14 October 2026 full-grant decision
-- (billing_policy.publish at CHAIN scope). Publication stays append-only: an
-- "update" inserts a new version; earlier rows and invoice FKs are untouched.
-- Same function body as m1_005 apart from the accepted publisher roles.

CREATE OR REPLACE FUNCTION billing_policy_before_publish() RETURNS trigger AS $$
DECLARE
    publisher_is_manager boolean;
    publisher_is_system boolean;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('skynest.billing_policy.publish', 0));
    NEW.created_at := clock_timestamp();

    SELECT EXISTS (
        SELECT 1
          FROM user_account ua
          JOIN officer o ON o.officer_id = ua.user_id
          JOIN role r ON r.role_id = o.role_id
         WHERE ua.user_id = NEW.created_by
           AND ua.active
           AND o.active
           AND r.role_name IN ('CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR')
    ) INTO publisher_is_manager;

    SELECT EXISTS (
        SELECT 1
          FROM user_account ua
         WHERE ua.user_id = NEW.created_by
           AND ua.username = 'system'
           AND ua.password_hash IS NULL
           AND ua.active
    ) INTO publisher_is_system;

    IF NOT (publisher_is_manager OR (publisher_is_system AND NEW.is_demo)) THEN
        RAISE EXCEPTION 'billing_policy publication requires an active CHAIN_MANAGER or SYSTEM_ADMINISTRATOR officer'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
