-- Operators may record a visual lock, a loss, or an abort. The audit row is the record.
INSERT INTO role_permissions (role, action)
VALUES
  ('admin'::user_role, 'vehicle.track'),
  ('mission_commander'::user_role, 'vehicle.track'),
  ('operator'::user_role, 'vehicle.track')
ON CONFLICT DO NOTHING;
