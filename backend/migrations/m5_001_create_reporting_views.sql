-- 1. Occupancy Report View
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



-- 2. Billing Summary View
CREATE OR REPLACE VIEW v_report_billing_summary AS
SELECT 
  b.booking_id,
  b.booking_ref, 
  g.full_name, 
  i.invoice_number, 
  COALESCE(il.total_amount, 0) AS total_amount, 
  i.status AS invoice_status,
  COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'SUCCESSFUL' AND p.kind = 'PAYMENT'), 0) AS paid_amount,
  COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'SUCCESSFUL' AND p.kind = 'REFUND'), 0) AS refunded_amount,
  COALESCE(SUM(CASE WHEN p.kind = 'PAYMENT' THEN p.amount ELSE -p.amount END) FILTER (WHERE p.status = 'SUCCESSFUL'), 0) AS net_paid,
  (COALESCE(il.total_amount, 0) - COALESCE(SUM(CASE WHEN p.kind = 'PAYMENT' THEN p.amount ELSE -p.amount END) FILTER (WHERE p.status = 'SUCCESSFUL'), 0)) AS balance
FROM booking b 
JOIN guest g ON b.guest_id = g.guest_id
JOIN invoice i ON b.booking_id = i.booking_id
LEFT JOIN (
  SELECT invoice_id, SUM(amount) AS total_amount
  FROM invoice_line
  GROUP BY invoice_id
) il ON i.invoice_id = il.invoice_id
LEFT JOIN payment p ON b.booking_id = p.booking_id
GROUP BY b.booking_id, b.booking_ref, g.full_name, i.invoice_number, il.total_amount, i.status;


-- 3. Service Usage View
CREATE OR REPLACE VIEW view_service_usage AS
SELECT 
    s.service_id,
    s.name AS service_name,
    s.category,
    COUNT(su.usage_id) FILTER (WHERE su.voided IS NOT TRUE) AS total_orders,
    COALESCE(
        SUM(su.quantity) FILTER (WHERE su.voided IS NOT TRUE), 
        0
    ) AS total_quantity_consumed,
    COALESCE(
        SUM(su.quantity * su.unit_price_snapshot) FILTER (WHERE su.voided IS NOT TRUE), 
        0.00
    ) AS total_revenue_generated
FROM service s
LEFT JOIN service_usage su ON s.service_id = su.service_id
GROUP BY s.service_id, s.name, s.category;



-- 4. Monthly Revenue View
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

-- 5. Service Trends View
CREATE OR REPLACE VIEW v_report_service_trends AS
SELECT 
  s.category, 
  s.name AS service_name, 
  COUNT(su.usage_id) AS usage_count, 
  COALESCE(SUM(su.quantity), 0) AS total_qty, 
  COALESCE(SUM(su.quantity * su.unit_price_snapshot), 0) AS total_rev
FROM service s
LEFT JOIN service_usage su ON s.service_id = su.service_id
GROUP BY s.service_id, s.category, s.name
ORDER BY total_qty DESC
LIMIT 20;

-- 6. Guest History View
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