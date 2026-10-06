-- M3-S11: controlled, auditable void guard for recorded service usage.
-- SRS §4.6.2 alternative flow ("a manager may void an erroneous entry by
-- creating an auditable reversal"), FR-048, FR-058 and NFR-SAF-04.
-- The original financial event is retained: only voided/voided_at/voided_by
-- may ever change, a void happens at most once, and rows are never deleted.

CREATE OR REPLACE FUNCTION m3_guard_service_usage_void()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'recorded service usage is retained; void the charge instead of deleting it'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.usage_id IS DISTINCT FROM OLD.usage_id
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.booking_room_line_id IS DISTINCT FROM OLD.booking_room_line_id
       OR NEW.used_at IS DISTINCT FROM OLD.used_at
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.unit_price_snapshot IS DISTINCT FROM OLD.unit_price_snapshot
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by THEN
        RAISE EXCEPTION 'recorded service usage values are immutable; only a controlled void is permitted'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.voided IS NOT TRUE
       OR NEW.voided_at IS NULL
       OR NEW.voided_by IS NULL THEN
        RAISE EXCEPTION 'a void must set voided, voided_at and voided_by together'
            USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.voided IS TRUE THEN
        RAISE EXCEPTION 'service usage is already voided and cannot be voided again'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_usage_void_guard ON service_usage;
CREATE TRIGGER trg_service_usage_void_guard
    BEFORE UPDATE OR DELETE ON service_usage
    FOR EACH ROW
    EXECUTE FUNCTION m3_guard_service_usage_void();