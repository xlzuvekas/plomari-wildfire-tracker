begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select ok(
  to_regprocedure(
    'api.explore_candidate_cells_v3(timestamptz,timestamptz,timestamptz,integer,uuid,text,text,timestamptz,uuid)'
  ) is not null,
  'bounded v3 global candidate RPC exists'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig @> array['search_path=""']::text[]
      and not exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[]))
          as setting(setting_value)
        where setting.setting_value like 'statement_timeout=%'
      )
    from pg_proc as procedure
    where procedure.oid =
      'api.explore_candidate_cells_v3(timestamptz,timestamptz,timestamptz,integer,uuid,text,text,timestamptz,uuid)'::regprocedure
  ),
  'global projection is a stable SECURITY DEFINER boundary with an empty search path and no function-local timeout override'
);

select ok(
  has_function_privilege(
    'firewatch_discovery_reader',
    'api.explore_candidate_cells_v3(timestamptz,timestamptz,timestamptz,integer,uuid,text,text,timestamptz,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'api.explore_candidate_cells_v3(timestamptz,timestamptz,timestamptz,integer,uuid,text,text,timestamptz,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.explore_candidate_cells_v3(timestamptz,timestamptz,timestamptz,integer,uuid,text,text,timestamptz,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'api.explore_candidate_cells_v3(timestamptz,timestamptz,timestamptz,integer,uuid,text,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'only the scoped discovery reader can execute the global projection'
);

select ok(
  (
    select bool_and(table_class.relrowsecurity and table_class.relforcerowsecurity)
    from pg_class as table_class
    where table_class.oid in (
      'truth.global_candidate_cells'::regclass,
      'truth.global_candidate_projection_runs'::regclass,
      'truth.global_candidate_projection_items'::regclass
    )
  ),
  'all global projection tables have enabled and forced RLS'
);

select ok(
  not has_table_privilege(
    'firewatch_discovery_reader', 'truth.global_candidate_cells', 'SELECT'
  )
  and not has_table_privilege(
    'firewatch_discovery_reader',
    'truth.global_candidate_projection_runs',
    'SELECT'
  )
  and not has_table_privilege(
    'firewatch_discovery_reader',
    'truth.global_candidate_projection_items',
    'SELECT'
  )
  and not has_table_privilege(
    'service_role', 'truth.global_candidate_projection_items', 'SELECT'
  )
  and not has_table_privilege(
    'firewatch_reconciler', 'truth.global_candidate_projection_items', 'INSERT'
  ),
  'the reader, service role, and not-yet-authorized writers cannot bypass the RPC or publish snapshots'
);

select has_index(
  'truth',
  'global_candidate_projection_items',
  'global_candidate_projection_items_page_idx',
  'immutable pages have a covered snapshot/time/UUID keyset index'
);

select throws_ok(
  $$insert into truth.global_candidate_cells(
      public_id, z, x, y, display_timezone, timezone_known_at
    ) values (
      '019b0000-0000-7000-8000-000000000199', 10, 587, 391,
      'Not/A_Time_Zone',
      date_trunc('milliseconds', now() - interval '1 hour')
    )$$,
  '22023',
  'Global candidate cell requires a reviewed IANA time zone',
  'candidate identities reject unresolved civil-time display zones'
);

insert into truth.global_candidate_cells(
  public_id, z, x, y, display_timezone, timezone_known_at
) values
  (
    '019b0000-0000-7000-8000-000000000101',
    10, 587, 391, 'Europe/Athens',
    date_trunc('milliseconds', now() - interval '1 hour')
  ),
  (
    '019b0000-0000-7000-8000-000000000102',
    10, 518, 352, 'Europe/Paris',
    date_trunc('milliseconds', now() - interval '1 hour')
  );

select ok(
  (
    select cell.cell_key = 'wm/10/587/391'
      and cell.minimum_span_m between 8000 and 80000
      and cell.semantic_key_sha256 ~ '^[a-f0-9]{64}$'
    from truth.global_candidate_cells as cell
    where cell.public_id = '019b0000-0000-7000-8000-000000000101'
  ),
  'cell identity stores canonical adaptive geometry metadata and a separate semantic hash'
);

insert into truth.global_candidate_projection_runs(
  public_id, observed_from, as_of, known_at, evidence_epoch,
  publication_gate_digest, input_digest, snapshot_digest, item_count,
  materializer_release
) values (
  '019b0000-0000-7000-8000-000000000201',
  date_trunc('milliseconds', now() - interval '5 minutes') - interval '7 days',
  date_trunc('milliseconds', now() - interval '5 minutes'),
  date_trunc('milliseconds', now()),
  7,
  repeat('a', 64), repeat('b', 64), repeat('c', 64), 2,
  'pgtap-global-materializer-v1'
), (
  '019b0000-0000-7000-8000-000000000202',
  date_trunc('milliseconds', now() - interval '10 minutes') - interval '7 days',
  date_trunc('milliseconds', now() - interval '10 minutes'),
  date_trunc('milliseconds', now() - interval '5 minutes'),
  7,
  repeat('d', 64), repeat('e', 64), repeat('f', 64), 0,
  'pgtap-global-materializer-v1'
);

insert into truth.global_candidate_projection_items(
  snapshot_id, candidate_id, candidate_public_id, signal_kinds,
  observation_count, source_count, first_observed_at, latest_observed_at,
  item_known_at
) values
  (
    (select id from truth.global_candidate_projection_runs
      where public_id = '019b0000-0000-7000-8000-000000000201'),
    (select id from truth.global_candidate_cells
      where public_id = '019b0000-0000-7000-8000-000000000101'),
    '019b0000-0000-7000-8000-000000000101',
    array['thermal_detection'], 3, 1,
    date_trunc('milliseconds', now() - interval '2 hours'),
    date_trunc('milliseconds', now() - interval '10 minutes'),
    date_trunc('milliseconds', now() - interval '1 second')
  ),
  (
    (select id from truth.global_candidate_projection_runs
      where public_id = '019b0000-0000-7000-8000-000000000201'),
    (select id from truth.global_candidate_cells
      where public_id = '019b0000-0000-7000-8000-000000000102'),
    '019b0000-0000-7000-8000-000000000102',
    array['thermal_detection', 'hazard_advisory'], 4, 2,
    date_trunc('milliseconds', now() - interval '3 hours'),
    date_trunc('milliseconds', now() - interval '15 minutes'),
    date_trunc('milliseconds', now() - interval '2 seconds')
  );

select throws_ok(
  $$update truth.global_candidate_projection_runs
    set item_count = 3
    where public_id = '019b0000-0000-7000-8000-000000000201'$$,
  '55000',
  'truth.global_candidate_projection_runs rows are immutable; append a successor revision',
  'published projection runs are immutable'
);

select throws_ok(
  $$insert into truth.global_candidate_projection_items(
      snapshot_id, candidate_id, candidate_public_id, signal_kinds,
      observation_count, source_count, latest_observed_at, item_known_at
    ) values (
      (select id from truth.global_candidate_projection_runs
        where public_id = '019b0000-0000-7000-8000-000000000201'),
      (select id from truth.global_candidate_cells
        where public_id = '019b0000-0000-7000-8000-000000000101'),
      '019b0000-0000-7000-8000-000000000101',
      array['thermal_detection'], 1, 1,
      date_trunc('milliseconds', now() + interval '1 hour'),
      date_trunc('milliseconds', now() + interval '1 hour')
    )$$,
  '23514',
  'Global candidate projection item exceeds its snapshot cutoffs',
  'projection items cannot exceed the immutable snapshot cutoffs'
);

-- The production reader deliberately lacks extension-schema access. Grant
-- transaction-local pgTAP access so assertions can execute under that role.
grant usage on schema extensions to firewatch_discovery_reader;
grant execute on all functions in schema extensions to firewatch_discovery_reader;

set local role firewatch_discovery_reader;

select is(
  (
    select count(*)::bigint
    from api.explore_candidate_cells_v3(
      date_trunc('milliseconds', now() - interval '5 minutes') - interval '7 days',
      date_trunc('milliseconds', now() - interval '5 minutes'),
      date_trunc('milliseconds', now()),
      101
    )
  ),
  3::bigint,
  'a published two-item snapshot returns one sentinel plus two candidates'
);

select is(
  (
    select string_agg(page.candidate_id::text, ',' order by page.ordinality)
    from api.explore_candidate_cells_v3(
      date_trunc('milliseconds', now() - interval '5 minutes') - interval '7 days',
      date_trunc('milliseconds', now() - interval '5 minutes'),
      date_trunc('milliseconds', now()),
      101
    ) with ordinality as page(
      row_kind, snapshot_id, snapshot_as_of, snapshot_known_at,
      snapshot_observed_from, snapshot_digest, publication_gate_digest,
      candidate_id, cell_key, display_timezone, signal_kinds,
      observation_count, source_count, first_observed_at,
      latest_observed_at, item_known_at, ordinality
    )
    where page.row_kind = 'candidate'
  ),
  '019b0000-0000-7000-8000-000000000101,019b0000-0000-7000-8000-000000000102',
  'candidate rows use known-at-desc then UUID-desc keyset ordering'
);

select is(
  (
    select count(*)::bigint
    from api.explore_candidate_cells_v3(
      date_trunc('milliseconds', now() - interval '5 minutes') - interval '7 days',
      date_trunc('milliseconds', now() - interval '5 minutes'),
      date_trunc('milliseconds', now()),
      101,
      '019b0000-0000-7000-8000-000000000201',
      repeat('c', 64), repeat('a', 64),
      date_trunc('milliseconds', now() - interval '1 second'),
      '019b0000-0000-7000-8000-000000000101'
    ) as page
    where page.row_kind = 'candidate'
  ),
  1::bigint,
  'a snapshot-bound continuation resumes strictly after the last ordering tuple'
);

select is(
  (
    select count(*)::bigint
    from api.explore_candidate_cells_v3(
      date_trunc('milliseconds', now() - interval '10 minutes') - interval '7 days',
      date_trunc('milliseconds', now() - interval '10 minutes'),
      date_trunc('milliseconds', now() - interval '5 minutes'),
      101
    )
  ),
  1::bigint,
  'a published empty snapshot returns only its metadata sentinel'
);

select is(
  (
    select count(*)::bigint
    from api.explore_candidate_cells_v3(
      date_trunc('milliseconds', now() - interval '15 minutes') - interval '7 days',
      date_trunc('milliseconds', now() - interval '15 minutes'),
      date_trunc('milliseconds', now() - interval '10 minutes'),
      101
    )
  ),
  0::bigint,
  'no exact published snapshot returns zero rows rather than a false empty assessment'
);

reset role;

create temporary table captured_global_candidate_error_detail(
  detail text
) on commit drop;

do $capture_snapshot_error$
declare
  captured_detail text;
begin
  perform *
  from api.explore_candidate_cells_v3(
    date_trunc('milliseconds', now() - interval '5 minutes') - interval '7 days',
    date_trunc('milliseconds', now() - interval '5 minutes'),
    date_trunc('milliseconds', now()),
    101,
    '019b0000-0000-7000-8000-000000000201',
    repeat('0', 64), repeat('a', 64),
    date_trunc('milliseconds', now() - interval '1 second'),
    '019b0000-0000-7000-8000-000000000101'
  );
exception when others then
  get stacked diagnostics captured_detail = pg_exception_detail;
  insert into captured_global_candidate_error_detail(detail)
  values (captured_detail);
end;
$capture_snapshot_error$;

select is(
  (select detail from captured_global_candidate_error_detail),
  'firewatch_snapshot_changed_v1',
  'snapshot mismatch uses the exact PostgREST error detail mapped by the server adapter'
);

select * from finish();
rollback;
