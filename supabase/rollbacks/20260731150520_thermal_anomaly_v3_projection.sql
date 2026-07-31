drop function if exists api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer
);

drop index if exists truth.thermal_anomaly_assessments_projection_cutoff_idx;

notify pgrst, 'reload schema';
