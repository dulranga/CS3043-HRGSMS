CREATE OR REPLACE VIEW view_staff_activity_audit AS
SELECT
    a.log_id,
    a.timestamp,
    a.action_type,
    a.target_table,
    a.record_id,
    st.staff_id,
    CONCAT(st.first_name, ' ', st.last_name) AS staff_name,  --  to join the full name 
    st.role AS staff_role,
    a.old_values,
    a.new_values
FROM audit_log a
LEFT JOIN staff st ON a.user_id = st.staff_id;