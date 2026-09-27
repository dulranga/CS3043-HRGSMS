CREATE VIEW view_guest_history AS
SELECT
    g.guest_id,
    g.first_name,
    g.last_name,
    COUNT(DISTINCT b.booking_id) AS total_stays,
    COALESCE(SUM(i.total_amount), 0) AS lifetime_expenditure,
    MAX(b.check_out_date) AS last_visit_date
FROM guest g
LEFT JOIN booking b ON b.guest_id = g.guest_id
LEFT JOIN invoice i ON i.booking_id = b.booking_id
GROUP BY g.guest_id, g.first_name, g.last_name;