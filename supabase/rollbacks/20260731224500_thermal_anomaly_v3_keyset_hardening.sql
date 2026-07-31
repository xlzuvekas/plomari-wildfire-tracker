drop function if exists api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer,
  timestamptz, uuid, text
);

drop index if exists truth.thermal_anomaly_assessments_projection_chain_idx;
drop index if exists ingest.firms_detection_details_projection_original_idx;
drop function if exists truth.ceil_millisecond_utc(timestamptz);

alter function truth.thermal_anomalies_v3_legacy(
  integer, integer, integer, timestamptz, timestamptz, integer
) set schema api;

alter function api.thermal_anomalies_v3_legacy(
  integer, integer, integer, timestamptz, timestamptz, integer
) rename to thermal_anomalies_v3;

revoke execute on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher,
  anon, authenticated, service_role, firewatch_discovery_reader;

grant execute on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer
) to firewatch_discovery_reader;

comment on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer
) is
  'Returns bounded assessed FIRMS thermal-pixel observations for one canonical coarse cell and two independent temporal cutoffs. Absence is indeterminate and never an all-clear.';

notify pgrst, 'reload schema';
