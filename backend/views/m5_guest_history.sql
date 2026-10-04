CREATE OR REPLACE VIEW view_guest_history AS
SELECT
    g.guest_id,
    g.full_name,
    g.email,
    g.phone,
    COUNT(DISTINCT b.booking_id) AS total_stays,
    COALESCE(
        SUM(p.amount) FILTER (WHERE p.status = 'SUCCESSFUL' AND p.kind = 'PAYMENT'),
        0.00
    ) AS lifetime_expenditure,
    MAX(brl.stay_end_date) AS last_visit_date
FROM guest g
LEFT JOIN booking b ON b.guest_id = g.guest_id
LEFT JOIN booking_room_line brl ON brl.booking_id = b.booking_id
LEFT JOIN payment p ON p.booking_id = b.booking_id
GROUP BY g.guest_id, g.full_name, g.email, g.phone;