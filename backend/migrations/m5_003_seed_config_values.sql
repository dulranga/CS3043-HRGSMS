INSERT INTO system_config (config_key, config_value, effective_from)
VALUES 
  ('cancellation_fee_rate', '0.10', CURRENT_DATE),
  ('tax_rate', '0.08', CURRENT_DATE),
  ('service_charge_rate', '0.05', CURRENT_DATE),
  ('late_checkout_amount', '2000.00', CURRENT_DATE),
  ('discount_rate', '0.00', CURRENT_DATE)
ON CONFLICT (config_key) DO UPDATE 
SET config_value = EXCLUDED.config_value;