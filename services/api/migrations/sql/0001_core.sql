-- A2E Mission Cloud core schema.
-- Tenant isolation is row-level security. The app role cannot bypass it.
-- STUB: sharing access read_write does not grant cross-tenant writes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

DO $$ BEGIN
  CREATE ROLE a2e_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER ROLE a2e_app SET row_security = on;
ALTER ROLE a2e_app SET statement_timeout = '15s';
ALTER ROLE a2e_app SET idle_in_transaction_session_timeout = '30s';

DO $$ BEGIN
  CREATE TYPE org_level AS ENUM ('branch', 'command', 'unit', 'team');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE clearance_level AS ENUM (
    'UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'admin', 'mission_commander', 'planner', 'operator', 'analyst', 'maintainer', 'auditor'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sharing_status AS ENUM ('draft', 'active', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sharing_access AS ENUM ('read', 'read_write');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE platform_group AS ENUM ('group_1', 'group_2', 'group_3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Sensors and a communications relay only. No weapon, store, or effector.
DO $$ BEGIN
  CREATE TYPE payload_kind AS ENUM (
    'eo', 'ir', 'eo_ir', 'sar', 'lidar', 'comms_relay', 'acoustic'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE airworthiness_status AS ENUM ('airworthy', 'restricted', 'grounded', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE custody_event_type AS ENUM ('accept', 'transfer', 'release', 'inventory');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE system_policy (
  id integer PRIMARY KEY CHECK (id = 1),
  system_high clearance_level NOT NULL,
  max_release clearance_level NOT NULL
);

CREATE TABLE role_permissions (
  role user_role NOT NULL,
  action text NOT NULL,
  PRIMARY KEY (role, action)
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES tenants (id),
  level org_level NOT NULL,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  branch_code text NOT NULL,
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_sub text NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL,
  citizenship text NOT NULL,
  clearance clearance_level NOT NULL,
  ntk_programs text[] NOT NULL DEFAULT '{}',
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CONSTRAINT users_citizenship_alpha3 CHECK (citizenship ~ '^[A-Z]{3}$')
);

CREATE TABLE user_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  role user_role NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  UNIQUE (user_id, tenant_id, role)
);

CREATE TABLE sharing_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_tenant_id uuid NOT NULL REFERENCES tenants (id),
  consumer_tenant_id uuid NOT NULL REFERENCES tenants (id),
  categories text[] NOT NULL,
  access sharing_access NOT NULL DEFAULT 'read',
  max_classification clearance_level NOT NULL DEFAULT 'CUI',
  allow_noforn boolean NOT NULL DEFAULT false,
  include_descendants boolean NOT NULL DEFAULT false,
  purpose text NOT NULL,
  status sharing_status NOT NULL DEFAULT 'draft',
  requested_by uuid NOT NULL REFERENCES users (id),
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  expires_at timestamptz NOT NULL,
  classification clearance_level NOT NULL DEFAULT 'CUI',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sharing_distinct_parties CHECK (provider_tenant_id <> consumer_tenant_id),
  CONSTRAINT sharing_categories_known CHECK (
    cardinality(categories) > 0
    AND categories <@ ARRAY['fleet', 'mission', 'telemetry', 'video']::text[]
  ),
  CONSTRAINT sharing_two_person CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT sharing_active_has_approver CHECK (
    status <> 'active' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE TABLE platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  tail_number text NOT NULL,
  designation text NOT NULL,
  group_size platform_group NOT NULL,
  serial_number text NOT NULL,
  airworthiness airworthiness_status NOT NULL DEFAULT 'unknown',
  home_station text,
  software_version text,
  classification clearance_level NOT NULL DEFAULT 'UNCLASSIFIED',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tail_number),
  CONSTRAINT platforms_tail CHECK (tail_number ~ '^[A-Z0-9-]{2,16}$')
);

CREATE TABLE payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id uuid NOT NULL REFERENCES platforms (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  kind payload_kind NOT NULL,
  name text NOT NULL,
  firmware text,
  classification clearance_level NOT NULL DEFAULT 'UNCLASSIFIED',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ground_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  alt_m double precision NOT NULL DEFAULT 0,
  geog geography(Point, 4326) GENERATED ALWAYS AS (
    (ST_SetSRID(ST_MakePoint(lon, lat), 4326))::geography
  ) STORED,
  classification clearance_level NOT NULL DEFAULT 'UNCLASSIFIED',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ground_stations_lat CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT ground_stations_lon CHECK (lon BETWEEN -180 AND 180)
);

CREATE TABLE software_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id uuid NOT NULL REFERENCES platforms (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  component text NOT NULL,
  version text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  classification clearance_level NOT NULL DEFAULT 'UNCLASSIFIED',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id uuid NOT NULL REFERENCES platforms (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  classification clearance_level NOT NULL DEFAULT 'UNCLASSIFIED',
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  CONSTRAINT maintenance_status CHECK (status IN ('open', 'closed'))
);

CREATE TABLE custody_chain_head (
  platform_id uuid PRIMARY KEY REFERENCES platforms (id),
  last_hash text NOT NULL
);

CREATE TABLE custody_events (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  platform_id uuid NOT NULL REFERENCES platforms (id),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  event_type custody_event_type NOT NULL,
  from_user_id uuid REFERENCES users (id),
  to_user_id uuid REFERENCES users (id),
  location text NOT NULL,
  occurred_at timestamptz NOT NULL,
  canonical text NOT NULL,
  prev_hash text NOT NULL,
  row_hash text NOT NULL,
  classification clearance_level NOT NULL,
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT ''
);

CREATE TABLE audit_chain_head (
  id integer PRIMARY KEY CHECK (id = 1),
  last_hash text NOT NULL
);

CREATE TABLE audit_events (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  tenant_id uuid REFERENCES tenants (id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  decision text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  classification clearance_level NOT NULL,
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  canonical text NOT NULL,
  prev_hash text NOT NULL,
  row_hash text NOT NULL,
  portion_mark text NOT NULL DEFAULT '',
  CONSTRAINT audit_decision CHECK (decision IN ('allow', 'deny'))
);

CREATE TABLE export_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  actor_id uuid NOT NULL REFERENCES users (id),
  recipient_id uuid NOT NULL REFERENCES users (id),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  purpose text NOT NULL,
  format text NOT NULL,
  banner text NOT NULL,
  nonce bytea NOT NULL,
  sealed_payload bytea NOT NULL,
  audit_id uuid NOT NULL,
  classification clearance_level NOT NULL,
  caveats text[] NOT NULL DEFAULT '{}',
  ntk_programs text[] NOT NULL DEFAULT '{}',
  portion_mark text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenants_parent_idx ON tenants (parent_id);
CREATE INDEX memberships_user_idx ON user_memberships (user_id);
CREATE INDEX platforms_tenant_idx ON platforms (tenant_id);
CREATE INDEX payloads_platform_idx ON payloads (platform_id);
CREATE INDEX audit_tenant_idx ON audit_events (tenant_id);

CREATE OR REPLACE FUNCTION app_subject() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(NULLIF(current_setting('app.subject', true), ''), '')
$fn$;

CREATE OR REPLACE FUNCTION app_clearance_rank(c clearance_level) RETURNS integer
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE c
    WHEN 'UNCLASSIFIED' THEN 0
    WHEN 'CUI' THEN 1
    WHEN 'CONFIDENTIAL' THEN 2
    WHEN 'SECRET' THEN 3
    WHEN 'TOP_SECRET' THEN 4
    ELSE NULL
  END
$fn$;

CREATE OR REPLACE FUNCTION caveats_understood(caveats text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  c text;
  token text;
  body text;
BEGIN
  IF caveats IS NULL THEN
    RETURN true;
  END IF;
  FOREACH c IN ARRAY caveats LOOP
    IF c = 'NOFORN' THEN
      CONTINUE;
    ELSIF c LIKE 'REL TO %' THEN
      body := substring(c FROM 8);
      IF body IS NULL OR btrim(body) = '' THEN
        RETURN false;
      END IF;
      FOREACH token IN ARRAY regexp_split_to_array(body, '[, ]+') LOOP
        IF token IS NULL OR token = '' THEN
          CONTINUE;
        END IF;
        IF token = 'FVEY' THEN
          CONTINUE;
        END IF;
        IF token !~ '^[A-Z]{3}$' THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION caveat_allows_citizenship(caveats text[], citizenship text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  c text;
  token text;
  body text;
  has_rel boolean := false;
  ok boolean := false;
BEGIN
  IF citizenship IS NULL OR citizenship !~ '^[A-Z]{3}$' THEN
    RETURN false;
  END IF;
  IF NOT caveats_understood(COALESCE(caveats, ARRAY[]::text[])) THEN
    RETURN false;
  END IF;
  IF 'NOFORN' = ANY (COALESCE(caveats, ARRAY[]::text[])) AND citizenship <> 'USA' THEN
    RETURN false;
  END IF;
  FOREACH c IN ARRAY COALESCE(caveats, ARRAY[]::text[]) LOOP
    IF c LIKE 'REL TO %' THEN
      has_rel := true;
      body := substring(c FROM 8);
      FOREACH token IN ARRAY regexp_split_to_array(body, '[, ]+') LOOP
        IF token = '' OR token IS NULL THEN
          CONTINUE;
        END IF;
        IF token = 'FVEY' AND citizenship IN ('USA', 'GBR', 'CAN', 'AUS', 'NZL') THEN
          ok := true;
        ELSIF token = citizenship THEN
          ok := true;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF has_rel AND NOT ok THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION expected_portion_mark(c clearance_level, caveats text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  label text;
  extra text;
BEGIN
  label := CASE c
    WHEN 'UNCLASSIFIED' THEN 'U'
    WHEN 'CUI' THEN 'CUI'
    WHEN 'CONFIDENTIAL' THEN 'C'
    WHEN 'SECRET' THEN 'S'
    WHEN 'TOP_SECRET' THEN 'TS'
    ELSE NULL
  END;
  IF label IS NULL THEN
    RAISE EXCEPTION 'unknown classification';
  END IF;
  IF caveats IS NULL OR cardinality(caveats) = 0 THEN
    RETURN '(' || label || ')';
  END IF;
  SELECT string_agg(x, '/' ORDER BY ord) INTO extra
  FROM unnest(caveats) WITH ORDINALITY AS t(x, ord);
  RETURN '(' || label || '//' || extra || ')';
END;
$fn$;

CREATE OR REPLACE FUNCTION set_portion_mark() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT caveats_understood(COALESCE(NEW.caveats, ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'unknown caveat';
  END IF;
  NEW.portion_mark := expected_portion_mark(NEW.classification, COALESCE(NEW.caveats, ARRAY[]::text[]));
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'append-only';
END;
$fn$;

CREATE OR REPLACE FUNCTION reject_tenant_change() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_change_forbidden';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION tenant_parent_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  parent_level org_level;
BEGIN
  IF NEW.level = 'branch' THEN
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'branch cannot have a parent';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'non-branch requires parent';
  END IF;
  SELECT level INTO parent_level FROM tenants WHERE id = NEW.parent_id;
  IF parent_level IS NULL THEN
    RAISE EXCEPTION 'parent missing';
  END IF;
  IF NEW.level = 'command' AND parent_level <> 'branch' THEN
    RAISE EXCEPTION 'command parent must be branch';
  ELSIF NEW.level = 'unit' AND parent_level <> 'command' THEN
    RAISE EXCEPTION 'unit parent must be command';
  ELSIF NEW.level = 'team' AND parent_level <> 'unit' THEN
    RAISE EXCEPTION 'team parent must be unit';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION marking_visible(
  p_classification clearance_level,
  p_caveats text[],
  p_ntk text[]
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  u_clearance clearance_level;
  u_citizenship text;
  u_ntk text[];
  sys_high clearance_level;
  row_rank integer;
  user_rank integer;
  high_rank integer;
BEGIN
  SELECT clearance, citizenship, ntk_programs
    INTO u_clearance, u_citizenship, u_ntk
  FROM users
  WHERE keycloak_sub = app_subject()
    AND disabled_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT system_high INTO sys_high FROM system_policy WHERE id = 1;
  row_rank := app_clearance_rank(p_classification);
  user_rank := app_clearance_rank(u_clearance);
  high_rank := app_clearance_rank(sys_high);
  IF row_rank IS NULL OR user_rank IS NULL OR high_rank IS NULL THEN
    RETURN false;
  END IF;
  IF row_rank > high_rank THEN
    RETURN false;
  END IF;
  IF user_rank < row_rank THEN
    RETURN false;
  END IF;
  IF NOT caveat_allows_citizenship(p_caveats, u_citizenship) THEN
    RETURN false;
  END IF;
  IF p_ntk IS NOT NULL AND cardinality(p_ntk) > 0 THEN
    IF u_ntk IS NULL OR NOT (p_ntk && u_ntk) THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT id FROM users
  WHERE keycloak_sub = app_subject() AND disabled_at IS NULL
$fn$;

CREATE OR REPLACE FUNCTION tenant_descendants(root uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  WITH RECURSIVE walk AS (
    SELECT id FROM tenants WHERE id = root
    UNION ALL
    SELECT c.id FROM tenants c JOIN walk w ON c.parent_id = w.id
  )
  SELECT id FROM walk
$fn$;

CREATE OR REPLACE FUNCTION user_hierarchy_tenant_ids(p_user uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  WITH RECURSIVE walk AS (
    SELECT t.id
    FROM tenants t
    JOIN user_memberships m ON m.tenant_id = t.id
    WHERE m.user_id = p_user
      AND m.valid_from <= now()
      AND (m.valid_to IS NULL OR m.valid_to > now())
    UNION ALL
    SELECT c.id FROM tenants c JOIN walk w ON c.parent_id = w.id
  )
  SELECT DISTINCT id FROM walk
$fn$;

CREATE OR REPLACE FUNCTION app_hierarchy_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT user_hierarchy_tenant_ids(app_user_id())
$fn$;

CREATE OR REPLACE FUNCTION app_roles_for(p_tenant uuid) RETURNS SETOF user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT DISTINCT m.role
  FROM user_memberships m
  JOIN users u ON u.id = m.user_id
  WHERE u.keycloak_sub = app_subject()
    AND u.disabled_at IS NULL
    AND m.valid_from <= now()
    AND (m.valid_to IS NULL OR m.valid_to > now())
    AND (
      p_tenant IS NULL
      OR p_tenant IN (SELECT tenant_descendants(m.tenant_id))
    )
$fn$;

CREATE OR REPLACE FUNCTION app_action_permitted(p_action text, p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM app_roles_for(p_tenant) AS r(role)
    JOIN role_permissions p ON p.role = r.role AND p.action = p_action
  )
$fn$;

CREATE OR REPLACE FUNCTION app_readable_tenant_ids(p_category text) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT app_hierarchy_tenant_ids()
  UNION
  SELECT d.id
  FROM sharing_agreements sa
  JOIN LATERAL tenant_descendants(sa.provider_tenant_id) AS d(id) ON true
  WHERE p_category IN ('fleet', 'mission', 'telemetry', 'video')
    AND sa.status = 'active'
    AND sa.expires_at > now()
    AND p_category = ANY (sa.categories)
    AND sa.consumer_tenant_id IN (SELECT app_hierarchy_tenant_ids())
    AND (sa.include_descendants OR d.id = sa.provider_tenant_id)
$fn$;

CREATE OR REPLACE FUNCTION app_can_read_marked(
  p_tenant uuid,
  p_category text,
  p_classification clearance_level,
  p_caveats text[],
  p_ntk text[]
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  in_hierarchy boolean;
  agreement_ok boolean;
BEGIN
  IF app_subject() = '' THEN
    RETURN false;
  END IF;
  IF NOT marking_visible(p_classification, p_caveats, p_ntk) THEN
    RETURN false;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM app_hierarchy_tenant_ids() AS h(id) WHERE h.id = p_tenant
  ) INTO in_hierarchy;
  IF p_category = 'audit' THEN
    RETURN in_hierarchy AND app_action_permitted('audit.read', p_tenant);
  END IF;
  IF in_hierarchy THEN
    RETURN true;
  END IF;
  IF p_category NOT IN ('fleet', 'mission', 'telemetry', 'video') THEN
    RETURN false;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM sharing_agreements sa
    WHERE sa.status = 'active'
      AND sa.expires_at > now()
      AND p_category = ANY (sa.categories)
      AND sa.consumer_tenant_id IN (SELECT app_hierarchy_tenant_ids())
      AND (
        (NOT sa.include_descendants AND sa.provider_tenant_id = p_tenant)
        OR (
          sa.include_descendants
          AND p_tenant IN (SELECT tenant_descendants(sa.provider_tenant_id))
        )
      )
      AND app_clearance_rank(p_classification) <= app_clearance_rank(sa.max_classification)
      AND (NOT ('NOFORN' = ANY (COALESCE(p_caveats, ARRAY[]::text[]))) OR sa.allow_noforn)
  ) INTO agreement_ok;
  RETURN COALESCE(agreement_ok, false);
END;
$fn$;

-- STUB: cross-tenant write via sharing is denied until a follow-on ADR enables it.
CREATE OR REPLACE FUNCTION app_can_write_fleet(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT app_action_permitted('fleet.write', p_tenant)
    AND p_tenant IN (SELECT app_hierarchy_tenant_ids())
$fn$;

CREATE OR REPLACE FUNCTION app_visible_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT app_hierarchy_tenant_ids()
  UNION
  SELECT sa.provider_tenant_id
  FROM sharing_agreements sa
  WHERE sa.status = 'active'
    AND sa.expires_at > now()
    AND sa.consumer_tenant_id IN (SELECT app_hierarchy_tenant_ids())
  UNION
  SELECT sa.consumer_tenant_id
  FROM sharing_agreements sa
  WHERE sa.status = 'active'
    AND sa.expires_at > now()
    AND sa.provider_tenant_id IN (SELECT app_hierarchy_tenant_ids())
$fn$;

CREATE OR REPLACE FUNCTION app_visible_user_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT app_user_id()
  WHERE app_user_id() IS NOT NULL
  UNION
  SELECT m.user_id
  FROM user_memberships m
  WHERE m.tenant_id IN (SELECT app_visible_tenant_ids())
$fn$;

CREATE OR REPLACE FUNCTION app_release_allowed(
  p_resource_tenant uuid,
  p_recipient uuid,
  p_category text,
  p_classification clearance_level,
  p_caveats text[],
  p_ntk text[]
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  r_clearance clearance_level;
  r_citizenship text;
  r_ntk text[];
  r_disabled timestamptz;
  sys_high clearance_level;
  same_org boolean;
  agreement_ok boolean;
BEGIN
  IF NOT app_can_read_marked(p_resource_tenant, p_category, p_classification, p_caveats, p_ntk) THEN
    RETURN false;
  END IF;
  SELECT clearance, citizenship, ntk_programs, disabled_at
    INTO r_clearance, r_citizenship, r_ntk, r_disabled
  FROM users WHERE id = p_recipient;
  IF NOT FOUND OR r_disabled IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT system_high INTO sys_high FROM system_policy WHERE id = 1;
  IF app_clearance_rank(p_classification) > app_clearance_rank(sys_high) THEN
    RETURN false;
  END IF;
  IF app_clearance_rank(r_clearance) < app_clearance_rank(p_classification) THEN
    RETURN false;
  END IF;
  IF NOT caveat_allows_citizenship(p_caveats, r_citizenship) THEN
    RETURN false;
  END IF;
  IF p_ntk IS NOT NULL AND cardinality(p_ntk) > 0 THEN
    IF r_ntk IS NULL OR NOT (p_ntk && r_ntk) THEN
      RETURN false;
    END IF;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM user_hierarchy_tenant_ids(p_recipient) AS h(id) WHERE h.id = p_resource_tenant
  ) INTO same_org;
  IF same_org THEN
    RETURN true;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM sharing_agreements sa
    WHERE sa.status = 'active'
      AND sa.expires_at > now()
      AND p_category = ANY (sa.categories)
      AND sa.consumer_tenant_id IN (SELECT user_hierarchy_tenant_ids(p_recipient))
      AND (
        (NOT sa.include_descendants AND sa.provider_tenant_id = p_resource_tenant)
        OR (
          sa.include_descendants
          AND p_resource_tenant IN (SELECT tenant_descendants(sa.provider_tenant_id))
        )
      )
      AND app_clearance_rank(p_classification) <= app_clearance_rank(sa.max_classification)
      AND (NOT ('NOFORN' = ANY (COALESCE(p_caveats, ARRAY[]::text[]))) OR sa.allow_noforn)
  ) INTO agreement_ok;
  RETURN COALESCE(agreement_ok, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION resolve_tenant_code(p_code text)
RETURNS TABLE(id uuid, name text, level org_level, branch_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF NOT app_action_permitted('sharing.create', NULL) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.level, t.branch_code
  FROM tenants t
  WHERE t.code = p_code;
END;
$fn$;

CREATE OR REPLACE FUNCTION sharing_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  sys_high clearance_level;
BEGIN
  SELECT system_high INTO sys_high FROM system_policy WHERE id = 1;
  IF app_clearance_rank(NEW.max_classification) > app_clearance_rank(sys_high) THEN
    RAISE EXCEPTION 'above_system_high';
  END IF;
  IF NEW.expires_at <= now() OR NEW.expires_at > now() + interval '365 days' THEN
    RAISE EXCEPTION 'sharing_term';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' AND current_user NOT IN ('a2e', 'postgres') THEN
      RAISE EXCEPTION 'sharing_must_start_as_draft';
    END IF;
    IF NEW.status = 'active' AND (NEW.approved_by IS NULL OR NEW.approved_by = NEW.requested_by) THEN
      RAISE EXCEPTION 'two_person_required';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.provider_tenant_id IS DISTINCT FROM NEW.provider_tenant_id
      OR OLD.consumer_tenant_id IS DISTINCT FROM NEW.consumer_tenant_id
      OR OLD.categories IS DISTINCT FROM NEW.categories
      OR OLD.access IS DISTINCT FROM NEW.access
      OR OLD.max_classification IS DISTINCT FROM NEW.max_classification
      OR OLD.allow_noforn IS DISTINCT FROM NEW.allow_noforn
      OR OLD.include_descendants IS DISTINCT FROM NEW.include_descendants
      OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
      OR OLD.purpose IS DISTINCT FROM NEW.purpose
      OR OLD.requested_by IS DISTINCT FROM NEW.requested_by
    THEN
      RAISE EXCEPTION 'sharing_terms_immutable';
    END IF;
    IF OLD.status = 'draft' AND NEW.status = 'active' THEN
      IF NEW.approved_by IS NULL OR NEW.approved_by = NEW.requested_by OR NEW.approved_at IS NULL THEN
        RAISE EXCEPTION 'two_person_required';
      END IF;
    ELSIF OLD.status = 'active' AND NEW.status = 'revoked' THEN
      NULL;
    ELSIF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'illegal_sharing_transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION append_audit(
  p_id uuid,
  p_occurred_at timestamptz,
  p_actor_id uuid,
  p_tenant_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid,
  p_decision text,
  p_reason_codes text[],
  p_classification clearance_level,
  p_caveats text[],
  p_ntk text[],
  p_canonical text,
  p_row_hash text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  prev text;
  expected text;
  new_seq bigint;
BEGIN
  IF p_actor_id IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'actor mismatch';
  END IF;
  IF p_decision NOT IN ('allow', 'deny') THEN
    RAISE EXCEPTION 'bad decision';
  END IF;
  SELECT last_hash INTO prev FROM audit_chain_head WHERE id = 1 FOR UPDATE;
  IF prev IS NULL THEN
    RAISE EXCEPTION 'audit chain missing';
  END IF;
  expected := encode(
    public.digest(decode(prev, 'hex') || convert_to(p_canonical, 'UTF8'), 'sha256'),
    'hex'
  );
  IF expected IS DISTINCT FROM p_row_hash THEN
    RAISE EXCEPTION 'audit_chain_conflict';
  END IF;
  INSERT INTO audit_events (
    id, occurred_at, actor_id, tenant_id, action, resource_type, resource_id,
    decision, reason_codes, classification, caveats, ntk_programs, canonical, prev_hash, row_hash
  ) VALUES (
    p_id, p_occurred_at, p_actor_id, p_tenant_id, p_action, p_resource_type, p_resource_id,
    p_decision, COALESCE(p_reason_codes, ARRAY[]::text[]), p_classification,
    COALESCE(p_caveats, ARRAY[]::text[]), COALESCE(p_ntk, ARRAY[]::text[]),
    p_canonical, prev, p_row_hash
  ) RETURNING seq INTO new_seq;
  UPDATE audit_chain_head SET last_hash = p_row_hash WHERE id = 1;
  RETURN new_seq;
END;
$fn$;

CREATE OR REPLACE FUNCTION append_system_audit(
  p_id uuid,
  p_occurred_at timestamptz,
  p_tenant_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid,
  p_decision text,
  p_reason_codes text[],
  p_canonical text,
  p_row_hash text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  prev text;
  expected text;
  new_seq bigint;
  system_id uuid := '00000000-0000-4000-8000-000000000001';
BEGIN
  IF p_action <> 'auth.login_failed' THEN
    RAISE EXCEPTION 'action not permitted for system audit';
  END IF;
  SELECT last_hash INTO prev FROM audit_chain_head WHERE id = 1 FOR UPDATE;
  expected := encode(
    public.digest(decode(prev, 'hex') || convert_to(p_canonical, 'UTF8'), 'sha256'),
    'hex'
  );
  IF expected IS DISTINCT FROM p_row_hash THEN
    RAISE EXCEPTION 'audit_chain_conflict';
  END IF;
  INSERT INTO audit_events (
    id, occurred_at, actor_id, tenant_id, action, resource_type, resource_id,
    decision, reason_codes, classification, caveats, ntk_programs, canonical, prev_hash, row_hash
  ) VALUES (
    p_id, p_occurred_at, system_id, p_tenant_id, p_action, p_resource_type, p_resource_id,
    p_decision, COALESCE(p_reason_codes, ARRAY[]::text[]), 'UNCLASSIFIED',
    ARRAY[]::text[], ARRAY[]::text[], p_canonical, prev, p_row_hash
  ) RETURNING seq INTO new_seq;
  UPDATE audit_chain_head SET last_hash = p_row_hash WHERE id = 1;
  RETURN new_seq;
END;
$fn$;

CREATE OR REPLACE FUNCTION append_custody(
  p_id uuid,
  p_platform_id uuid,
  p_event_type custody_event_type,
  p_from_user uuid,
  p_to_user uuid,
  p_location text,
  p_occurred_at timestamptz,
  p_canonical text,
  p_row_hash text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  prev text;
  expected text;
  new_seq bigint;
  p_tenant uuid;
  p_class clearance_level;
  p_caveats text[];
  p_ntk text[];
BEGIN
  IF app_user_id() IS NULL THEN
    RAISE EXCEPTION 'actor mismatch';
  END IF;
  IF NOT app_action_permitted('custody.append', NULL) THEN
    RAISE EXCEPTION 'role_denied';
  END IF;
  SELECT tenant_id, classification, caveats, ntk_programs
    INTO p_tenant, p_class, p_caveats, p_ntk
  FROM platforms WHERE id = p_platform_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform missing';
  END IF;
  IF NOT app_can_write_fleet(p_tenant) AND NOT (
    app_action_permitted('custody.append', p_tenant)
    AND p_tenant IN (SELECT app_hierarchy_tenant_ids())
  ) THEN
    RAISE EXCEPTION 'tenant_denied';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_platform_id::text, 0));
  SELECT last_hash INTO prev FROM custody_chain_head WHERE platform_id = p_platform_id FOR UPDATE;
  IF NOT FOUND THEN
    prev := repeat('0', 64);
    INSERT INTO custody_chain_head (platform_id, last_hash) VALUES (p_platform_id, prev);
  END IF;
  expected := encode(
    public.digest(decode(prev, 'hex') || convert_to(p_canonical, 'UTF8'), 'sha256'),
    'hex'
  );
  IF expected IS DISTINCT FROM p_row_hash THEN
    RAISE EXCEPTION 'audit_chain_conflict';
  END IF;
  INSERT INTO custody_events (
    id, platform_id, tenant_id, event_type, from_user_id, to_user_id, location,
    occurred_at, canonical, prev_hash, row_hash, classification, caveats, ntk_programs
  ) VALUES (
    p_id, p_platform_id, p_tenant, p_event_type, p_from_user, p_to_user, p_location,
    p_occurred_at, p_canonical, prev, p_row_hash, p_class, p_caveats, p_ntk
  ) RETURNING seq INTO new_seq;
  UPDATE custody_chain_head SET last_hash = p_row_hash WHERE platform_id = p_platform_id;
  RETURN new_seq;
END;
$fn$;

CREATE OR REPLACE FUNCTION approve_sharing(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  sa sharing_agreements%ROWTYPE;
BEGIN
  SELECT * INTO sa FROM sharing_agreements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF NOT app_action_permitted('sharing.approve', sa.provider_tenant_id) THEN
    RAISE EXCEPTION 'role_denied';
  END IF;
  IF sa.requested_by = app_user_id() THEN
    RAISE EXCEPTION 'two_person_required';
  END IF;
  IF sa.status <> 'draft' THEN
    RAISE EXCEPTION 'illegal_sharing_transition';
  END IF;
  UPDATE sharing_agreements
  SET status = 'active', approved_by = app_user_id(), approved_at = now()
  WHERE id = p_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION revoke_sharing(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  sa sharing_agreements%ROWTYPE;
BEGIN
  SELECT * INTO sa FROM sharing_agreements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF NOT app_action_permitted('sharing.approve', sa.provider_tenant_id) THEN
    RAISE EXCEPTION 'role_denied';
  END IF;
  IF sa.status <> 'active' THEN
    RAISE EXCEPTION 'illegal_sharing_transition';
  END IF;
  UPDATE sharing_agreements SET status = 'revoked' WHERE id = p_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION provision_user(
  p_username text,
  p_email text,
  p_display_name text,
  p_citizenship text,
  p_clearance clearance_level,
  p_ntk text[],
  p_keycloak_sub text,
  p_tenant uuid,
  p_role user_role
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  caller_clearance clearance_level;
  sys_high clearance_level;
  new_id uuid;
BEGIN
  IF NOT app_action_permitted('user.provision', p_tenant) THEN
    RAISE EXCEPTION 'role_denied';
  END IF;
  IF p_citizenship !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'citizenship_invalid';
  END IF;
  SELECT clearance INTO caller_clearance FROM users WHERE id = app_user_id();
  SELECT system_high INTO sys_high FROM system_policy WHERE id = 1;
  IF app_clearance_rank(p_clearance) > app_clearance_rank(sys_high)
     OR app_clearance_rank(p_clearance) > app_clearance_rank(caller_clearance) THEN
    RAISE EXCEPTION 'clearance_insufficient';
  END IF;
  INSERT INTO users (
    keycloak_sub, username, email, display_name, citizenship, clearance, ntk_programs,
    classification, caveats
  ) VALUES (
    p_keycloak_sub, p_username, p_email, p_display_name, p_citizenship, p_clearance,
    COALESCE(p_ntk, ARRAY[]::text[]), 'CUI', ARRAY[]::text[]
  ) RETURNING id INTO new_id;
  INSERT INTO user_memberships (user_id, tenant_id, role)
  VALUES (new_id, p_tenant, p_role);
  RETURN new_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION create_tenant(
  p_parent uuid,
  p_level org_level,
  p_name text,
  p_code text,
  p_branch_code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
DECLARE
  new_id uuid;
BEGIN
  IF NOT app_action_permitted('org.write', p_parent) THEN
    RAISE EXCEPTION 'role_denied';
  END IF;
  INSERT INTO tenants (parent_id, level, name, code, branch_code, classification, caveats)
  VALUES (p_parent, p_level, p_name, p_code, p_branch_code, 'CUI', ARRAY[]::text[])
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION user_for_login(p_username text)
RETURNS TABLE(id uuid, keycloak_sub text, disabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  SELECT u.id, u.keycloak_sub, u.disabled_at IS NOT NULL
  FROM users u
  WHERE u.username = p_username
$fn$;

CREATE OR REPLACE FUNCTION child_tenant_matches() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant FROM platforms WHERE id = NEW.platform_id;
  IF parent_tenant IS NULL OR parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'payload tenant mismatch';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER tenants_bi BEFORE INSERT OR UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION tenant_parent_guard();
CREATE TRIGGER tenants_mark BEFORE INSERT OR UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER users_mark BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER sharing_bi BEFORE INSERT OR UPDATE ON sharing_agreements
FOR EACH ROW EXECUTE FUNCTION sharing_guard();
CREATE TRIGGER sharing_mark BEFORE INSERT OR UPDATE ON sharing_agreements
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER platforms_mark BEFORE INSERT OR UPDATE ON platforms
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER platforms_touch BEFORE UPDATE ON platforms
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER platforms_tenant BEFORE UPDATE ON platforms
FOR EACH ROW EXECUTE FUNCTION reject_tenant_change();
CREATE TRIGGER payloads_mark BEFORE INSERT OR UPDATE ON payloads
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER payloads_parent BEFORE INSERT OR UPDATE ON payloads
FOR EACH ROW EXECUTE FUNCTION child_tenant_matches();
CREATE TRIGGER stations_mark BEFORE INSERT OR UPDATE ON ground_stations
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER loads_mark BEFORE INSERT OR UPDATE ON software_loads
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER loads_parent BEFORE INSERT OR UPDATE ON software_loads
FOR EACH ROW EXECUTE FUNCTION child_tenant_matches();
CREATE TRIGGER maint_mark BEFORE INSERT OR UPDATE ON maintenance_events
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER maint_parent BEFORE INSERT OR UPDATE ON maintenance_events
FOR EACH ROW EXECUTE FUNCTION child_tenant_matches();
CREATE TRIGGER custody_mark BEFORE INSERT OR UPDATE ON custody_events
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER custody_lock BEFORE UPDATE OR DELETE ON custody_events
FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_mark BEFORE INSERT OR UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();
CREATE TRIGGER audit_lock BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER exports_mark BEFORE INSERT OR UPDATE ON export_receipts
FOR EACH ROW EXECUTE FUNCTION set_portion_mark();

INSERT INTO system_policy (id, system_high, max_release) VALUES (1, 'CUI', 'CUI');
INSERT INTO audit_chain_head (id, last_hash) VALUES (1, repeat('0', 64));

INSERT INTO users (
  id, keycloak_sub, username, email, display_name, citizenship, clearance,
  ntk_programs, classification, caveats, disabled_at
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'system',
  'system',
  'system@a2e.invalid',
  'System',
  'USA',
  'CUI',
  '{}',
  'CUI',
  '{}',
  now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE user_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE sharing_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharing_agreements FORCE ROW LEVEL SECURITY;
ALTER TABLE platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE platforms FORCE ROW LEVEL SECURITY;
ALTER TABLE payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE payloads FORCE ROW LEVEL SECURITY;
ALTER TABLE ground_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ground_stations FORCE ROW LEVEL SECURITY;
ALTER TABLE software_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE software_loads FORCE ROW LEVEL SECURITY;
ALTER TABLE maintenance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_events FORCE ROW LEVEL SECURITY;
ALTER TABLE custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_events FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE export_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_select ON tenants FOR SELECT
USING (id IN (SELECT app_visible_tenant_ids()));

CREATE POLICY users_select ON users FOR SELECT
USING (
  id = app_user_id()
  OR (
    id IN (SELECT app_visible_user_ids())
    AND marking_visible(classification, caveats, '{}')
  )
);

CREATE POLICY memberships_select ON user_memberships FOR SELECT
USING (user_id IN (SELECT app_visible_user_ids()));

CREATE POLICY sharing_select ON sharing_agreements FOR SELECT
USING (
  marking_visible(classification, caveats, ntk_programs)
  AND (
    (
      provider_tenant_id IN (SELECT app_hierarchy_tenant_ids())
      AND app_action_permitted('sharing.read', provider_tenant_id)
    )
    OR (
      status = 'active'
      AND consumer_tenant_id IN (SELECT app_hierarchy_tenant_ids())
      AND app_action_permitted('sharing.read', consumer_tenant_id)
    )
  )
);

CREATE POLICY sharing_insert ON sharing_agreements FOR INSERT
WITH CHECK (
  status = 'draft'
  AND approved_by IS NULL
  AND requested_by = app_user_id()
  AND app_action_permitted('sharing.create', provider_tenant_id)
  AND provider_tenant_id IN (SELECT app_hierarchy_tenant_ids())
  AND marking_visible(classification, caveats, ntk_programs)
);

CREATE POLICY platforms_select ON platforms FOR SELECT
USING (app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs));
CREATE POLICY platforms_insert ON platforms FOR INSERT
WITH CHECK (
  app_can_write_fleet(tenant_id)
  AND app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs)
);
CREATE POLICY platforms_update ON platforms FOR UPDATE
USING (app_can_write_fleet(tenant_id))
WITH CHECK (
  app_can_write_fleet(tenant_id)
  AND app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs)
);

CREATE POLICY payloads_select ON payloads FOR SELECT
USING (app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs));
CREATE POLICY payloads_insert ON payloads FOR INSERT
WITH CHECK (
  app_can_write_fleet(tenant_id)
  AND app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs)
);

CREATE POLICY stations_select ON ground_stations FOR SELECT
USING (app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs));
CREATE POLICY stations_insert ON ground_stations FOR INSERT
WITH CHECK (
  app_can_write_fleet(tenant_id)
  AND app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs)
);

CREATE POLICY loads_select ON software_loads FOR SELECT
USING (app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs));
CREATE POLICY loads_insert ON software_loads FOR INSERT
WITH CHECK (
  app_can_write_fleet(tenant_id)
  AND app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs)
);

CREATE POLICY maint_select ON maintenance_events FOR SELECT
USING (app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs));
CREATE POLICY maint_insert ON maintenance_events FOR INSERT
WITH CHECK (
  app_can_write_fleet(tenant_id)
  AND app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs)
);
CREATE POLICY maint_update ON maintenance_events FOR UPDATE
USING (app_can_write_fleet(tenant_id))
WITH CHECK (
  app_can_write_fleet(tenant_id)
  AND app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs)
);

CREATE POLICY custody_select ON custody_events FOR SELECT
USING (app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs));

CREATE POLICY audit_select ON audit_events FOR SELECT
USING (
  marking_visible(classification, caveats, ntk_programs)
  AND app_action_permitted('audit.read', NULL)
  AND (
    tenant_id IS NULL
    OR tenant_id IN (SELECT app_hierarchy_tenant_ids())
  )
);

CREATE POLICY export_select ON export_receipts FOR SELECT
USING (app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs));
CREATE POLICY export_insert ON export_receipts FOR INSERT
WITH CHECK (app_can_read_marked(tenant_id, 'fleet', classification, caveats, ntk_programs));

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO a2e_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT SELECT ON system_policy, role_permissions, audit_chain_head, custody_chain_head TO a2e_app;
GRANT SELECT ON tenants, users, user_memberships, sharing_agreements TO a2e_app;
GRANT SELECT, INSERT, UPDATE ON platforms, maintenance_events TO a2e_app;
GRANT SELECT, INSERT ON payloads, ground_stations, software_loads, sharing_agreements, export_receipts TO a2e_app;
GRANT SELECT ON custody_events, audit_events TO a2e_app;

REVOKE ALL ON FUNCTION tenant_descendants(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION user_hierarchy_tenant_ids(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app_subject(),
  app_user_id(),
  app_hierarchy_tenant_ids(),
  app_roles_for(uuid),
  app_action_permitted(text, uuid),
  app_readable_tenant_ids(text),
  app_can_read_marked(uuid, text, clearance_level, text[], text[]),
  app_can_write_fleet(uuid),
  app_visible_tenant_ids(),
  app_visible_user_ids(),
  app_release_allowed(uuid, uuid, text, clearance_level, text[], text[]),
  resolve_tenant_code(text),
  user_for_login(text),
  append_audit(uuid, timestamptz, uuid, uuid, text, text, uuid, text, text[], clearance_level, text[], text[], text, text),
  append_system_audit(uuid, timestamptz, uuid, text, text, uuid, text, text[], text, text),
  append_custody(uuid, uuid, custody_event_type, uuid, uuid, text, timestamptz, text, text),
  approve_sharing(uuid),
  revoke_sharing(uuid),
  provision_user(text, text, text, text, clearance_level, text[], text, uuid, user_role),
  create_tenant(uuid, org_level, text, text, text)
TO a2e_app;
