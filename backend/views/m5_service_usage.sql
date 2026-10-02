CREATE OR REPLACE VIEW view_service_usage AS
SELECT 
    s.service_id,
    s.service_name,
    COUNT(so.service_order_id) AS total_orders,
    COALESCE(SUM(so.quantity), 0) AS total_quantity_consumed,
    COALESCE(SUM(so.total_price), 0.00) AS total_revenue_generated
FROM service s
LEFT JOIN service_order so ON s.service_id = so.service_id
GROUP BY s.service_id, s.service_name;