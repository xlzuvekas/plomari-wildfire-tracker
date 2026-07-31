begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select is(
  (
    select setting.setting_value
    from pg_roles as role_row
    cross join lateral unnest(coalesce(role_row.rolconfig, array[]::text[]))
      as setting(setting_value)
    where role_row.rolname = 'firewatch_discovery_reader'
      and setting.setting_value like 'statement_timeout=%'
  ),
  'statement_timeout=4s',
  'the impersonated discovery reader has a four-second transaction timeout'
);

select is(
  (
    select count(*)::integer
    from pg_roles as role_row
    cross join lateral unnest(coalesce(role_row.rolconfig, array[]::text[]))
      as setting(setting_value)
    where role_row.rolname = 'firewatch_discovery_reader'
      and setting.setting_value like 'statement_timeout=%'
  ),
  1,
  'the discovery reader has exactly one statement timeout setting'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral unnest(coalesce(procedure.proconfig, array[]::text[]))
      as setting(setting_value)
    where procedure.oid in (
      'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)'::regprocedure,
      'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)'::regprocedure
    )
      and setting.setting_value like 'statement_timeout=%'
  ),
  'active discovery RPCs cannot override the role-wide timeout'
);

select ok(
  (
    select not role_row.rolsuper
      and not role_row.rolinherit
      and not role_row.rolcreaterole
      and not role_row.rolcreatedb
      and not role_row.rolcanlogin
      and not role_row.rolreplication
      and not role_row.rolbypassrls
    from pg_roles as role_row
    where role_row.rolname = 'firewatch_discovery_reader'
  ),
  'the bounded reader remains a non-login least-privilege role'
);

select ok(
  pg_has_role('authenticator', 'firewatch_discovery_reader', 'MEMBER')
  and not pg_has_role('anon', 'firewatch_discovery_reader', 'MEMBER')
  and not pg_has_role('authenticated', 'firewatch_discovery_reader', 'MEMBER')
  and not pg_has_role('service_role', 'firewatch_discovery_reader', 'MEMBER'),
  'only PostgREST authenticator may assume the discovery reader role'
);

select ok(
  has_schema_privilege('firewatch_discovery_reader', 'api', 'USAGE')
  and not has_schema_privilege('firewatch_discovery_reader', 'core', 'USAGE')
  and not has_schema_privilege('firewatch_discovery_reader', 'ingest', 'USAGE')
  and not has_schema_privilege('firewatch_discovery_reader', 'truth', 'USAGE')
  and not has_schema_privilege('firewatch_discovery_reader', 'extensions', 'USAGE'),
  'the discovery reader can resolve only the curated API schema'
);

select ok(
  has_function_privilege(
    'firewatch_discovery_reader',
    'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'firewatch_discovery_reader',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'firewatch_discovery_reader',
    'truth.thermal_anomalies_v3_legacy(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  ),
  'the reader retains only the reviewed discovery RPC execution paths'
);

select ok(
  not has_table_privilege(
    'firewatch_discovery_reader',
    'ingest.firms_detection_details',
    'SELECT'
  )
  and not has_table_privilege(
    'firewatch_discovery_reader',
    'truth.thermal_anomaly_assessments',
    'SELECT'
  )
  and not has_table_privilege(
    'firewatch_discovery_reader',
    'truth.thermal_anomaly_projection_epochs',
    'SELECT'
  ),
  'the reader cannot bypass curated RPCs to inspect private evidence'
);

select ok(
  (
    select bool_and(table_class.relrowsecurity and table_class.relforcerowsecurity)
    from pg_class as table_class
    where table_class.oid in (
      'ingest.firms_detection_details'::regclass,
      'truth.thermal_anomaly_assessments'::regclass,
      'truth.thermal_anomaly_projection_epochs'::regclass
    )
  ),
  'underlying evidence remains protected by enabled and forced RLS'
);

select * from finish();
rollback;
