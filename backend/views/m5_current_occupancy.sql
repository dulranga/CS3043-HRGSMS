CREATE OR REPLACE VIEW view_current_occupancy AS
SELECT
    b.branch_id,
    b.name AS branch_name,
    COUNT(r.room_id) AS total_rooms,
    COUNT(bra.assignment_id) AS occupied_rooms,
    ROUND(
        COUNT(bra.assignment_id)::numeric
        / NULLIF(COUNT(r.room_id), 0) * 100,
        2
    ) AS occupancy_rate_percentage
FROM branch b
LEFT JOIN room r
    ON r.branch_id = b.branch_id
LEFT JOIN booking_room_assignment bra
    ON bra.room_id = r.room_id
    AND bra.unassigned_at IS NULL
GROUP BY b.branch_id, b.name;