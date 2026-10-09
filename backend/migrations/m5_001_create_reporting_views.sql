-- 1. Occupancy Report View
CREATE OR REPLACE VIEW view_current_occupancy AS
SELECT
    b.branch_id,
    b.name AS branch_name,
    COUNT(DISTINCT r.room_id) AS total_rooms,
    COUNT(DISTINCT r.room_id) FILTER (WHERE brl.status = 'CHECKED_IN') AS occupied_rooms,
    ROUND(
        (COUNT(DISTINCT r.room_id) FILTER (WHERE brl.status = 'CHECKED_IN'))::numeric
        / NULLIF(COUNT(DISTINCT r.room_id), 0) * 100,
        2
    ) AS occupancy_rate_percentage
FROM branch b
LEFT JOIN room r
    ON r.branch_id = b.branch_id AND r.active
LEFT JOIN booking_room_assignment bra
    ON bra.room_id = r.room_id
    AND bra.unassigned_at IS NULL
LEFT JOIN booking_room_line brl ON brl.line_id = bra.line_id
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



-- Derived branch, once per booking, from the sole stored physical-room path.
-- Historical assignments remain available after checkout and room moves.
CREATE OR REPLACE VIEW view_booking_branch AS
SELECT DISTINCT brl.booking_id, r.branch_id
FROM booking_room_line brl
JOIN booking_room_assignment bra ON bra.line_id = brl.line_id
JOIN room r ON r.room_id = bra.room_id;

-- 4. FINAL invoice billed revenue, once per signed line, in hotel-local month.
CREATE OR REPLACE VIEW view_monthly_branch_revenue AS
SELECT
    b.branch_id,
    b.name AS branch_name,
    DATE_TRUNC('month', i.issued_at AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo' AS revenue_month,
    COALESCE(SUM(il.amount), 0.00) AS total_revenue_lkr,
    COALESCE(SUM(il.amount) FILTER (WHERE il.line_type = 'ROOM'), 0.00) AS room_revenue_lkr,
    COALESCE(SUM(il.amount) FILTER (WHERE il.line_type = 'SERVICE'), 0.00) AS service_revenue_lkr,
    COALESCE(SUM(il.amount) FILTER (WHERE il.line_type NOT IN ('ROOM', 'SERVICE')), 0.00) AS other_revenue_lkr
FROM branch b
JOIN view_booking_branch bk ON bk.branch_id = b.branch_id
JOIN invoice i ON i.booking_id = bk.booking_id AND i.status = 'FINAL'
JOIN invoice_line il ON il.invoice_id = i.invoice_id
GROUP BY b.branch_id, b.name, DATE_TRUNC('month', i.issued_at AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo'
ORDER BY revenue_month DESC;

-- 5. Service Trends View
CREATE OR REPLACE VIEW v_report_service_trends AS
SELECT 
  s.category, 
  s.name AS service_name, 
  COUNT(su.usage_id) FILTER (WHERE NOT su.voided) AS usage_count,
  COALESCE(SUM(su.quantity) FILTER (WHERE NOT su.voided), 0) AS total_qty,
  COALESCE(SUM(su.quantity * su.unit_price_snapshot) FILTER (WHERE NOT su.voided), 0) AS total_rev
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
    COALESCE(stays.total_stays, 0) AS total_stays,
    COALESCE(cash.lifetime_expenditure, 0.00) AS lifetime_expenditure,
    stays.last_visit_date
FROM guest g
LEFT JOIN (
    SELECT b.guest_id, COUNT(DISTINCT b.booking_id) AS total_stays,
           MAX(brl.stay_end_date) AS last_visit_date
    FROM booking b LEFT JOIN booking_room_line brl ON brl.booking_id = b.booking_id
    GROUP BY b.guest_id
) stays ON stays.guest_id = g.guest_id
LEFT JOIN (
    SELECT b.guest_id, SUM(p.amount) AS lifetime_expenditure
    FROM booking b JOIN payment p ON p.booking_id = b.booking_id
    WHERE p.status = 'SUCCESSFUL' AND p.kind = 'PAYMENT'
    GROUP BY b.guest_id
) cash ON cash.guest_id = g.guest_id;

-- 7. Read-only audit report; sensitive before/after fields are masked by writers.
CREATE OR REPLACE VIEW view_staff_activity_audit AS
SELECT a.audit_id, a.changed_at, a.action, a.entity_name, a.entity_id,
       a.user_id AS staff_id, o.full_name AS staff_name, r.role_name AS staff_role,
       a.before_value, a.after_value, a.ip_address,
       a.user_id, u.username, b.branch_id, b.name AS branch_name
FROM audit_log a
JOIN user_account u ON u.user_id = a.user_id
LEFT JOIN officer o ON o.officer_id = u.user_id
LEFT JOIN role r ON r.role_id = o.role_id
LEFT JOIN branch b ON b.branch_id = o.branch_id;
