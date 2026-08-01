-- Guarded rollback for the private VIIRS FireMask assessability foundation.
-- Immutable evidence is never erased by rollback.
begin;

set local lock_timeout = '5s';
-- With forced RLS, a non-BYPASSRLS migration role must error rather than see
-- an empty result and erase evidence it cannot inspect.
set local row_security = off;

do $$
declare
  has_evidence boolean;
begin
  if to_regclass('truth.viirs_firemask_support_assessments') is not null then
    execute 'lock table truth.viirs_firemask_support_assessments in access exclusive mode';
  end if;
  if to_regclass('ingest.viirs_firemask_asset_pairs') is not null then
    execute 'lock table ingest.viirs_firemask_asset_pairs in access exclusive mode';
  end if;
  if to_regclass('ingest.cmr_granule_details') is not null then
    execute 'lock table ingest.cmr_granule_details in access exclusive mode';
  end if;
  if to_regclass('core.viirs_firemask_product_profiles') is not null then
    execute 'lock table core.viirs_firemask_product_profiles in access exclusive mode';
  end if;

  if to_regclass('truth.viirs_firemask_support_assessments') is not null then
    execute 'select exists (select 1 from truth.viirs_firemask_support_assessments)'
      into has_evidence;
    if has_evidence then
      raise exception 'refusing VIIRS FireMask rollback: immutable support-assessment evidence exists'
        using errcode = '55000';
    end if;
  end if;

  if to_regclass('ingest.viirs_firemask_asset_pairs') is not null then
    execute 'select exists (select 1 from ingest.viirs_firemask_asset_pairs)'
      into has_evidence;
    if has_evidence then
      raise exception 'refusing VIIRS FireMask rollback: immutable asset-pair evidence exists'
        using errcode = '55000';
    end if;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'ingest.cmr_granule_details'::regclass
      and attribute.attname = 'footprint_source'
      and not attribute.attisdropped
  ) then
    execute 'select exists (
      select 1 from ingest.cmr_granule_details
      where footprint_source is not null
    )' into has_evidence;
    if has_evidence then
      raise exception 'refusing VIIRS FireMask rollback: immutable CMR footprint-source evidence exists'
        using errcode = '55000';
    end if;
  end if;
end;
$$;

drop table if exists truth.viirs_firemask_support_assessments;
drop function if exists truth.validate_viirs_firemask_support_assessment();
drop function if exists truth.viirs_firemask_geography_is_locally_valid_v1(
  extensions.geography, extensions.geography
);
drop function if exists truth.viirs_firemask_geography_covers_locally_v1(
  extensions.geography, extensions.geography, extensions.geography
);
drop function if exists truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(
  bigint, bigint, bigint, bigint, bigint, boolean
);
drop table if exists ingest.viirs_firemask_asset_pairs;
drop function if exists ingest.validate_viirs_firemask_asset_pair();
drop table if exists core.viirs_firemask_product_profiles;
alter table ingest.cmr_granule_details
  drop column if exists footprint_source;

commit;
