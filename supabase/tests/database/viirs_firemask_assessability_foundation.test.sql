begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(50);

select has_table('core', 'viirs_firemask_product_profiles',
  'immutable reviewed product profiles exist');
select has_table('ingest', 'viirs_firemask_asset_pairs',
  'immutable exact raw-asset pairs exist');
select has_table('truth', 'viirs_firemask_support_assessments',
  'immutable private support assessments exist');

select ok(
  (select column_row.is_nullable = 'YES'
   from information_schema.columns as column_row
   where column_row.table_schema = 'ingest'
     and column_row.table_name = 'cmr_granule_details'
     and column_row.column_name = 'footprint_source')
  and (select pg_get_constraintdef(constraint_row.oid) like
      '%footprint_source%umm-g-gpolygon%umm-g-bounding-rectangle%'
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'ingest.cmr_granule_details'::regclass
      and constraint_row.conname =
        'cmr_granule_details_footprint_source_check')
  and pg_get_functiondef(
    'ingest.validate_viirs_firemask_asset_pair()'::regprocedure
  ) ilike '%detail.footprint_source as cmr_footprint_source%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) ilike '%cmr_detail.footprint_source as cmr_footprint_source%',
  'legacy CMR footprint encoding is nullable but both future evidence validators require typed provenance'
);

select is(
  (
    select jsonb_agg(jsonb_build_array(
      profile.firms_product,
      profile.firemask_product,
      profile.firemask_collection_file_version,
      profile.geolocation_product,
      profile.geolocation_collection_file_version,
      profile.firemask_geolocation_attribute_name,
      profile.platform,
      profile.assessment_enabled
    ) order by profile.firms_product)
    from core.viirs_firemask_product_profiles as profile
  ),
  '[
    ["VIIRS_NOAA20_NRT","VJ114IMG","002","VJ103IMG","021","VJ103IMG","NOAA-20",false],
    ["VIIRS_NOAA21_NRT","VJ214IMG","002","VJ203IMG","021","VJ203IMG","NOAA-21",false],
    ["VIIRS_SNPP_NRT","VNP14IMG","002","VNP03IMG","002","VNP03IMG","Suomi-NPP",false]
  ]'::jsonb,
  'exact reviewed products, collection-file versions, geolocation attributes, and platforms are pinned disabled'
);

select ok(
  (select count(*) = 3
   from core.viirs_firemask_product_profiles
   where public_id is not null
     and contract_version = '0.1.0-internal'
     and cmr_catalog_product = firemask_product || '_NRT'
     and firms_product_key = firms_product
     and satellite = platform
     and firemask_collection_file_version = '002'
     and geolocation_collection_file_version = case firms_product
       when 'VIIRS_SNPP_NRT' then '002'
       else '021'
     end
     and firemask_geolocation_attribute_name = geolocation_product
     and limitations @> array[
       'internal_evidence_only',
       'cmr_catalog_metadata_not_pixel_assessment',
       'product_profile_not_activation',
       'not_negative_assessment',
       'not_incident_resolution',
       'not_all_clear'
     ]::text[]),
  'profiles retain public contract identity, explicit CMR mapping, and limitations'
);

select ok(
  not exists (
    select 1 from core.sources
    where slug = 'nasa-earthdata-viirs-firemask-assets'
  ),
  'foundation adds no Earthdata asset source or activation path'
);

select ok(
  (select pg_get_constraintdef(constraint_row.oid) ilike
      '%FOREIGN KEY (firms_product_id, firms_source_id, firms_product)%REFERENCES core.firms_products(id, source_id, product_key)%'
   from pg_constraint as constraint_row
   where constraint_row.conrelid =
       'core.viirs_firemask_product_profiles'::regclass
     and constraint_row.conname =
       'viirs_firemask_product_profiles_firms_registry_fkey')
  and (select pg_get_constraintdef(constraint_row.oid) ilike
      '%cmr_observation_cursor, firms_product, firemask_local_granule_id, geolocation_local_granule_id, firemask_content_sha256, geolocation_content_sha256%'
   from pg_constraint as constraint_row
   where constraint_row.conrelid =
       'ingest.viirs_firemask_asset_pairs'::regclass
     and constraint_row.conname =
       'viirs_firemask_asset_pairs_exact_identity_key'),
  'profiles bind the exact FIRMS registry and pair identity permits immutable reprocessing'
);

select ok(
  (select bool_and(class.relrowsecurity and class.relforcerowsecurity)
   from pg_class as class
   where class.oid in (
     'core.viirs_firemask_product_profiles'::regclass,
     'ingest.viirs_firemask_asset_pairs'::regclass,
     'truth.viirs_firemask_support_assessments'::regclass
   )),
  'all three private tables enable and force RLS'
);

select ok(
  has_table_privilege('firewatch_collector',
    'ingest.viirs_firemask_asset_pairs', 'SELECT')
  and has_table_privilege('firewatch_collector',
    'ingest.viirs_firemask_asset_pairs', 'INSERT')
  and not has_table_privilege('firewatch_collector',
    'ingest.viirs_firemask_asset_pairs', 'UPDATE')
  and has_table_privilege('firewatch_reconciler',
    'ingest.viirs_firemask_asset_pairs', 'SELECT')
  and not has_table_privilege('firewatch_reconciler',
    'ingest.viirs_firemask_asset_pairs', 'INSERT')
  and has_table_privilege('firewatch_reconciler',
    'truth.viirs_firemask_support_assessments', 'SELECT')
  and has_table_privilege('firewatch_reconciler',
    'truth.viirs_firemask_support_assessments', 'INSERT')
  and not has_table_privilege('firewatch_reconciler',
    'truth.viirs_firemask_support_assessments', 'UPDATE'),
  'collector and reconciler receive only their append/read capabilities'
);

select ok(
  not has_table_privilege('anon',
    'ingest.viirs_firemask_asset_pairs', 'SELECT')
  and not has_table_privilege('authenticated',
    'truth.viirs_firemask_support_assessments', 'SELECT')
  and not has_table_privilege('service_role',
    'core.viirs_firemask_product_profiles', 'SELECT')
  and not has_table_privilege('service_role',
    'ingest.viirs_firemask_asset_pairs', 'SELECT')
  and not has_table_privilege('service_role',
    'truth.viirs_firemask_support_assessments', 'SELECT'),
  'anon, authenticated, and service_role have no access'
);

select ok(
  (
    select count(*) = 5
    from pg_trigger as trigger_row
    where not trigger_row.tgisinternal
      and (
        (trigger_row.tgrelid = 'core.viirs_firemask_product_profiles'::regclass
          and trigger_row.tgname = 'viirs_firemask_product_profiles_reject_mutation'
          and trigger_row.tgfoid = 'core.reject_mutation()'::regprocedure
          and trigger_row.tgenabled = 'O'
          and trigger_row.tgtype = 27)
        or (trigger_row.tgrelid = 'ingest.viirs_firemask_asset_pairs'::regclass
          and trigger_row.tgname = 'viirs_firemask_asset_pairs_validate'
          and trigger_row.tgfoid = 'ingest.validate_viirs_firemask_asset_pair()'::regprocedure
          and trigger_row.tgenabled = 'O'
          and trigger_row.tgtype = 7)
        or (trigger_row.tgrelid = 'ingest.viirs_firemask_asset_pairs'::regclass
          and trigger_row.tgname = 'viirs_firemask_asset_pairs_reject_mutation'
          and trigger_row.tgfoid = 'core.reject_mutation()'::regprocedure
          and trigger_row.tgenabled = 'O'
          and trigger_row.tgtype = 27)
        or (trigger_row.tgrelid = 'truth.viirs_firemask_support_assessments'::regclass
          and trigger_row.tgname = 'viirs_firemask_support_assessments_validate'
          and trigger_row.tgfoid = 'truth.validate_viirs_firemask_support_assessment()'::regprocedure
          and trigger_row.tgenabled = 'O'
          and trigger_row.tgtype = 7)
        or (trigger_row.tgrelid = 'truth.viirs_firemask_support_assessments'::regclass
          and trigger_row.tgname = 'viirs_firemask_support_assessments_reject_mutation'
          and trigger_row.tgfoid = 'core.reject_mutation()'::regprocedure
          and trigger_row.tgenabled = 'O'
          and trigger_row.tgtype = 27)
      )
  ),
  'all validation and immutability triggers are enabled with exact BEFORE row events and functions'
);

select ok(
  pg_get_functiondef(
    'ingest.validate_viirs_firemask_asset_pair()'::regprocedure
  ) like '%new.recorded_at := clock_timestamp()%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%new.recorded_at := clock_timestamp()%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%context_record.pair_recorded_at > new.known_at%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%context_record.detection_recorded_at > new.known_at%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%context_record.acquired_at + interval ''1 minute''%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%new.complete_modeled_support_coverage := coalesce(%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%context_record.cmr_coverage_geom::extensions.geography%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%new.canonical_modeled_support_geog := canonical_support%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%new.assessed_pixel_coverage_geog,%canonical_support%'
  and pg_catalog.regexp_count(
    pg_get_functiondef(
      'truth.validate_viirs_firemask_support_assessment()'::regprocedure
    ),
    'truth\.viirs_firemask_geography_covers_locally_v1\('
  ) = 2
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) like '%truth.viirs_firemask_geography_is_locally_valid_v1(%'
  and pg_get_functiondef(
    'truth.validate_viirs_firemask_support_assessment()'::regprocedure
  ) not like '%extensions.st_equals(%',
  'validators own clocks and bind detection/pair knowledge, later pass, local-projection coverage, and server-owned canonical support'
);

select ok(
  pg_get_functiondef(
    'ingest.validate_viirs_firemask_asset_pair()'::regprocedure
  ) like '%VIIRS asset collection is disabled in contract 0.1.0-internal%'
  and (select pg_get_constraintdef(constraint_row.oid) like
      '%firemask_content_sha256 <> geolocation_content_sha256%'
    from pg_constraint as constraint_row
    where constraint_row.conrelid =
      'ingest.viirs_firemask_asset_pairs'::regclass
      and constraint_row.conname =
        'viirs_firemask_asset_pairs_distinct_raw_check')
  and (select pg_get_constraintdef(constraint_row.oid) like
      '%firemask_observed_to <= known_at%geolocation_observed_to <= known_at%'
    from pg_constraint as constraint_row
    where constraint_row.conrelid =
      'ingest.viirs_firemask_asset_pairs'::regclass
      and constraint_row.conname =
        'viirs_firemask_asset_pairs_intervals_check')
  and (select pg_get_constraintdef(constraint_row.oid) like
      '%cmr_catalog_metadata_not_pixel_assessment%pair_is_not_negative_assessment%'
    from pg_constraint as constraint_row
    where constraint_row.conrelid =
      'ingest.viirs_firemask_asset_pairs'::regclass
      and constraint_row.conname =
        'viirs_firemask_asset_pairs_limitations_check'),
  'contract 0.1 pins the hard gate, distinct bytes, completed passes, and pair limitations'
);

select ok(
  to_regprocedure(
    'truth.viirs_firemask_geography_covers_locally_v1(extensions.geography,extensions.geography,extensions.geography)'
  ) is not null
  and to_regprocedure(
    'truth.viirs_firemask_geography_is_locally_valid_v1(extensions.geography,extensions.geography)'
  ) is not null
  and not exists (
    select 1
    from pg_proc as function_row
    cross join lateral aclexplode(coalesce(
      function_row.proacl,
      acldefault('f', function_row.proowner)
    )) as privilege_row
    where function_row.oid in (
      'truth.viirs_firemask_geography_covers_locally_v1(extensions.geography,extensions.geography,extensions.geography)'::regprocedure,
      'truth.viirs_firemask_geography_is_locally_valid_v1(extensions.geography,extensions.geography)'::regprocedure
    )
      and privilege_row.privilege_type = 'EXECUTE'
      and (
        privilege_row.grantee = 0
        or privilege_row.grantee in (
          select role_row.oid
          from pg_roles as role_row
          where role_row.rolname in (
            'anon', 'authenticated', 'service_role',
            'firewatch_catalog_admin', 'firewatch_collector',
            'firewatch_reconciler', 'firewatch_publisher',
            'firewatch_dispatcher'
          )
        )
      )
  ),
  'local geography validity and coverage helpers exist without caller execute access'
);

select ok(
  (
    with coverage_cases(name, anchor, inner_coverage, outer_coverage) as (
      select
        point_case.name,
        point_case.anchor,
        extensions.st_buffer(point_case.anchor, 1000),
        extensions.st_buffer(point_case.anchor, 2000)
      from (values
        ('ordinary', extensions.st_setsrid(
          extensions.st_makepoint(26, 39), 4326
        )::extensions.geography),
        ('antimeridian', extensions.st_setsrid(
          extensions.st_makepoint(179.999, 39), 4326
        )::extensions.geography),
        ('north_pole', extensions.st_setsrid(
          extensions.st_makepoint(45, 89.999), 4326
        )::extensions.geography),
        ('south_pole', extensions.st_setsrid(
          extensions.st_makepoint(-120, -89.999), 4326
        )::extensions.geography)
      ) as point_case(name, anchor)
    )
    select count(*) = 4 and bool_and(
      truth.viirs_firemask_geography_is_locally_valid_v1(
        inner_coverage,
        anchor
      )
      and truth.viirs_firemask_geography_covers_locally_v1(
        outer_coverage,
        inner_coverage,
        anchor
      )
    )
    from coverage_cases
  ),
  'local projection validates and covers ordinary, antimeridian, and polar buffers including the south-pole regression coordinates'
);

select ok(
  (
    with split_dateline_case as (
      select
        'SRID=4326;MULTIPOLYGON(((170 -10,180 -10,180 10,170 10,170 -10)),((-180 -10,-170 -10,-170 10,-180 10,-180 -10)))'::extensions.geography
          as outer_coverage,
        extensions.st_setsrid(
          extensions.st_makepoint(179, 0), 4326
        )::extensions.geography as anchor
    )
    select
      truth.viirs_firemask_geography_is_locally_valid_v1(
        outer_coverage,
        anchor
      )
      and truth.viirs_firemask_geography_covers_locally_v1(
        outer_coverage,
        extensions.st_buffer(anchor, 1000),
        anchor
      )
    from split_dateline_case
  ),
  'component validation and seam dissolution preserve RFC 7946 split-antimeridian footprints'
);

select ok(
  (
    with broad_case as (
      select
        'SRID=4326;POLYGON((-80 20,70 25,60 65,-50 55,-80 20))'::extensions.geography
          as outer_coverage,
        extensions.st_setsrid(
          extensions.st_makepoint(2, 72), 4326
        )::extensions.geography as anchor
    )
    select
      truth.viirs_firemask_geography_is_locally_valid_v1(
        outer_coverage,
        anchor
      )
      and truth.viirs_firemask_geography_covers_locally_v1(
        outer_coverage,
        extensions.st_buffer(anchor, 1),
        anchor
      )
    from broad_case
  ),
  'gnomonic coverage preserves a broad coarse CMR-style geodesic footprint'
);

select ok(
  (
    with sparse_edge_case as (
      select
        'SRID=4326;POLYGON((-60 40,60 40,60 60,-60 60,-60 40))'::extensions.geography
          as outer_coverage,
        extensions.st_setsrid(
          extensions.st_makepoint(0, 59.34), 4326
        )::extensions.geography as anchor
    )
    select truth.viirs_firemask_geography_covers_locally_v1(
      outer_coverage,
      extensions.st_buffer(anchor, 14000),
      anchor
    )
    from sparse_edge_case
  ),
  'spherical gnomonic coverage preserves sparse great-circle boundary semantics'
);

select ok(
  not truth.viirs_firemask_geography_is_locally_valid_v1(
    'SRID=4326;POLYGON((25.99 38.99,26.01 39.01,26.01 38.99,25.99 39.01,25.99 38.99))'::extensions.geography,
    extensions.st_setsrid(
      extensions.st_makepoint(26, 39), 4326
    )::extensions.geography
  )
  and not truth.viirs_firemask_geography_covers_locally_v1(
    extensions.st_buffer(
      extensions.st_setsrid(
        extensions.st_makepoint(26, 39), 4326
      )::extensions.geography,
      2000
    ),
    'SRID=4326;POLYGON((25.99 38.99,26.01 39.01,26.01 38.99,25.99 39.01,25.99 38.99))'::extensions.geography,
    extensions.st_setsrid(
      extensions.st_makepoint(26, 39), 4326
    )::extensions.geography
  ),
  'local projection rejects malformed self-intersecting coverage'
);

select ok(
  not exists (
    select 1
    from pg_proc as function_row
    cross join lateral aclexplode(coalesce(
      function_row.proacl,
      acldefault('f', function_row.proowner)
    )) as privilege_row
    where function_row.oid =
      'truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(bigint,bigint,bigint,bigint,bigint,boolean)'::regprocedure
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege('anon',
    'truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(bigint,bigint,bigint,bigint,bigint,boolean)',
    'EXECUTE')
  and not has_function_privilege('authenticated',
    'truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(bigint,bigint,bigint,bigint,bigint,boolean)',
    'EXECUTE')
  and not has_function_privilege('service_role',
    'truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(bigint,bigint,bigint,bigint,bigint,boolean)',
    'EXECUTE')
  and has_function_privilege('firewatch_reconciler',
    'truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(bigint,bigint,bigint,bigint,bigint,boolean)',
    'EXECUTE'),
  'conservative helper is callable only by the reconciler that writes generated rows'
);

select ok(
  truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(2, 1, 1, 0, 0, true)
  and not truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(0, 0, 0, 0, 0, true)
  and not truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(2, 1, 1, 1, 0, true)
  and not truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(2, 1, 1, 0, 1, true)
  and not truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(2, 1, 1, 0, 0, false)
  and not truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(2, 1, 0, 0, 0, true),
  'helper permits only complete water/land, valid-geolocation, nominal-QA coverage'
);

select ok(
  (select count(*) = 10
   from pg_constraint as foreign_key
   where foreign_key.contype = 'f'
     and foreign_key.conrelid in (
       'core.viirs_firemask_product_profiles'::regclass,
       'ingest.viirs_firemask_asset_pairs'::regclass,
       'truth.viirs_firemask_support_assessments'::regclass
     ))
  and not exists (
    select 1
    from pg_constraint as foreign_key
    where foreign_key.contype = 'f'
      and foreign_key.conrelid in (
        'core.viirs_firemask_product_profiles'::regclass,
        'ingest.viirs_firemask_asset_pairs'::regclass,
        'truth.viirs_firemask_support_assessments'::regclass
      )
      and not exists (
        select 1
        from pg_index as index_row
        where index_row.indrelid = foreign_key.conrelid
          and index_row.indisvalid
          and index_row.indisready
          and index_row.indpred is null
          and index_row.indexprs is null
          and index_row.indnkeyatts > 0
          and index_row.indkey[0] = foreign_key.conkey[1]
      )
  ),
  'every child FK has a valid nonpartial index led by its first child column'
);

select ok(
  (select count(*) = 5
   from information_schema.columns
   where table_schema = 'ingest'
     and table_name = 'viirs_firemask_asset_pairs'
     and column_name in (
       'firemask_algorithm_version', 'firemask_pge_version',
       'firemask_process_version', 'geolocation_pge_version',
       'geolocation_process_version'
     ))
  and (select count(*) = 9
       from information_schema.columns
       where table_schema = 'ingest'
         and table_name = 'viirs_firemask_asset_pairs'
         and column_name in (
           'firemask_local_granule_id', 'geolocation_local_granule_id',
           'firemask_input_pointer', 'firemask_geolocation_attribute_name',
           'firemask_geolocation_attribute_value', 'cmr_catalog_granule_id',
           'cmr_footprint_source',
           'firemask_collection_file_version',
           'geolocation_collection_file_version'
         ))
  and (select count(*) = 5
       from information_schema.columns
       where table_schema = 'ingest'
         and table_name = 'viirs_firemask_asset_pairs'
         and column_name in (
           'geolocation_coordinate_storage_type',
           'geolocation_latitude_fill_value',
           'geolocation_longitude_fill_value',
           'geolocation_latitude_fill_ieee754_hex',
           'geolocation_longitude_fill_ieee754_hex'
         )),
  'exact asset IDs, versions, CMR encoding, geolocation references, fill provenance, and process metadata are durable'
);

select ok(
  (select count(*) = 6 and bool_and(attribute.attgenerated = 's')
   from pg_attribute as attribute
   where attribute.attrelid =
     'truth.viirs_firemask_support_assessments'::regclass
     and attribute.attname in (
       'algorithm_qa_rejection_mask', 'geolocation_invalid_mask',
       'qa_rule_id', 'qa_rule_version', 'coordinate_validity_rule',
       'support_coverage_method'
     ))
  and (select attribute.attgenerated = ''
         and attribute.attnotnull
         and pg_get_expr(default_row.adbin, default_row.adrelid) = 'false'
       from pg_attribute as attribute
       join pg_attrdef as default_row
         on default_row.adrelid = attribute.attrelid
        and default_row.adnum = attribute.attnum
       where attribute.attrelid =
           'truth.viirs_firemask_support_assessments'::regclass
         and attribute.attname = 'complete_modeled_support_coverage')
  and (select count(*) = 3 and bool_and(
         pg_get_expr(default_row.adbin, default_row.adrelid)
           like '%complete_modeled_support_coverage%'
         and pg_get_expr(default_row.adbin, default_row.adrelid)
           not ilike '%st_covers%'
       )
       from pg_attribute as attribute
       join pg_attrdef as default_row
         on default_row.adrelid = attribute.attrelid
        and default_row.adnum = attribute.attnum
       where attribute.attrelid =
           'truth.viirs_firemask_support_assessments'::regclass
         and attribute.attname in (
           'internal_candidate_eligible', 'outcome', 'indeterminate_reasons'
         )),
  'QA provenance is generated while the validator-owned coverage proof is ordinary, non-null, and fail-closed by default'
);

select throws_ok(
  $$update core.viirs_firemask_product_profiles
    set platform = platform
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '55000',
  'core.viirs_firemask_product_profiles rows are immutable; append a successor revision',
  'profile update is blocked by the immutable trigger'
);

select throws_ok(
  $$insert into ingest.viirs_firemask_asset_pairs (
    public_id, contract_version, firms_product, firemask_product,
    geolocation_product, platform, cmr_observation_cursor,
    cmr_catalog_granule_id, cmr_footprint_source,
    firemask_local_granule_id,
    geolocation_local_granule_id, firemask_input_pointer,
    firemask_geolocation_attribute_value,
    firemask_collection_file_version,
    geolocation_collection_file_version,
    firemask_observed_from, firemask_observed_to,
    geolocation_observed_from, geolocation_observed_to,
    firemask_algorithm_version, firemask_pge_version,
    firemask_process_version, geolocation_pge_version,
    geolocation_process_version, geolocation_coordinate_storage_type,
    geolocation_latitude_fill_value, geolocation_longitude_fill_value,
    geolocation_latitude_fill_ieee754_hex,
    geolocation_longitude_fill_ieee754_hex,
    source_id, endpoint_id, run_id,
    adapter_release_id, firemask_http_exchange_id,
    firemask_raw_object_id, firemask_content_sha256,
    geolocation_http_exchange_id, geolocation_raw_object_id,
    geolocation_content_sha256, lease_token, lease_owner, known_at,
    limitations
  ) values (
    '018f0000-0000-7000-8000-000000009901', '0.1.0-internal',
    'VIIRS_SNPP_NRT', 'VNP14IMG', 'VNP03IMG', 'Suomi-NPP', 999901,
    'G999901-TEST', 'umm-g-gpolygon',
    'VNP14IMG.A2026213.1000.002.2026213150000.nc',
    'VNP03IMG.A2026213.1000.002.2026213150000.nc',
    '/input/VNP02IMG.A2026213.1000.002.2026213150000.nc,/input/VNP03IMG.A2026213.1000.002.2026213150000.nc',
    'VNP03IMG.A2026213.1000.002.2026213150000.nc',
    '002', '002',
    now() - interval '10 minutes', now() - interval '5 minutes',
    now() - interval '10 minutes', now() - interval '5 minutes',
    'test', 'test', 'test', 'test', 'test',
    'float32', '-999.9'::real::double precision,
    '-999.9'::real::double precision, 'c479f99a', 'c479f99a',
    999901, 999901, 999901,
    999901, 999901, 999901, repeat('a', 64), 999902, 999902,
    repeat('b', 64), '00000000-0000-0000-0000-000000000001',
    'test-worker', now(), array[
      'internal_evidence_only', 'exact_firemask_geolocation_pair',
      'raw_asset_bytes_private', 'source_declared_fill_values_persisted',
      'cmr_catalog_metadata_not_pixel_assessment',
      'pair_is_not_negative_assessment', 'not_official_status',
      'not_protective_guidance', 'not_incident_resolution', 'not_all_clear'
    ]::text[]
  )$$,
  '55000',
  'VIIRS asset collection is disabled in contract 0.1.0-internal',
  'a real reviewed profile hits the hard-disabled gate before dummy external lineage'
);

select throws_ok(
  $$insert into truth.viirs_firemask_support_assessments (
    public_id, contract_version, original_detection_id, asset_pair_id,
    rule_id, rule_version, as_of, known_at, intersecting_pixel_count,
    mask_class_0_count, mask_class_1_count, mask_class_2_count,
    mask_class_3_count, mask_class_4_count, mask_class_5_count,
    mask_class_6_count, mask_class_7_count, mask_class_8_count,
    mask_class_9_count, invalid_geolocation_pixel_count,
    non_nominal_qa_pixel_count, canonical_modeled_support_geog,
    assessed_pixel_coverage_geog, limitations
  ) values (
    '018f0000-0000-7000-8000-000000009902', '0.1.0-internal',
    999901, 999901, 'viirs-c2-firemask-assessability', '0.1.0',
    now() - interval '1 minute', now(), 0,
    0,0,0,0,0,0,0,0,0,0,0,0,
    extensions.st_geomfromtext(
      'POLYGON((26 39,26.01 39,26.01 39.01,26 39.01,26 39))', 4326
    ),
    null,
    array[
      'internal_evidence_only', 'candidate_only_not_a_negative_assessment',
      'thermal_pixel_not_fire_perimeter', 'not_official_status',
      'not_protective_guidance', 'not_notification',
      'not_incident_resolution', 'not_all_clear'
    ]::text[]
  )$$,
  '23514',
  'VIIRS support assessment requires the exact original FIRMS detection and same-platform asset pair',
  'support-assessment insertion is blocked without exact detection/pair lineage'
);

-- Exercise immutable row shapes without fabricating or bypassing production
-- lineage: LIKE copies generated expressions and checks, not FKs or triggers.
create temporary table viirs_firemask_asset_pair_contract (
  like ingest.viirs_firemask_asset_pairs
    including defaults including identity including generated
    including constraints
);

insert into viirs_firemask_asset_pair_contract (
  public_id, contract_version, firms_product, firemask_product,
  geolocation_product, platform, cmr_observation_cursor,
  cmr_catalog_granule_id, cmr_footprint_source,
  firemask_local_granule_id,
  geolocation_local_granule_id, firemask_input_pointer,
  firemask_geolocation_attribute_value,
  firemask_collection_file_version, geolocation_collection_file_version,
  firemask_observed_from, firemask_observed_to,
  geolocation_observed_from, geolocation_observed_to,
  firemask_algorithm_version, firemask_pge_version,
  firemask_process_version, geolocation_pge_version,
  geolocation_process_version, geolocation_coordinate_storage_type,
  geolocation_latitude_fill_value, geolocation_longitude_fill_value,
  geolocation_latitude_fill_ieee754_hex,
  geolocation_longitude_fill_ieee754_hex,
  source_id, endpoint_id, run_id, adapter_release_id,
  firemask_http_exchange_id, firemask_raw_object_id,
  firemask_content_sha256, geolocation_http_exchange_id,
  geolocation_raw_object_id, geolocation_content_sha256,
  lease_token, lease_owner, known_at, limitations, recorded_at
) values
(
  '018f0000-0000-7000-8000-000000009921', '0.1.0-internal',
  'VIIRS_SNPP_NRT', 'VNP14IMG', 'VNP03IMG', 'Suomi-NPP', 1,
  'G999921-TEST', 'umm-g-gpolygon',
  'VNP14IMG.A2026213.1000.002.2026213150000.nc',
  'VNP03IMG.A2026213.1000.002.2026213150000.nc',
  '/input/VNP02IMG.A2026213.1000.002.2026213150000.nc,/input/VNP03IMG.A2026213.1000.002.2026213150000.nc',
  'VNP03IMG.A2026213.1000.002.2026213150000.nc',
  '002', '002',
  '2026-08-01 10:00+00', '2026-08-01 10:05+00',
  '2026-08-01 10:00+00', '2026-08-01 10:05+00',
  '2.0', '2.0', '2.0', '2.0', '2.0',
  'float32', '-999.9'::real::double precision,
  '-999.8'::real::double precision, 'c479f99a', 'c479f333',
  1, 1, 1, 1, 1, 1, repeat('a', 64), 2, 2, repeat('b', 64),
  '00000000-0000-0000-0000-000000000001', 'test-worker',
  '2026-08-01 10:20+00',
  array[
    'internal_evidence_only', 'exact_firemask_geolocation_pair',
    'raw_asset_bytes_private', 'source_declared_fill_values_persisted',
    'cmr_catalog_metadata_not_pixel_assessment',
    'pair_is_not_negative_assessment', 'not_official_status',
    'not_protective_guidance', 'not_incident_resolution', 'not_all_clear'
  ]::text[],
  '2026-08-01 10:20+00'
),
(
  '018f0000-0000-7000-8000-000000009922', '0.1.0-internal',
  'VIIRS_NOAA20_NRT', 'VJ114IMG', 'VJ103IMG', 'NOAA-20', 2,
  'G999922-TEST', 'umm-g-gpolygon',
  'VJ114IMG.A2026213.1000.002.2026213150000.nc',
  'VJ103IMG.A2026213.1000.021.2026213150000.nc',
  '/input/VJ102IMG.A2026213.1000.021.2026213150000.nc,/input/VJ103IMG.A2026213.1000.021.2026213150000.nc',
  'VJ103IMG.A2026213.1000.021.2026213150000.nc',
  '002', '021',
  '2026-08-01 10:00+00', '2026-08-01 10:05+00',
  '2026-08-01 10:00+00', '2026-08-01 10:05+00',
  '2.0', '2.0', '2.0', '2.0', '2.0',
  'float32', '-999.9'::real::double precision,
  '-999.8'::real::double precision, 'c479f99a', 'c479f333',
  2, 2, 2, 2, 3, 3, repeat('c', 64), 4, 4, repeat('d', 64),
  '00000000-0000-0000-0000-000000000002', 'test-worker',
  '2026-08-01 10:20+00',
  array[
    'internal_evidence_only', 'exact_firemask_geolocation_pair',
    'raw_asset_bytes_private', 'source_declared_fill_values_persisted',
    'cmr_catalog_metadata_not_pixel_assessment',
    'pair_is_not_negative_assessment', 'not_official_status',
    'not_protective_guidance', 'not_incident_resolution', 'not_all_clear'
  ]::text[],
  '2026-08-01 10:20+00'
);

select throws_ok(
  $$update viirs_firemask_asset_pair_contract
    set cmr_footprint_source = 'umm-g-bounding-rectangle'
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '23514',
  'new row for relation "viirs_firemask_asset_pair_contract" violates check constraint "viirs_firemask_asset_pairs_cmr_footprint_source_check"',
  'a CMR bounding rectangle cannot become assessability coverage'
);

select throws_ok(
  $$update viirs_firemask_asset_pair_contract
    set geolocation_coordinate_storage_type = 'float64'
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '23514',
  'new row for relation "viirs_firemask_asset_pair_contract" violates check constraint "viirs_firemask_asset_pairs_coordinate_storage_type_check"',
  'only the exact Float32 storage type used by the pinned geolocation arrays is accepted'
);

select throws_ok(
  $$update viirs_firemask_asset_pair_contract
    set firemask_local_granule_id =
      'VNP14IMG.A2026213.1000.999.2026213150000.nc'
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '23514',
  'new row for relation "viirs_firemask_asset_pair_contract" violates check constraint "viirs_firemask_asset_pairs_local_ids_check"',
  'LocalGranuleID version segment must match the exact persisted VersionID'
);

select throws_ok(
  $$update viirs_firemask_asset_pair_contract
    set firemask_local_granule_id =
      'VNP14IMG.A2026213.1000.002.202621315000.nc'
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '23514',
  'new row for relation "viirs_firemask_asset_pair_contract" violates check constraint "viirs_firemask_asset_pairs_local_ids_check"',
  'LocalGranuleID cannot omit the exact thirteen-digit production timestamp'
);

select throws_ok(
  $$update viirs_firemask_asset_pair_contract
    set firemask_local_granule_id =
      'VNP14IMG.A2026213.1000.002.2026213150000.nc.xml'
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '23514',
  'new row for relation "viirs_firemask_asset_pair_contract" violates check constraint "viirs_firemask_asset_pairs_local_ids_check"',
  'LocalGranuleID cannot append an unreviewed asset suffix'
);

select throws_ok(
  $$update viirs_firemask_asset_pair_contract
    set geolocation_local_granule_id =
          'VNP03IMG.A2026213.1006.002.2026213150000.nc',
        firemask_geolocation_attribute_value =
          'VNP03IMG.A2026213.1006.002.2026213150000.nc'
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '23514',
  'new row for relation "viirs_firemask_asset_pair_contract" violates check constraint "viirs_firemask_asset_pairs_local_ids_check"',
  'FireMask and geolocation filenames must identify the same acquisition minute'
);

select throws_ok(
  $$update viirs_firemask_asset_pair_contract
    set firemask_local_granule_id =
          'VNP14IMG.A2026213.1006.002.2026213150000.nc',
        geolocation_local_granule_id =
          'VNP03IMG.A2026213.1006.002.2026213150000.nc',
        firemask_geolocation_attribute_value =
          'VNP03IMG.A2026213.1006.002.2026213150000.nc'
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '23514',
  'new row for relation "viirs_firemask_asset_pair_contract" violates check constraint "viirs_firemask_asset_pairs_local_ids_check"',
  'mutually paired filenames cannot be attached to a different CMR pass minute'
);

select ok(
  (select bool_and(
     firemask_input_pointer like '/input/%.nc,/input/%.nc'
     and firemask_input_pointer <> geolocation_local_granule_id
     and firemask_geolocation_attribute_name = geolocation_product
     and firemask_geolocation_attribute_value = geolocation_local_granule_id
     and firemask_collection_file_version = '002'
     and geolocation_collection_file_version = case firms_product
       when 'VIIRS_SNPP_NRT' then '002'
       else '021'
     end
   ) from viirs_firemask_asset_pair_contract),
  'raw NASA-style InputPointer metadata is preserved separately from the exact platform geolocation attribute'
);

select ok(
  (select count(*) = 2 and bool_and(
     geolocation_coordinate_storage_type = 'float32'
     and geolocation_latitude_fill_value =
       '-999.9'::real::double precision
     and geolocation_longitude_fill_value =
       '-999.8'::real::double precision
     and geolocation_latitude_fill_ieee754_hex = 'c479f99a'
     and geolocation_longitude_fill_ieee754_hex = 'c479f333'
   ) from viirs_firemask_asset_pair_contract),
  'decoded finite fill values retain exact lowercase IEEE-754 bits for Float32 source arrays'
);

select ok(
  (select pg_get_constraintdef(constraint_row.oid) like '%float4send%'
      and pg_get_constraintdef(constraint_row.oid) not like '%float8send%'
   from pg_constraint as constraint_row
   where constraint_row.conrelid =
       'ingest.viirs_firemask_asset_pairs'::regclass
     and constraint_row.conname =
       'viirs_firemask_asset_pairs_fill_bits_check'),
  'fill provenance derives exact bits from the decoded Float32 value only'
);

select throws_ok(
  $$update viirs_firemask_asset_pair_contract
    set geolocation_latitude_fill_value = -999.90001::double precision
    where firms_product = 'VIIRS_SNPP_NRT'$$,
  '23514',
  'new row for relation "viirs_firemask_asset_pair_contract" violates check constraint "viirs_firemask_asset_pairs_fill_bits_check"',
  'float32 fill provenance rejects a nearby double that only rounds to the declared bits'
);

create temporary table viirs_firemask_assessment_contract (
  like truth.viirs_firemask_support_assessments
    including defaults including identity including generated
    including constraints
);

insert into viirs_firemask_assessment_contract (
  public_id, contract_version, original_detection_id, asset_pair_id,
  rule_id, rule_version, as_of, known_at, intersecting_pixel_count,
  mask_class_0_count, mask_class_1_count, mask_class_2_count,
  mask_class_3_count, mask_class_4_count, mask_class_5_count,
  mask_class_6_count, mask_class_7_count, mask_class_8_count,
  mask_class_9_count, invalid_geolocation_pixel_count,
  non_nominal_qa_pixel_count, canonical_modeled_support_geog,
  assessed_pixel_coverage_geog, complete_modeled_support_coverage,
  limitations, recorded_at
) values
(
  '018f0000-0000-7000-8000-000000009911', '0.1.0-internal', 1, 1,
  'viirs-c2-firemask-assessability', '0.1.0',
  '2026-07-31 10:11+00', '2026-07-31 10:20+00', 2,
  0,0,0,1,0,1,0,0,0,0,0,0,
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  true,
  array['internal_evidence_only','candidate_only_not_a_negative_assessment','thermal_pixel_not_fire_perimeter','not_official_status','not_protective_guidance','not_notification','not_incident_resolution','not_all_clear'],
  '2026-07-31 10:20+00'
),
(
  '018f0000-0000-7000-8000-000000009912', '0.1.0-internal', 2, 2,
  'viirs-c2-firemask-assessability', '0.1.0',
  '2026-07-31 10:11+00', '2026-07-31 10:20+00', 2,
  0,0,0,0,1,0,0,0,1,0,1,1,
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  extensions.st_geomfromtext('POLYGON((26 39,26.01 39,26.01 39.01,26 39.01,26 39))',4326),
  false,
  array['internal_evidence_only','candidate_only_not_a_negative_assessment','thermal_pixel_not_fire_perimeter','not_official_status','not_protective_guidance','not_notification','not_incident_resolution','not_all_clear'],
  '2026-07-31 10:20+00'
),
(
  '018f0000-0000-7000-8000-000000009913', '0.1.0-internal', 3, 3,
  'viirs-c2-firemask-assessability', '0.1.0',
  '2026-07-31 10:11+00', '2026-07-31 10:20+00', 2,
  0,0,0,1,0,1,0,0,0,0,0,0,
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  extensions.st_geomfromtext('POLYGON((26 39,26.01 39,26.01 39.01,26 39.01,26 39))',4326),
  false,
  array['internal_evidence_only','candidate_only_not_a_negative_assessment','thermal_pixel_not_fire_perimeter','not_official_status','not_protective_guidance','not_notification','not_incident_resolution','not_all_clear'],
  '2026-07-31 10:20+00'
),
(
  '018f0000-0000-7000-8000-000000009914', '0.1.0-internal', 4, 4,
  'viirs-c2-firemask-assessability', '0.1.0',
  '2026-07-31 10:11+00', '2026-07-31 10:20+00', 2,
  0,0,0,1,0,1,0,0,0,0,0,0,
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  null,
  false,
  array['internal_evidence_only','candidate_only_not_a_negative_assessment','thermal_pixel_not_fire_perimeter','not_official_status','not_protective_guidance','not_notification','not_incident_resolution','not_all_clear'],
  '2026-07-31 10:20+00'
),
(
  '018f0000-0000-7000-8000-000000009915', '0.1.0-internal', 5, 5,
  'viirs-c2-firemask-assessability', '0.1.0',
  '2026-07-31 10:11+00', '2026-07-31 10:20+00', 0,
  0,0,0,0,0,0,0,0,0,0,0,0,
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  true,
  array['internal_evidence_only','candidate_only_not_a_negative_assessment','thermal_pixel_not_fire_perimeter','not_official_status','not_protective_guidance','not_notification','not_incident_resolution','not_all_clear'],
  '2026-07-31 10:20+00'
),
(
  '018f0000-0000-7000-8000-000000009916', '0.1.0-internal', 6, 6,
  'viirs-c2-firemask-assessability', '0.1.0',
  '2026-07-31 10:11+00', '2026-07-31 10:20+00', 2,
  0,0,0,1,0,1,0,0,0,0,1,1,
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  true,
  array['internal_evidence_only','candidate_only_not_a_negative_assessment','thermal_pixel_not_fire_perimeter','not_official_status','not_protective_guidance','not_notification','not_incident_resolution','not_all_clear'],
  '2026-07-31 10:20+00'
),
(
  '018f0000-0000-7000-8000-000000009917', '0.1.0-internal', 7, 7,
  'viirs-c2-firemask-assessability', '0.1.0',
  '2026-07-31 10:11+00', '2026-07-31 10:20+00', 5,
  1,1,1,0,1,0,1,0,0,0,0,0,
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  extensions.st_geomfromtext('POLYGON((26 39,26.02 39,26.02 39.02,26 39.02,26 39))',4326),
  true,
  array['internal_evidence_only','candidate_only_not_a_negative_assessment','thermal_pixel_not_fire_perimeter','not_official_status','not_protective_guidance','not_notification','not_incident_resolution','not_all_clear'],
  '2026-07-31 10:20+00'
),
(
  '018f0000-0000-7000-8000-000000009918', '0.1.0-internal', 8, 8,
  'viirs-c2-firemask-assessability', '0.1.0',
  '2026-07-31 10:11+00', '2026-07-31 10:20+00', 2,
  0,0,0,1,0,1,0,0,0,0,0,0,
  extensions.st_buffer(
    extensions.st_setsrid(
      extensions.st_makepoint(179.999, 39), 4326
    )::extensions.geography,
    1000
  ),
  extensions.st_buffer(
    extensions.st_setsrid(
      extensions.st_makepoint(179.999, 39), 4326
    )::extensions.geography,
    2000
  ),
  true,
  array['internal_evidence_only','candidate_only_not_a_negative_assessment','thermal_pixel_not_fire_perimeter','not_official_status','not_protective_guidance','not_notification','not_incident_resolution','not_all_clear'],
  '2026-07-31 10:20+00'
);

select throws_ok(
  $$update viirs_firemask_assessment_contract
    set intersecting_pixel_count = 100001,
      mask_class_3_count = 100001,
      mask_class_5_count = 0
    where public_id = '018f0000-0000-7000-8000-000000009911'$$,
  '23514',
  'new row for relation "viirs_firemask_assessment_contract" violates check constraint "viirs_firemask_support_assessmen_intersecting_pixel_count_check"',
  'persisted assessment accounting cannot exceed the reviewed 100000-pixel decoder bound'
);

select ok(
  (select outcome = 'no_firemask_class_candidate'
      and internal_candidate_eligible
      and complete_modeled_support_coverage
      and algorithm_qa_rejection_mask = 127
      and geolocation_invalid_mask = 7
      and qa_rule_id = 'viirs-c2-firemask-input-and-geolocation-qa'
      and qa_rule_version = '0.1.0'
      and coordinate_validity_rule = 'finite_wgs84_not_declared_fill_v1'
      and support_coverage_method = 'geolocated_pixel_union_covers_modeled_support_v1'
      and not negative_assessment_eligible
      and not notification_eligible
      and not official_status_eligible
      and not protective_action_eligible
      and not incident_resolution_eligible
      and not all_clear_eligible
   from viirs_firemask_assessment_contract
   where public_id = '018f0000-0000-7000-8000-000000009911'),
  'complete nominal water/land coverage is only an internal no-FireMask-class candidate'
);

select ok(
  (select outcome = 'fire_returned'
      and fire_pixel_count = 1
      and indeterminate_reasons = '{}'::text[]
      and not negative_assessment_eligible
   from viirs_firemask_assessment_contract
   where public_id = '018f0000-0000-7000-8000-000000009912'),
  'fire classes take precedence despite QA and incomplete coverage'
);

select ok(
  (select outcome = 'indeterminate'
      and not internal_candidate_eligible
      and indeterminate_reasons =
        array['incomplete_modeled_support_coverage']::text[]
      and not negative_assessment_eligible
   from viirs_firemask_assessment_contract
   where public_id = '018f0000-0000-7000-8000-000000009913'),
  'otherwise-valid non-fire pixels remain indeterminate without complete support coverage'
);

select ok(
  (select outcome = 'indeterminate'
      and assessed_pixel_coverage_geog is null
      and not complete_modeled_support_coverage
      and not internal_candidate_eligible
      and indeterminate_reasons =
        array['incomplete_modeled_support_coverage']::text[]
      and not negative_assessment_eligible
   from viirs_firemask_assessment_contract
   where public_id = '018f0000-0000-7000-8000-000000009914'),
  'null assessed coverage remains reconstructable, indeterminate, and negative-ineligible'
);

select ok(
  (select outcome = 'indeterminate'
      and not internal_candidate_eligible
      and indeterminate_reasons = array['no_intersecting_pixels']::text[]
   from viirs_firemask_assessment_contract
   where public_id = '018f0000-0000-7000-8000-000000009915'),
  'zero pixels have exactly the no-intersecting-pixels reason'
);

select ok(
  (select outcome = 'indeterminate'
      and not internal_candidate_eligible
      and indeterminate_reasons =
        array['invalid_geolocation', 'non_nominal_qa']::text[]
   from viirs_firemask_assessment_contract
   where public_id = '018f0000-0000-7000-8000-000000009916'),
  'invalid geolocation and non-nominal QA produce exactly their bounded reasons'
);

select ok(
  (select outcome = 'indeterminate'
      and not internal_candidate_eligible
      and indeterminate_reasons = array[
        'class_0_not_processed', 'class_1_bowtie_deleted',
        'class_2_sun_glint', 'class_4_cloud', 'class_6_unclassified'
      ]::text[]
   from viirs_firemask_assessment_contract
   where public_id = '018f0000-0000-7000-8000-000000009917'),
  'all non-assessable non-fire classes produce the exact canonical reason array'
);

select ok(
  (select pg_typeof(canonical_modeled_support_geog) =
        'extensions.geography'::regtype
      and extensions.st_xmin(
        canonical_modeled_support_geog::extensions.geometry
      ) < -179
      and extensions.st_xmax(
        canonical_modeled_support_geog::extensions.geometry
      ) > 179
      and truth.viirs_firemask_geography_covers_locally_v1(
        assessed_pixel_coverage_geog,
        canonical_modeled_support_geog,
        extensions.st_setsrid(
          extensions.st_makepoint(179.999, 39), 4326
        )::extensions.geography
      )
      and complete_modeled_support_coverage
      and outcome = 'no_firemask_class_candidate'
   from viirs_firemask_assessment_contract
   where public_id = '018f0000-0000-7000-8000-000000009918'),
  'persisted geography operands prove complete modeled-support coverage across the antimeridian'
);

select ok(
  (select count(*) = 8 and bool_and(
     not negative_assessment_eligible
     and not notification_eligible
     and not official_status_eligible
     and not protective_action_eligible
     and not incident_resolution_eligible
     and not all_clear_eligible
   ) from viirs_firemask_assessment_contract),
  'every generated outcome keeps every negative, notification, status, action, resolution, and all-clear authority gate false'
);

select ok(
  to_regclass('api.viirs_firemask_asset_pairs') is null
  and to_regclass('api.viirs_firemask_support_assessments') is null,
  'foundation exposes no public API object'
);

select * from finish();
rollback;
