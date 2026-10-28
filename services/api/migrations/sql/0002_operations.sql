-- Telemetry, missions, video metadata, behavior registry, and edge sync.
-- Ingest bypasses reader RLS through a definer function. Reads stay under RLS.

CREATE TABLE telemetry_samples (
  time timestamptz NOT NULL,
  id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  tail_number text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  alt_m double precision NOT NULL,
  vn double precision NOT NULL DEFAULT 0,
  ve double precision NOT NULL DEFAULT 0,
  vd double precision NOT NULL DEFAULT 0,
  heading_deg double precision,
  classification clearance_level NOT NULL DEFAULT 'UNCLASSIFIED',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  PRIMARY KEY (time, id)
);

SELECT create_hypertable('telemetry_samples', 'time', if_not_exists => TRUE);

CREATE INDEX telemetry_tail_idx ON telemetry_samples (tenant_id, tail_number, time DESC);

CREATE TABLE tracks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'target',
  classification clearance_level NOT NULL DEFAULT 'UNCLASSIFIED',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  CONSTRAINT track_kind CHECK (kind IN ('target', 'clutter', 'friendly'))
);

CREATE TABLE missions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  requested_by uuid NOT NULL REFERENCES users (id),
  approved_by uuid REFERENCES users (id),
  summary text NOT NULL DEFAULT '',
  planned_start timestamptz,
  planned_end timestamptz,
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mission_state CHECK (state IN ('draft', 'review', 'approved', 'active', 'closed')),
  CONSTRAINT mission_two_person CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TABLE mission_tasks (
  id uuid PRIMARY KEY,
  mission_id uuid NOT NULL REFERENCES missions (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  platform_id uuid REFERENCES platforms (id),
  kind text NOT NULL,
  geometry jsonb NOT NULL DEFAULT '{}',
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  CONSTRAINT task_kind CHECK (kind IN ('transit', 'search', 'sensor_custody', 'loiter', 'rtb'))
);

CREATE TABLE restricted_volumes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  mission_id uuid REFERENCES missions (id),
  name text NOT NULL,
  floor_m double precision NOT NULL,
  ceiling_m double precision NOT NULL,
  polygon jsonb NOT NULL,
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT ''
);

CREATE TABLE video_streams (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  platform_id uuid REFERENCES platforms (id),
  name text NOT NULL,
  protocol text NOT NULL,
  path text NOT NULL,
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  CONSTRAINT video_protocol CHECK (protocol IN ('rtsp', 'srt'))
);

CREATE TABLE behavior_packages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  version text NOT NULL,
  promotion text NOT NULL,
  manifest jsonb NOT NULL,
  digest text NOT NULL,
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  CONSTRAINT behavior_promotion CHECK (promotion IN ('sim_validated', 'hitl_validated', 'flight_cleared'))
);

CREATE TABLE sync_operations (
  event_id uuid PRIMARY KEY,
  node_id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  kind text NOT NULL,
  record_id text NOT NULL,
  body_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  CONSTRAINT sync_kind CHECK (kind IN ('telemetry', 'audit', 'mission', 'custody'))
);

CREATE TABLE sync_conflicts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  record_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  CONSTRAINT conflict_status CHECK (status IN ('open', 'resolved'))
);

CREATE TABLE usage_meters (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  day date NOT NULL,
  telemetry_samples bigint NOT NULL DEFAULT 0,
  export_count bigint NOT NULL DEFAULT 0,
  sim_seconds double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
);

CREATE TRIGGER telemetry_mark BEFORE INSERT OR UPDATE ON telemetry_samples
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER tracks_mark BEFORE INSERT OR UPDATE ON tracks
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER missions_mark BEFORE INSERT OR UPDATE ON missions
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER tasks_mark BEFORE INSERT OR UPDATE ON mission_tasks
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER volumes_mark BEFORE INSERT OR UPDATE ON restricted_volumes
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER video_mark BEFORE INSERT OR UPDATE ON video_streams
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER behavior_mark BEFORE INSERT OR UPDATE ON behavior_packages
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER sync_mark BEFORE INSERT OR UPDATE ON sync_operations
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER conflict_mark BEFORE INSERT OR UPDATE ON sync_conflicts
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();

CREATE OR REPLACE FUNCTION ingest_telemetry_batch(payload jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  item jsonb;
  inserted integer := 0;
  sys_high clearance_level;
BEGIN
  SELECT system_high INTO sys_high FROM system_policy WHERE id = 1;
  FOR item IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    IF app_clearance_rank((item->>'classification')::clearance_level) > app_clearance_rank(sys_high) THEN
      RAISE EXCEPTION 'above_system_high';
    END IF;
    INSERT INTO telemetry_samples (
      time, id, tenant_id, tail_number, lat, lon, alt_m, vn, ve, vd, heading_deg,
      classification, caveats, ntk_programs
    ) VALUES (
      (item->>'time')::timestamptz,
      (item->>'id')::uuid,
      (item->>'tenant_id')::uuid,
      item->>'tail_number',
      (item->>'lat')::double precision,
      (item->>'lon')::double precision,
      (item->>'alt_m')::double precision,
      COALESCE((item->>'vn')::double precision, 0),
      COALESCE((item->>'ve')::double precision, 0),
      COALESCE((item->>'vd')::double precision, 0),
      (item->>'heading_deg')::double precision,
      (item->>'classification')::clearance_level,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(item->'caveats')), ARRAY[]::text[]),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(item->'ntk_programs')), ARRAY[]::text[])
    );
    inserted := inserted + 1;
  END LOOP;
  RETURN inserted;
END;
$fn$;

ALTER TABLE telemetry_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_samples FORCE ROW LEVEL SECURITY;
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracks FORCE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions FORCE ROW LEVEL SECURITY;
ALTER TABLE mission_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE restricted_volumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE restricted_volumes FORCE ROW LEVEL SECURITY;
ALTER TABLE video_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_streams FORCE ROW LEVEL SECURITY;
ALTER TABLE behavior_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;

CREATE POLICY telemetry_select ON telemetry_samples FOR SELECT
USING (app_can_read_marked(tenant_id, 'telemetry', classification, caveats, ntk_programs));
CREATE POLICY tracks_select ON tracks FOR SELECT
USING (app_can_read_marked(tenant_id, 'telemetry', classification, caveats, ntk_programs));
CREATE POLICY missions_select ON missions FOR SELECT
USING (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs));
CREATE POLICY missions_insert ON missions FOR INSERT
WITH CHECK (
  state = 'draft'
  AND requested_by = app_user_id()
  AND app_action_permitted('mission.draft', tenant_id)
  AND app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs)
);
CREATE POLICY missions_update ON missions FOR UPDATE
USING (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs))
WITH CHECK (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs));
CREATE POLICY tasks_all ON mission_tasks FOR ALL
USING (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs))
WITH CHECK (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs));
CREATE POLICY volumes_all ON restricted_volumes FOR ALL
USING (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs))
WITH CHECK (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs));
CREATE POLICY video_select ON video_streams FOR SELECT
USING (app_can_read_marked(tenant_id, 'video', classification, caveats, ntk_programs));
CREATE POLICY video_insert ON video_streams FOR INSERT
WITH CHECK (
  app_action_permitted('video.manage', tenant_id)
  AND app_can_read_marked(tenant_id, 'video', classification, caveats, ntk_programs)
);
CREATE POLICY behavior_select ON behavior_packages FOR SELECT
USING (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs));
CREATE POLICY behavior_insert ON behavior_packages FOR INSERT
WITH CHECK (
  app_action_permitted('behavior.promote', tenant_id)
  AND app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs)
);
CREATE POLICY sync_select ON sync_operations FOR SELECT
USING (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs));
CREATE POLICY conflict_select ON sync_conflicts FOR SELECT
USING (app_can_read_marked(tenant_id, 'mission', classification, caveats, ntk_programs));

GRANT SELECT ON telemetry_samples, tracks, missions, mission_tasks, restricted_volumes,
  video_streams, behavior_packages, sync_operations, sync_conflicts TO a2e_app;
GRANT INSERT, UPDATE ON missions, mission_tasks, restricted_volumes, video_streams,
  behavior_packages, sync_operations, sync_conflicts TO a2e_app;
GRANT EXECUTE ON FUNCTION ingest_telemetry_batch(jsonb) TO a2e_app;
GRANT SELECT, INSERT ON usage_meters TO a2e_app;

ALTER TABLE usage_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_meters FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_select ON usage_meters FOR SELECT
USING (tenant_id IN (SELECT app_hierarchy_tenant_ids()));
CREATE POLICY usage_insert ON usage_meters FOR INSERT
WITH CHECK (tenant_id IN (SELECT app_hierarchy_tenant_ids()));
