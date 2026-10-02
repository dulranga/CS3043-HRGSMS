CREATE OR REPLACE VIEW view_monthly_branch_revenue AS
SELECT
    b.branch_id,
    b.name AS branch_name,
    DATE_TRUNC('month', p.paid_at) AS revenue_month,
    COALESCE(
        SUM(CASE WHEN p.kind = 'PAYMENT' THEN p.amount ELSE -p.amount END) 
        FILTER (WHERE p.status = 'SUCCESSFUL'),
        0.00
    ) AS total_revenue_lkr
FROM branch b
JOIN room r ON r.branch_id = b.branch_id
JOIN booking_room_assignment bra ON bra.room_id = r.room_id
JOIN booking_room_line brl ON brl.line_id = bra.line_id
JOIN payment p ON p.booking_id = brl.booking_id
GROUP BY b.branch_id, b.name, DATE_TRUNC('month', p.paid_at)
ORDER BY revenue_month DESC;