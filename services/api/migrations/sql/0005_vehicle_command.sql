-- Operators may arm, change mode, take off, and land. The audit row is the approval record.
INSERT INTO role_permissions (role, action)
VALUES
  ('admin'::user_role, 'vehicle.command'),
  ('mission_commander'::user_role, 'vehicle.command'),
  ('operator'::user_role, 'vehicle.command')
ON CONFLICT DO NOTHING;
