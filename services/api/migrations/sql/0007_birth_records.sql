-- One row per serial as it leaves the factory: parts lots, calibration results,
-- firmware hash, and the end-of-line test. Written once; a re-test adds a new row.
CREATE TABLE IF NOT EXISTS birth_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  serial_number text NOT NULL,
  firmware_sha256 text NOT NULL CHECK (firmware_sha256 ~ '^[0-9a-f]{64}$'),
  parts jsonb NOT NULL DEFAULT '[]',
  calibrations jsonb NOT NULL DEFAULT '[]',
  eol_kind text NOT NULL CHECK (eol_kind IN ('bench', 'hover')),
  eol_passed boolean NOT NULL,
  eol_note text NOT NULL DEFAULT '',
  verdict airworthiness_status NOT NULL,
  verdict_reason text NOT NULL,
  recorded_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS birth_records_serial_time
  ON birth_records (tenant_id, serial_number, recorded_at DESC);

ALTER TABLE birth_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE birth_records FORCE ROW LEVEL SECURITY;
CREATE POLICY birth_records_select ON birth_records FOR SELECT
USING (tenant_id IN (SELECT app_readable_tenant_ids('fleet')));
CREATE POLICY birth_records_insert ON birth_records FOR INSERT
WITH CHECK (app_can_write_fleet(tenant_id));

GRANT SELECT, INSERT ON birth_records TO a2e_app;
