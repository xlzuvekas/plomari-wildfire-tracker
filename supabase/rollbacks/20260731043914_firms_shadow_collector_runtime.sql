-- Safe rollback for 20260731043914_firms_shadow_collector_runtime.sql.
-- Refuse once the inert catalog has been activated or any durable execution
-- state exists. Immutable evidence is never deleted.

do $$
declare
  firms_source_id bigint;
  runtime_revision_id bigint;
  runtime_adapter_id bigint;
begin
  select id into firms_source_id from core.sources where slug = 'nasa-firms';
  if firms_source_id is null then return; end if;

  select id into runtime_revision_id
  from core.collection_target_revisions
  where public_id = '018f0000-0000-7000-8000-000000000702';
  select id into runtime_adapter_id
  from core.adapter_releases
  where public_id = '018f0000-0000-7000-8000-000000000701';

  if exists (select 1 from ingest.jobs where source_id = firms_source_id)
    or exists (select 1 from ingest.runs where source_id = firms_source_id)
    or exists (
      select 1 from ingest.http_exchanges as exchange
      join ingest.runs as run on run.id = exchange.run_id
      where run.source_id = firms_source_id
    )
    or exists (select 1 from ingest.source_revisions where source_id = firms_source_id)
    or exists (select 1 from ingest.global_observations where source_id = firms_source_id)
    or exists (select 1 from ingest.firms_response_rows)
    or exists (select 1 from ingest.firms_query_product_results)
    or exists (select 1 from ingest.firms_query_completions)
  then
    raise exception 'refusing FIRMS runtime rollback: durable execution or evidence rows exist'
      using errcode = '55000';
  end if;

  if exists (
      select 1
      from core.sources as source
      join core.endpoints as endpoint on endpoint.source_id = source.id
      join ingest.endpoint_state as endpoint_state
        on endpoint_state.endpoint_id = endpoint.id
      join core.collection_targets as target
        on target.source_id = source.id and target.endpoint_id = endpoint.id
      where source.id = firms_source_id
        and (source.enabled or endpoint_state.enabled or target.enabled)
    )
    or exists (
      select 1 from core.firms_products
      where source_id = firms_source_id
        and (enabled or assessment_enabled or license_status <> 'unreviewed')
    )
    or exists (
      select 1 from core.collection_target_revisions
      where id = runtime_revision_id and enabled
    )
    or exists (
      select 1 from ingest.adapter_release_state
      where adapter_release_id = runtime_adapter_id
        and (enabled or retired_at is not null)
    )
  then
    raise exception 'refusing FIRMS runtime rollback: runtime activation state changed'
      using errcode = '55000';
  end if;

  if exists (
      select 1 from core.collection_target_revisions
      where previous_revision_id = runtime_revision_id
    )
    or exists (
      select 1 from core.adapter_releases
      where previous_release_id = runtime_adapter_id
    )
  then
    raise exception 'refusing FIRMS runtime rollback: successor catalog identity exists'
      using errcode = '55000';
  end if;
end;
$$;

drop function if exists ingest.reap_expired_firms_collection_job(core.uuid_v7);
drop function if exists ingest.abandon_pending_firms_http_exchanges(
  bigint, uuid, text, text
);
drop function if exists ingest.claim_firms_collection_job_exact(
  bigint, text, interval
);
drop function if exists ingest.firms_shadow_job_input_is_valid_v1(jsonb);

delete from ingest.collection_target_state
where collection_target_revision_id = (
  select id from core.collection_target_revisions
  where public_id = '018f0000-0000-7000-8000-000000000702'
);

drop trigger if exists collection_target_revisions_reject_mutation
  on core.collection_target_revisions;
delete from core.collection_target_revisions
where public_id = '018f0000-0000-7000-8000-000000000702';
create trigger collection_target_revisions_reject_mutation
before update or delete on core.collection_target_revisions
for each row execute function core.reject_mutation();

delete from ingest.adapter_release_state
where adapter_release_id = (
  select id from core.adapter_releases
  where public_id = '018f0000-0000-7000-8000-000000000701'
);

drop trigger if exists adapter_releases_reject_mutation
  on core.adapter_releases;
delete from core.adapter_releases
where public_id = '018f0000-0000-7000-8000-000000000701';
create trigger adapter_releases_reject_mutation
before update or delete on core.adapter_releases
for each row execute function core.reject_mutation();

alter table ingest.firms_query_product_results
  drop constraint if exists firms_query_product_results_failure_code_check,
  drop column if exists failure_code;

alter table ingest.firms_response_rows
  drop constraint if exists firms_response_rows_rejection_reasons_check,
  drop constraint if exists firms_response_rows_source_row_number_check,
  drop column if exists rejection_reasons,
  drop column if exists source_row_number;
