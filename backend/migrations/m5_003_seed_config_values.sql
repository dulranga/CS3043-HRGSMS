-- Financial values belong to Member 1's immutable billing_policy (FR-076).
-- Preserve this migration key without seeding unauthorized financial settings
-- into system_config. Administrators set registered non-financial values
-- through the audited application contract; production billing needs approval.
SELECT 1;
