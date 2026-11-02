-- Names of ancestor tenants are visible so the org chart can show branch, command, and unit.
-- This does not add those tenants to fleet, mission, or telemetry reads.

CREATE OR REPLACE FUNCTION app_org_chart_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $fn$
  WITH RECURSIVE up AS (
    SELECT t.id, t.parent_id
    FROM tenants t
    WHERE t.id IN (SELECT app_visible_tenant_ids())
    UNION ALL
    SELECT parent.id, parent.parent_id
    FROM tenants parent
    JOIN up ON parent.id = up.parent_id
  )
  SELECT DISTINCT id FROM up
$fn$;

DROP POLICY tenants_select ON tenants;
CREATE POLICY tenants_select ON tenants FOR SELECT
USING (id IN (SELECT app_org_chart_ids()));

REVOKE ALL ON FUNCTION app_org_chart_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_org_chart_ids() TO a2e_app;
