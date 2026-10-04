CREATE OR REPLACE VIEW view_staff_activity_audit AS
SELECT
    a.audit_id,
    a.changed_at,
    a.action,
    a.entity_name,
    a.entity_id,
    o.officer_id AS staff_id,
    o.full_name  AS staff_name,
    r.role_name  AS staff_role,
    a.before_value,
    a.after_value,
    a.ip_address
FROM audit_log a
LEFT JOIN officer o ON a.user_id = o.officer_id
LEFT JOIN role r ON o.role_id = r.role_id;