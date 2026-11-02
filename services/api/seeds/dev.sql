-- Dev seed only. Fictional subordinate units. Not for production.
-- Loaded by bootstrap when A2E_SEED=1 and A2E_ENV is not production.

INSERT INTO tenants (id, parent_id, level, name, code, branch_code, classification, caveats)
VALUES
  ('11111111-1111-4111-8111-111111111101', NULL, 'branch', 'United States Air Force', 'USAF', 'USAF', 'CUI', '{}'),
  ('11111111-1111-4111-8111-111111111201', NULL, 'branch', 'United States Army', 'USA', 'USA', 'CUI', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, parent_id, level, name, code, branch_code, classification, caveats)
VALUES
  ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111101', 'command', 'Demonstration Air Command', 'USAF-DAC', 'USAF', 'CUI', '{}'),
  ('11111111-1111-4111-8111-111111111202', '11111111-1111-4111-8111-111111111201', 'command', 'Demonstration Land Command', 'USA-DLC', 'USA', 'CUI', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, parent_id, level, name, code, branch_code, classification, caveats)
VALUES
  ('11111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111102', 'unit', 'Detachment 77 (Demo)', 'USAF-DAC-DET77', 'USAF', 'CUI', '{}'),
  ('11111111-1111-4111-8111-111111111203', '11111111-1111-4111-8111-111111111202', 'unit', 'Demonstration Battalion', 'USA-DLC-BN1', 'USA', 'CUI', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, parent_id, level, name, code, branch_code, classification, caveats)
VALUES
  ('11111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111103', 'team', 'Team North', 'USAF-DAC-DET77-NORTH', 'USAF', 'CUI', '{}'),
  ('11111111-1111-4111-8111-111111111105', '11111111-1111-4111-8111-111111111103', 'team', 'Team South', 'USAF-DAC-DET77-SOUTH', 'USAF', 'CUI', '{}'),
  ('11111111-1111-4111-8111-111111111204', '11111111-1111-4111-8111-111111111203', 'team', 'Team Falcon', 'USA-DLC-BN1-FALCON', 'USA', 'CUI', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (
  id, keycloak_sub, username, email, display_name, citizenship, clearance, ntk_programs, classification, caveats
) VALUES
  ('22222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222201', 'ada.admin', 'ada.admin@demo.invalid', 'Ada Admin', 'USA', 'CUI', '{isr-demo}', 'CUI', '{}'),
  ('22222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222202', 'carl.commander', 'carl.commander@demo.invalid', 'Carl Commander', 'USA', 'CUI', '{isr-demo}', 'CUI', '{}'),
  ('22222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222203', 'priya.planner', 'priya.planner@demo.invalid', 'Priya Planner', 'USA', 'CUI', '{isr-demo}', 'CUI', '{}'),
  ('22222222-2222-4222-8222-222222222204', '22222222-2222-4222-8222-222222222204', 'owen.operator', 'owen.operator@demo.invalid', 'Owen Operator', 'USA', 'UNCLASSIFIED', '{}', 'CUI', '{}'),
  ('22222222-2222-4222-8222-222222222205', '22222222-2222-4222-8222-222222222205', 'gwen.analyst', 'gwen.analyst@demo.invalid', 'Gwen Analyst', 'GBR', 'CUI', '{isr-demo}', 'CUI', '{}'),
  ('22222222-2222-4222-8222-222222222206', '22222222-2222-4222-8222-222222222206', 'mike.maintainer', 'mike.maintainer@demo.invalid', 'Mike Maintainer', 'USA', 'CUI', '{isr-demo}', 'CUI', '{}'),
  ('22222222-2222-4222-8222-222222222207', '22222222-2222-4222-8222-222222222207', 'audrey.auditor', 'audrey.auditor@demo.invalid', 'Audrey Auditor', 'USA', 'CUI', '{isr-demo}', 'CUI', '{}'),
  ('22222222-2222-4222-8222-222222222208', '22222222-2222-4222-8222-222222222208', 'una.south', 'una.south@demo.invalid', 'Una South', 'USA', 'CUI', '{isr-demo}', 'CUI', '{}'),
  ('22222222-2222-4222-8222-222222222209', '22222222-2222-4222-8222-222222222209', 'frank.falcon', 'frank.falcon@demo.invalid', 'Frank Falcon', 'USA', 'CUI', '{isr-demo}', 'CUI', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_memberships (user_id, tenant_id, role) VALUES
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111104', 'admin'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111104', 'mission_commander'),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111104', 'planner'),
  ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111104', 'operator'),
  ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111104', 'analyst'),
  ('22222222-2222-4222-8222-222222222206', '11111111-1111-4111-8111-111111111104', 'maintainer'),
  ('22222222-2222-4222-8222-222222222207', '11111111-1111-4111-8111-111111111104', 'auditor'),
  ('22222222-2222-4222-8222-222222222208', '11111111-1111-4111-8111-111111111105', 'analyst'),
  ('22222222-2222-4222-8222-222222222209', '11111111-1111-4111-8111-111111111204', 'analyst')
ON CONFLICT (user_id, tenant_id, role) DO NOTHING;

INSERT INTO sharing_agreements (
  id, provider_tenant_id, consumer_tenant_id, categories, access, max_classification,
  allow_noforn, include_descendants, purpose, status, requested_by, approved_by, approved_at,
  expires_at, classification, caveats
) VALUES (
  '44444444-4444-4444-8444-444444444401',
  '11111111-1111-4111-8111-111111111104',
  '11111111-1111-4111-8111-111111111204',
  ARRAY['fleet'],
  'read',
  'CUI',
  false,
  false,
  'Demo ISR fleet read for a joint exercise',
  'active',
  '22222222-2222-4222-8222-222222222201',
  '22222222-2222-4222-8222-222222222202',
  now(),
  now() + interval '180 days',
  'CUI',
  '{}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO platforms (
  id, tenant_id, tail_number, designation, group_size, serial_number, airworthiness,
  home_station, software_version, classification, caveats, ntk_programs
) VALUES
  (
    '33333333-3333-4333-8333-333333333301',
    '11111111-1111-4111-8111-111111111104',
    'N-001', 'A2E-G1-QUAD', 'group_1', 'SN-N-001', 'airworthy',
    'Demo Range North', '0.1.0', 'CUI', ARRAY['NOFORN'], ARRAY['isr-demo']
  ),
  (
    '33333333-3333-4333-8333-333333333302',
    '11111111-1111-4111-8111-111111111104',
    'N-002', 'A2E-G2-VTOL', 'group_2', 'SN-N-002', 'airworthy',
    'Demo Range North', '0.1.0', 'CUI', ARRAY['REL TO USA, GBR'], ARRAY[]::text[]
  ),
  (
    '33333333-3333-4333-8333-333333333303',
    '11111111-1111-4111-8111-111111111104',
    'N-003', 'A2E-G3-FW', 'group_3', 'SN-N-003', 'restricted',
    'Demo Range North', '0.1.0', 'UNCLASSIFIED', ARRAY[]::text[], ARRAY[]::text[]
  ),
  (
    '33333333-3333-4333-8333-333333333304',
    '11111111-1111-4111-8111-111111111105',
    'S-001', 'A2E-G1-QUAD', 'group_1', 'SN-S-001', 'airworthy',
    'Demo Range South', '0.1.0', 'UNCLASSIFIED', ARRAY[]::text[], ARRAY[]::text[]
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO payloads (id, platform_id, tenant_id, kind, name, firmware, classification, caveats, ntk_programs)
VALUES (
  '55555555-5555-4555-8555-555555555501',
  '33333333-3333-4333-8333-333333333301',
  '11111111-1111-4111-8111-111111111104',
  'eo_ir', 'EO/IR turret', '1.0.0', 'CUI', ARRAY['NOFORN'], ARRAY['isr-demo']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO ground_stations (id, tenant_id, name, lat, lon, alt_m, classification, caveats)
VALUES (
  '66666666-6666-4666-8666-666666666601',
  '11111111-1111-4111-8111-111111111104',
  'Demo Range North',
  34.0500,
  -106.2000,
  1450,
  'UNCLASSIFIED',
  '{}'
),
(
  '66666666-6666-4666-8666-666666666602',
  '11111111-1111-4111-8111-111111111104',
  'Demo Range East',
  40.2000,
  -80.4000,
  280,
  'UNCLASSIFIED',
  '{}'
),
(
  '66666666-6666-4666-8666-666666666603',
  '11111111-1111-4111-8111-111111111104',
  'Demo Range West',
  37.4000,
  -121.8000,
  20,
  'UNCLASSIFIED',
  '{}'
),
(
  '66666666-6666-4666-8666-666666666604',
  '11111111-1111-4111-8111-111111111105',
  'Demo Range South',
  28.6000,
  -82.4000,
  15,
  'UNCLASSIFIED',
  '{}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO software_loads (id, platform_id, tenant_id, component, version, classification, caveats, ntk_programs)
VALUES (
  '77777777-7777-4777-8777-777777777701',
  '33333333-3333-4333-8333-333333333301',
  '11111111-1111-4111-8111-111111111104',
  'flight-stack', '0.1.0', 'CUI', ARRAY['NOFORN'], ARRAY['isr-demo']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO maintenance_events (
  id, platform_id, tenant_id, summary, status, classification, caveats, ntk_programs
) VALUES (
  '88888888-8888-4888-8888-888888888801',
  '33333333-3333-4333-8333-333333333303',
  '11111111-1111-4111-8111-111111111104',
  'Demo inspection open',
  'open',
  'UNCLASSIFIED',
  '{}',
  '{}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO missions (id, tenant_id, name, state, requested_by, approved_by, summary, classification, caveats)
VALUES
  ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111104', 'North range survey', 'review', '22222222-2222-4222-8222-222222222203', NULL, 'Transit, search, and return over the demo range. Waiting on a second person to approve.', 'CUI', '{"REL TO USA, GBR"}'),
  ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111104', 'North track custody', 'approved', '22222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222202', 'Hold sensor custody on the north track. Execute stays with a human.', 'CUI', '{"REL TO USA, GBR"}'),
  ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111104', 'Return-to-base drill', 'draft', '22222222-2222-4222-8222-222222222203', NULL, 'Draft only. Not submitted for review.', 'UNCLASSIFIED', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mission_tasks (id, mission_id, tenant_id, platform_id, kind, classification, caveats)
VALUES
  ('55555555-5555-4555-8555-555555555501', '44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111104', '33333333-3333-4333-8333-333333333302', 'transit', 'CUI', '{"REL TO USA, GBR"}'),
  ('55555555-5555-4555-8555-555555555502', '44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111104', '33333333-3333-4333-8333-333333333302', 'search', 'CUI', '{"REL TO USA, GBR"}'),
  ('55555555-5555-4555-8555-555555555503', '44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111104', '33333333-3333-4333-8333-333333333303', 'rtb', 'UNCLASSIFIED', '{}')
ON CONFLICT (id) DO NOTHING;

UPDATE mission_tasks SET geometry = '{"order":1,"label":"Depart the demo range","lat":34.05,"lon":-106.2,"alt_m":150}'::jsonb WHERE id = '55555555-5555-4555-8555-555555555501';
UPDATE mission_tasks SET geometry = '{"order":2,"label":"Search the range box","lat":34.12,"lon":-105.9,"alt_m":200}'::jsonb WHERE id = '55555555-5555-4555-8555-555555555502';
UPDATE mission_tasks SET geometry = '{"order":3,"label":"Return to the range","lat":34.05,"lon":-106.2,"alt_m":120}'::jsonb WHERE id = '55555555-5555-4555-8555-555555555503';

INSERT INTO mission_tasks (id, mission_id, tenant_id, kind, geometry, classification, caveats)
VALUES
  ('55555555-5555-4555-8555-555555555511', '44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111104', 'transit', '{"order":1,"label":"Depart demo range","lat":34.05,"lon":-106.2,"alt_m":120}', 'UNCLASSIFIED', '{}'),
  ('55555555-5555-4555-8555-555555555512', '44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111104', 'search', '{"order":2,"label":"Search the North Atlantic","lat":36.5,"lon":-40.0,"alt_m":250}', 'UNCLASSIFIED', '{}'),
  ('55555555-5555-4555-8555-555555555513', '44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111104', 'sensor_custody', '{"order":3,"label":"Hold the Gulf of Guinea track","lat":3.8,"lon":5.6,"alt_m":300}', 'UNCLASSIFIED', '{}'),
  ('55555555-5555-4555-8555-555555555514', '44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111104', 'loiter', '{"order":4,"label":"Loiter over the Mediterranean","lat":35.2,"lon":18.4,"alt_m":180}', 'UNCLASSIFIED', '{}'),
  ('55555555-5555-4555-8555-555555555515', '44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111104', 'rtb', '{"order":5,"label":"Recover at the demo range","lat":34.05,"lon":-106.2,"alt_m":80}', 'UNCLASSIFIED', '{}')
ON CONFLICT (id) DO NOTHING;
