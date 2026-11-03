-- One row per metric from a make eval run.
CREATE TABLE IF NOT EXISTS eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  git_sha text NOT NULL,
  metric text NOT NULL,
  value double precision NOT NULL,
  unit text NOT NULL,
  phase text NOT NULL
);

CREATE INDEX IF NOT EXISTS eval_runs_metric_time ON eval_runs (metric, recorded_at DESC);

GRANT SELECT, INSERT ON eval_runs TO a2e_app;
