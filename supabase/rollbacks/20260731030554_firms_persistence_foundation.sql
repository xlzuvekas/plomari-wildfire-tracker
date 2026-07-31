-- Safe rollback for 20260731030554_firms_persistence_foundation.sql.
--
-- This rollback never deletes immutable evidence and never reclassifies the
-- path-segment FIRMS key as a query secret. It refuses to proceed once FIRMS
-- runtime/evidence state exists. Disabled catalog identities are retained so a
-- rollback cannot silently reuse their public IDs for different semantics.

do $$
declare
  firms_source_id bigint;
begin
  select id into firms_source_id
  from core.sources
  where slug = 'nasa-firms';

  if firms_source_id is null then
    return;
  end if;

  if exists (
      select 1 from ingest.runs where source_id = firms_source_id
    )
    or exists (
      select 1 from ingest.source_revisions where source_id = firms_source_id
    )
    or exists (
      select 1 from ingest.global_observations where source_id = firms_source_id
    )
    or exists (select 1 from ingest.firms_response_rows)
    or exists (select 1 from ingest.firms_query_product_results)
    or exists (select 1 from ingest.firms_query_completions)
    or exists (select 1 from truth.thermal_anomaly_assessments)
  then
    raise exception 'refusing FIRMS rollback: immutable runtime or evidence rows exist'
      using errcode = '55000';
  end if;

  if exists (
      select 1
      from core.adapter_releases
      where source_id = firms_source_id
    )
    or exists (
      select 1
      from core.collection_target_revisions as revision
      join core.collection_targets as target
        on target.id = revision.collection_target_id
      where target.source_id = firms_source_id
        and (revision.version_no > 1 or revision.enabled)
    )
  then
    raise exception 'refusing FIRMS rollback: deployed adapter or successor target revision exists'
      using errcode = '55000';
  end if;

  update core.sources
  set enabled = false,
      license_status = 'unreviewed',
      sensitivity = 'restricted',
      is_public = false
  where id = firms_source_id;

  update ingest.endpoint_state
  set enabled = false,
      paused_reason = 'migration_rolled_back'
  where endpoint_id in (
    select id from core.endpoints where source_id = firms_source_id
  );

  update core.collection_targets
  set enabled = false,
      visibility = 'restricted'
  where source_id = firms_source_id;
end;
$$;

drop trigger if exists global_observations_require_firms_detection_detail
  on ingest.global_observations;

drop table if exists truth.thermal_anomaly_assessments;
drop table if exists ingest.firms_query_completions;
drop table if exists ingest.firms_query_product_results;
drop table if exists ingest.firms_response_rows;
drop table if exists ingest.firms_detection_details;
drop table if exists core.firms_products;

drop function if exists truth.validate_thermal_anomaly_assessment();
drop function if exists ingest.require_complete_firms_product_set();
drop function if exists ingest.validate_firms_query_completion();
drop function if exists ingest.validate_firms_query_product_result();
drop function if exists ingest.firms_area_logical_request_sha256_v1(
  text, text, numeric, numeric, numeric, numeric, date, integer
);
drop function if exists ingest.firms_area_token_matches_v1(
  text, numeric, numeric, numeric, numeric
);
drop function if exists ingest.firms_area_token_is_valid_v1(text);
drop function if exists ingest.validate_firms_response_row();
drop function if exists ingest.firms_detection_is_within_request_v1(
  text, text, numeric, numeric, date
);
drop function if exists ingest.firms_issued_at_token_is_valid_v1(text);
drop function if exists ingest.require_firms_detection_detail();
drop function if exists ingest.validate_firms_detection_detail();
drop function if exists ingest.firms_source_satellite_code_v1(text, text);
drop function if exists ingest.firms_detection_identity_v1(
  text, text, timestamptz, numeric, numeric
);
drop function if exists core.validate_firms_product_update();
drop function if exists core.assign_firms_product_insert_clock();

-- Keep path_secret in the endpoint auth allowlist. Reverting it would either
-- invalidate the retained endpoint identity or falsely describe key handling.
-- Keep issued_at in the generic request_metadata safe-map allowlist as well:
-- it is part of the cross-source HTTP evidence contract introduced by PR #47,
-- not a FIRMS credential or runtime state.
