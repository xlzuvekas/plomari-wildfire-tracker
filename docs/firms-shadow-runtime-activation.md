# FIRMS shadow runtime activation runbook

The `collect-firms` Edge Function and its database contract ship **disabled**.
This runbook is an operator checklist, not an instruction to activate from this
pull request. No cron schedule is included.

## Safety boundary

- The function makes four bounded, explicit `YYYY-MM-DD/N` Area API requests:
  `MODIS_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`, and `VIIRS_SNPP_NRT`.
- Each request issuance commits before network I/O. Exact response bytes commit
  before parsing. Accepted and rejected response-row occurrences are append-only.
- Empty responses are request evidence only. The contract fixes sensor
  assessability to `unknown` and negative-assessment eligibility to `false`.
- The FIRMS map key may exist only as the Supabase Edge secret
  `FIRMS_MAP_KEY`. Do not add it to Vercel, a `NEXT_PUBLIC_*` variable, a job
  body, a URL log, a database row, or a diagnostic.

## Required review before activation

1. Record approval of the current NASA FIRMS API terms and the exact permitted
   commercial use, redistribution, caching, retention, and attribution policy.
2. Review the four product contracts and keep `assessment_enabled = false`.
3. Review the response-size, AOI, day-range, request-timeout, total-time, and
   three-attempt retry limits in the immutable target revision.
4. Confirm there is still no public anomaly, incident-resolution, notification,
   or all-clear projection sourced from this collector.

## Dedicated database login

Provision the login out of band. Never commit its password.

```sql
create role firewatch_firms_collector_runtime
  login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  password '<generated one-time password>';
grant firewatch_collector to firewatch_firms_collector_runtime;
alter role firewatch_firms_collector_runtime
  set statement_timeout = '25s';
alter role firewatch_firms_collector_runtime
  set lock_timeout = '5s';
alter role firewatch_firms_collector_runtime
  set idle_in_transaction_session_timeout = '10s';
```

Build `FIRMS_COLLECTOR_DATABASE_URL` from the project’s **shared Supavisor
transaction pooler** on port `6543`:

```text
postgresql://firewatch_firms_collector_runtime.<project-ref>:<url-encoded-password>@<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

Set that value and `FIRMS_MAP_KEY` as Supabase Edge secrets. Create the named
invocation secret `firms_shadow`; the function uses `verify_jwt = false` only
because `@supabase/server` verifies that named secret before the handler runs.

## Immutable activation revision

Do not update disabled revision `...000502`: target revisions are immutable.
Append a successor revision with the identical request parameters and
`enabled = true`, then initialize its empty `ingest.collection_target_state`.
In the same reviewed operator migration:

- approve and enable the `nasa-firms` source;
- enable the Area CSV endpoint and clear its pause reason;
- enable the restricted `global-discovery` target;
- approve and enable exactly the four products, leaving assessment disabled;
- enable adapter release `...000701` without modifying its immutable digest;
- verify no newer enabled revision or adapter release has drifted.

Deploy `collect-firms` only after those changes. Invoke one small historical AOI
manually and inspect the private HTTP ledger, raw object receipt, response rows,
product results, run accounting, and restricted source health. Scheduling and
adaptive polling remain a later, separately reviewed change.
