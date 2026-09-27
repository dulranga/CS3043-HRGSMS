-- Active: 1789744794211@@ep-jolly-cell-az5qpkwh-pooler.c-3.ap-southeast-1.aws.neon.tech@5432
CREATE VIEW view_current_occupancy AS
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
    ON bra.assigned_room_id = r.room_id
    AND bra.checked_out_at IS NULL
GROUP BY b.branch_id, b.name;