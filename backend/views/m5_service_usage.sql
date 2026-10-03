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