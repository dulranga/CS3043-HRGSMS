-- Preserve history from pre-baseline databases where CREATE TABLE IF NOT EXISTS
-- left a separate room_condition enum and omitted the condition-change reason.
-- The migration runner wraps the repair and its version record in one transaction.
ALTER TABLE room_status_history ADD COLUMN IF NOT EXISTS reason varchar(255);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_attribute
         WHERE attrelid = 'room_status_history'::regclass
           AND attname IN ('old_status', 'new_status')
           AND atttypid <> 'room_condition_enum'::regtype
           AND NOT attisdropped
    ) THEN
        ALTER TABLE room_status_history
            DROP CONSTRAINT IF EXISTS room_status_history_change_check;
        -- Cast through labels; enum types with identical labels are distinct types.
        -- An unsupported historical label aborts the repair rather than losing data.
        ALTER TABLE room_status_history
            ALTER COLUMN old_status TYPE room_condition_enum
                USING old_status::text::room_condition_enum,
            ALTER COLUMN new_status TYPE room_condition_enum
                USING new_status::text::room_condition_enum;
        ALTER TABLE room_status_history
            ADD CONSTRAINT room_status_history_change_check
                CHECK (old_status IS NULL OR old_status <> new_status);
    END IF;
END;
$$;

-- Match M3-S03's nullable initial condition without changing existing events.
ALTER TABLE room_status_history ALTER COLUMN old_status DROP NOT NULL;
