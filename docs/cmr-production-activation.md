# NASA CMR collector production activation

The collector code is deployable, but the catalog is intentionally **disabled**.
Do not activate it until all four release identities exist: a reviewed adapter
artifact SHA-256, its Git commit, a dedicated database login, and the named
`cmr_cron` Supabase secret API key. The checked-in bootstrap does not invent
those production values.

The runtime performs one global, three-product CMR catalog scan every five
minutes. Its first successful run is a bounded 36-hour bootstrap. Later runs
use the prior completion watermark, retain a ten-minute replay overlap, and
automatically run a new bounded 36-hour reconciliation when the active target
revision's `reconciliationIntervalHours` (currently 24) is due. Catalog
footprints are pass coverage; this path never claims that a FireMask anomaly is
present or absent.

## 1. Preflight the release

From a clean release commit, run:

```sh
npm ci
npm run lint
npm run typecheck
npm test
supabase db reset
supabase db lint --local --level warning
```

Build the exact Edge Function module graph and calculate the release artifact
SHA-256 in the release workflow. Record the immutable Git commit and digest;
do not use a placeholder or a dirty-worktree hash. Apply the migrations before
activating any catalog switch.

The disabled bootstrap contains no real `core.adapter_releases` row. As a
`firewatch_catalog_admin`, register release 1 for source
`nasa-cmr-firemask`, including:

- a generated UUIDv7 `public_id`;
- `artifact_digest` equal to the reviewed bundle's lowercase SHA-256;
- the full lowercase `git_commit`;
- `schema_version = 'cmr-umm-g-1.6.7-pass-v1'`;
- `config_schema = '{}'::jsonb` (the binary accepts no runtime adapter config);
- `capabilities` exactly equal to:

```json
{
  "anomalyAssessment": "not_assessed",
  "catalogMetadataOnly": true,
  "pagination": "CMR-Search-After",
  "products": ["VNP14IMG_NRT", "VJ114IMG_NRT", "VJ214IMG_NRT"],
  "ummGVersion": "1.6.7"
}
```

Insert its `ingest.adapter_release_state` row disabled first. Adapter releases
are immutable and chained: a correction is a new release, never an update.

The seeded target revision is also deliberately disabled and immutable. Create
revision 2, chained to revision 1, with the same reviewed request parameters,
`enabled = true`, a generated UUIDv7, and an identity-v2 configuration digest
that includes that enabled state. Insert its matching
`ingest.collection_target_state` row. Do not update revision 1 in place.

Only after both immutable records are reviewed, atomically enable the mutable
switches:

```sql
begin;

update core.sources
set enabled = true
where slug = 'nasa-cmr-firemask'
  and license_status = 'approved'
  and redistribution_allowed is true;

update core.collection_targets as target
set enabled = true
from core.sources as source, core.endpoints as endpoint
where source.slug = 'nasa-cmr-firemask'
  and endpoint.source_id = source.id
  and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
  and target.source_id = source.id
  and target.endpoint_id = endpoint.id
  and target.target_key = 'global-firemask-granules';

update ingest.endpoint_state as state
set enabled = true, paused_reason = null
from core.endpoints as endpoint, core.sources as source
where source.slug = 'nasa-cmr-firemask'
  and endpoint.source_id = source.id
  and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
  and state.endpoint_id = endpoint.id;

update ingest.adapter_release_state as state
set enabled = true, retired_at = null, retirement_reason = null
from core.adapter_releases as release, core.sources as source
where source.slug = 'nasa-cmr-firemask'
  and release.source_id = source.id
  and release.artifact_digest = '<reviewed-lowercase-sha256>'
  and release.git_commit = '<reviewed-lowercase-git-commit>'
  and state.adapter_release_id = release.id;

commit;
```

Verify every statement affected exactly one row and that only one unretired,
enabled release is latest for the source. Keep the source disabled if any
identity is ambiguous. The binary and exact-claim RPC independently require
the reviewed endpoint transport, target scope/role/precision, five-minute
cadence, three-hour staleness limit, complete request-parameter JSON, adapter
schema version, capabilities, and empty config schema. A merely enabled but
drifted immutable revision or release fails closed.

## 2. Create the least-privileged runtime login

Run the following through the database administrator channel, substituting a
generated password held only in the secret manager:

```sql
create role firewatch_cmr_collector_runtime
  login inherit
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  password '<generated-high-entropy-password>';

grant firewatch_collector to firewatch_cmr_collector_runtime;

alter role firewatch_cmr_collector_runtime
  set statement_timeout = '130s';
alter role firewatch_cmr_collector_runtime
  set lock_timeout = '5s';
alter role firewatch_cmr_collector_runtime
  set idle_in_transaction_session_timeout = '15s';
```

Do not grant `service_role`, `authenticator`, any other Firewatch capability,
`BYPASSRLS`, or ownership. The function checks this identity before collection
and fails closed unless the login's direct membership is exactly
`firewatch_collector`, its effective inherited set is exactly
`anon, firewatch_collector`, and the capability role itself inherits exactly
`anon`. Any present or future extra role fails closed.

Construct `CMR_COLLECTOR_DATABASE_URL` from the dashboard's **shared pooler,
transaction mode** values:

```text
postgresql://firewatch_cmr_collector_runtime.<project-ref>:<url-encoded-password>@<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

The validator rejects the direct host, session port, default Postgres user,
service role, extra query parameters, and a missing `sslmode=require`. It also
requires the pooler username's project ref to exactly match the
platform-provided `SUPABASE_URL`, preventing a valid credential for another
project from being accepted by misconfiguration. The driver is fixed at one
connection with `prepare: false`, short connect/idle timeouts, and TLS required,
as recommended for serverless transaction pooling.

Set this value as the Edge Function secret without putting it in the repository
or shell history (for example, use a protected temporary env file with
`supabase secrets set --env-file ...`). Never reuse the application service key
as the database password.

## 3. Configure named caller authentication

In the Supabase API Keys dashboard, create a **secret** API key whose exact name
is `cmr_cron`. Supabase Edge must expose it in the platform-provided
`SUPABASE_SECRET_KEYS` JSON under that name. The function uses
`auth: 'secret:cmr_cron'`; it does not accept the default secret key, a
publishable key, or a user JWT. The handler never uses the middleware's admin
client.

`supabase/config.toml` sets `verify_jwt = false` only so the platform does not
reject this opaque API key before the named-key middleware validates it. A
request without the exact key in its `apikey` header still fails before the
collector handler runs.

Deploy only after the migration and catalog checks pass:

```sh
supabase db push --linked
supabase functions deploy collect-cmr
```

## 4. Schedule one invocation per five-minute slot

Enable `pg_cron`, `pg_net`, and Vault. Store the function URL and the named
secret key in Vault; never embed either credential in the cron definition.
Using your project's reviewed Vault secret names, schedule:

```sql
select cron.schedule(
  'collect-cmr-every-five-minutes',
  '*/5 * * * *',
  $schedule$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'cmr-collector-function-url'
    ),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cmr-cron-api-key'
      )
    ),
    body := '{"mode":"auto"}'::jsonb,
    timeout_milliseconds := 140000
  );
  $schedule$
);
```

Confirm both Vault subqueries each return exactly one secret before scheduling.
The Edge collector itself stops its work at 120 seconds, leaving roughly 30
seconds under the Supabase Free Edge wall-time/lease ceiling to commit a
terminal success or failure. Every slot has one deterministic job with
`max_attempts = 1`; there is no in-invocation retry loop.

At the beginning of every invocation, a narrow CMR-only reaper checks for one
expired final-attempt execution. It never invokes the generic queue claimer or
touches unrelated jobs. Under the existing job -> run -> exchange lock order,
it marks pending HTTP evidence indeterminate, closes the run and job failed,
increments only that target revision's failure state, preserves its last known
successful timestamp, and appends a public failed-health sample atomically. If
the same scan still needs execution, the application derives a new
deterministic `-recovery-<reaped-run-id>` job key; it never reopens or retries
the killed job.

Use `{"mode":"bootstrap"}` or `{"mode":"reconciliation"}` only for an
intentional operator invocation with the same named key. Time windows always
come from server time; callers cannot supply a timestamp, cursor, location, or
geometry.

## 5. Verify before declaring healthy

Call the function once and expect either `current`, `busy`, or a redacted
`complete` summary. A complete result must report all three products and zero
rejects. The HTTP response intentionally omits run IDs, job IDs, health
cursors, lease tokens, raw bodies, credentials, and DSNs.

As an operational read-only role, verify:

```sql
select
  completion.scan_kind,
  completion.requested_from,
  completion.requested_to,
  completion.watermark_from,
  completion.updated_since,
  completion.watermark_to,
  completion.completed_products,
  completion.page_count,
  completion.upstream_hit_count,
  completion.accepted_granule_count,
  health.status,
  health.checked_at,
  health.schema_failure_count,
  run.status as run_status,
  run.rejected_count
from ingest.cmr_scan_completions as completion
join truth.source_health as health on health.cursor = completion.health_cursor
join ingest.runs as run on run.id = completion.run_id
order by completion.health_cursor desc
limit 1;

select product, page_count, upstream_hit_count, accepted_granule_count
from ingest.cmr_scan_product_completions
where health_cursor = (
  select max(health_cursor) from ingest.cmr_scan_completions
)
order by product;

select
  occurrence.run_id,
  count(*) as accepted_occurrences,
  run.accepted_count + run.duplicate_count as accounted_occurrences
from ingest.cmr_granule_occurrences as occurrence
join ingest.runs as run on run.id = occurrence.run_id
group by occurrence.run_id, run.accepted_count, run.duplicate_count
order by occurrence.run_id desc
limit 1;

select count(*) as pending_terminal_run_exchanges
from ingest.http_exchanges as exchange
join ingest.runs as run on run.id = exchange.run_id
where run.status <> 'running' and exchange.outcome = 'pending';
```

Healthy means: a successful run; one completion; exactly three terminal product
proofs; one occurrence per accepted or duplicate parsed granule; zero
run/rejection/schema failures; and no pending exchange on a terminal run. A
failed later page publishes no early-page observation. If that exact granule
revision is later replayed successfully, its immutable per-run occurrence can
authorize the previously normalized identity without mutating either run.

## 6. Roll back without deleting evidence

First unschedule the cron job. Then, in one catalog-admin transaction, set the
endpoint state, source, and target `enabled` flags false and disable/retire the
adapter release state. Revoke the named `cmr_cron` API key and set the runtime
login `NOLOGIN` after in-flight work has drained. Do not delete or rewrite jobs,
runs, HTTP exchanges, raw objects, source revisions, observations, rejections,
health samples, or completion rows; they are the audit trail.

Implementation references:

- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Connecting Edge Functions to Postgres](https://supabase.com/docs/guides/functions/connect-to-postgres)
- [Supabase database connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Edge Function dependency management](https://supabase.com/docs/guides/functions/dependencies)
