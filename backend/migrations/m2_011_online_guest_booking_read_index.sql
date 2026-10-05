-- M2-S14: support the authenticated guest's newest-first booking list.
-- booking.guest_id is an FK but PostgreSQL does not automatically index FK
-- columns, so this access path is added for the recurring My Bookings query.

CREATE INDEX booking_guest_created_idx
    ON booking (guest_id, created_at DESC, booking_id DESC);

COMMENT ON INDEX booking_guest_created_idx
IS 'Supports ownership-filtered online guest booking lists ordered newest first.';
