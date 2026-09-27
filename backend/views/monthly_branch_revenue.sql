CREATE VIEW view_monthly_branch_revenue AS
SELECT
    b.branch_id,
    b.name AS branch_name,
    DATE_TRUNC('month', p.payment_date) AS revenue_month,
    SUM(p.amount) AS total_revenue_lkr
FROM branch b
JOIN room r ON r.branch_id = b.branch_id
JOIN booking_room_assignment bra ON bra.assigned_room_id = r.room_id
JOIN booking bk ON bk.booking_id = bra.booking_id
JOIN invoice inv ON inv.booking_id = bk.booking_id
JOIN payment p ON p.invoice_id = inv.invoice_id
WHERE p.payment_status = 'COMPLETED'
GROUP BY b.branch_id, b.name, DATE_TRUNC('month', p.payment_date)
ORDER BY revenue_month DESC;