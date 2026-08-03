# Thermal v3 production activation

`/api/v3/thermal-anomalies` is a persisted-data endpoint. It never calls NASA
or another upstream provider, and an empty page remains indeterminate rather
than an all-clear. Browser consumption and distributed admission are both
disabled by default.

This runbook is the operational gate tracked in GitHub issue #59. Merging the
code is not authorization to enable broad traffic.

## Boundaries

The route has three independent resource boundaries:

1. `firewatch_discovery_reader` receives a role-level four-second PostgreSQL
   `statement_timeout`. The setting is active before the outer PostgREST
   statement starts. Active discovery functions carry no weaker local timeout.
2. The server reader aborts its Supabase fetch after five seconds.
3. A single-region Redis Lua transaction applies per-client burst and sustained
   windows, then acquires one global expiring in-flight lease before Supabase.
   The exact lease token is released in `finally`.

The admission call uses one HTTPS request and no automatic retries. Missing or
invalid configuration, missing trusted Vercel identity, Redis timeout/error,
or a malformed reply produces a sanitized `503` and zero Supabase calls.
Capacity/rate rejection produces `429`, `Retry-After`, and zero Supabase calls.
An expired lease is the crash-recovery path, not the normal release path.

The client identity is an HMAC of the single IP supplied consistently by
`x-forwarded-for`, `x-vercel-forwarded-for`, and `x-real-ip`, accepted only when
`VERCEL=1`. A missing, chained, malformed, or disagreeing value fails closed.
IPv4-mapped addresses normalize to IPv4 and IPv6 addresses share one reviewed
/64 rate bucket, preventing trivial address rotation inside a normal client
subnet. Shared IPv4/CGNAT users can share a bucket; measure fairness before
tightening limits. Raw IPs are never sent to Redis or telemetry. Do not add a
caller-controlled identity header. If a proxy is placed in front of Vercel,
keep activation off until the deployed spoof/proxy tests are repeated.

## Required server-only settings

Preview and Production need separate values where the provider supports them:

- `FIREWATCH_THERMAL_V3_ADMISSION_ENABLED=true`
- `FIREWATCH_THERMAL_V3_ACCESS_MODE=canary`
- `FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256`
- one write-capable Redis HTTPS REST pair:
  - canonical `FIREWATCH_THERMAL_ADMISSION_REDIS_URL` and
    `FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN`; or
  - Vercel Upstash `FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_URL` and
    `FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_TOKEN`
- `FIREWATCH_THERMAL_ADMISSION_IDENTITY_SECRET`
- `FIREWATCH_THERMAL_ADMISSION_BURST_LIMIT`
- `FIREWATCH_THERMAL_ADMISSION_BURST_WINDOW_SECONDS`
- `FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT`
- `FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS`
- `FIREWATCH_THERMAL_ADMISSION_GLOBAL_CONCURRENCY`
- `FIREWATCH_THERMAL_ADMISSION_LEASE_SECONDS`
- `FIREWATCH_THERMAL_ADMISSION_TIMEOUT_MS`
- `SUPABASE_DISCOVERY_READER_KEY`

None may use a `NEXT_PUBLIC_` prefix. Keep
`FIREWATCH_THERMAL_V3_UI_ENABLED=false` throughout migration, testing, key
rotation, canary, and soak. The explicit admission flag is also a kill switch:
removing it or setting it to any value other than `true` fails closed.

Canary mode requires an operator-held 43+ character base64url bearer token and
stores only its lowercase SHA-256 digest in Vercel. Send the raw token only as
`Authorization: Bearer ...` from the canary/load client. It is never logged or
sent to Redis. `public` mode rejects configurations that retain a canary digest
and must not be selected until the issue gate and soak are complete.

Use an Upstash/Redis region close to the Vercel function and Supabase project.
The REST token must be write-capable because the gate owns counters and leases.
The generated `...KV_REST_API_READ_ONLY_TOKEN`, `...KV_URL`, and
`...REDIS_URL` values are deliberately not admission fallbacks: the first
cannot run the mutating Lua transaction and the latter two are TCP connection
strings rather than the bounded HTTPS transport used by Vercel functions. If
both supported REST pairs exist, they must resolve to the same HTTPS origin and
the same write token; a mismatch fails closed before any Redis request.
Use a dedicated database/ACL identity if available. The free Upstash tier is
useful for Preview but has no production SLA or multi-zone guarantee; exceeding
its allowance safely makes this route unavailable. Review current pricing and
command accounting before Production.

A Vercel WAF rate rule for the exact route is mandatory before any canary. It
must first be deployed in Log mode, then verified and enforced. This outer edge
boundary protects function invocation and log cost from malformed traffic; it
does not replace the application semaphore. Its generated `429` must be tested
before claiming it supplies `Retry-After`. Hobby currently allows fewer
independent rate rules than Pro, so the Redis gate remains authoritative for
both configured windows.

Enable Vercel's **Automatically expose System Environment Variables** project
setting before Preview. The admission gate requires Vercel-provided
`VERCEL_URL` and `VERCEL_DEPLOYMENT_ID` in addition to `VERCEL=1` and
`VERCEL_ENV`; never create lookalike custom values. The route returns the
validated environment, immutable generated deployment host, and unique
deployment ID as attestation headers for the guarded operator harness.

References:

- [Supabase statement timeouts](https://supabase.com/docs/guides/database/postgres/timeouts)
- [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)
- [Upstash REST API](https://upstash.com/docs/redis/features/restapi)
- [Upstash Redis pricing](https://upstash.com/pricing/redis)

## Preview procedure

1. Apply migrations through the controlled Supabase Preview path. Do not paste
   SQL into Production manually.
2. Start local Supabase and run `npm run test:discovery-timeout`. The probe
   creates a temporary local-only RPC, calls it through real PostgREST as
   `firewatch_discovery_reader`, expects SQLSTATE `57014` near four seconds,
   checks `pg_stat_activity`, and drops the probe in `finally`.
3. Prefer a named Preview Supabase secret key whose current template is exactly
   `{"role":"firewatch_discovery_reader"}`. The template is mutable in the
   Supabase control plane: read it back before activation and after every
   rotation or metadata change, recording the key ID, non-secret hash/prefix,
   template, and `updated_at`. Keep `api_gateway_keys_write`/`secrets:write`
   away from runtime and routine CI identities and audit its use. If Free-plan
   restrictions prevent this, transitionally mint a time-bounded legacy HS256
   JWT outside the app with that exact role, `iss: "supabase"`, the canonical
   20-letter project `ref`, numeric `iat` and future `exp` no more than 31 days
   apart, and an optional numeric `nbf`; store only the JWT as
   `SUPABASE_DISCOVERY_READER_KEY`. Never store `SUPABASE_JWT_SECRET` in Vercel,
   the application, source, or routine deployment tooling. Local payload
   decoding is only a fail-closed preflight; Supabase must still verify the
   signature. Test the real credential through PostgREST: the two reviewed
   discovery RPCs succeed; expired/not-yet-valid/wrong-role or tampered JWTs,
   private table reads, writes, unrelated functions, and service-role
   substitution fail. Repeat these negative checks after every credential
   rotation or template verification. Rotate the fallback JWT at least monthly
   and replace it with a scoped `sb_secret_` key when the plan permits.
4. Provision dedicated Preview Redis credentials, a new random HMAC secret, and
   a canary bearer-token digest. Start with conservative temporary limits solely
   to exercise failure modes. Keep access mode `canary`.
5. Verify missing/bad/slow Redis gives `503`; each rate window and the global
   lease gives `429` plus integer `Retry-After`; Supabase receives no rejected
   call. Kill a request and confirm lease expiry recovers capacity.
6. On the deployed Preview URL, send forged `x-forwarded-for`,
   `x-vercel-forwarded-for`, and identity-like headers. Confirm Vercel supplies
   the actual client identity and callers cannot select another bucket.
7. Run representative sparse, dense, boundary, and continuation reads at every
   supported zoom. Capture `EXPLAIN (ANALYZE, BUFFERS)` and index statistics.
8. Enforce the verified route-specific WAF rule, then run the guarded harness
   against Preview only. Use the commit-specific generated `VERCEL_URL`, not a
   mutable branch alias. The route supplies server-derived deployment headers.
   The harness first attests the environment, host, and deployment ID without
   credentials and expects the canary gate's `503`; only then does it send the
   bearer for a `200` readiness request. Every staged response is re-attested,
   and every known Production host is explicitly denied:

   ```sh
   FIREWATCH_LOAD_ACK=preview-read-model-only:DEPLOYMENT.vercel.app:dpl_DEPLOYMENT_ID \
   FIREWATCH_LOAD_TARGET_URL=https://DEPLOYMENT.vercel.app/api/v3/thermal-anomalies \
   FIREWATCH_LOAD_EXPECTED_PREVIEW_HOST=DEPLOYMENT.vercel.app \
   FIREWATCH_LOAD_EXPECTED_DEPLOYMENT_ID=dpl_DEPLOYMENT_ID \
   FIREWATCH_LOAD_PRODUCTION_HOSTS=plomari-wildfire-tracker.vercel.app,PRODUCTION-DEPLOYMENT.vercel.app \
   FIREWATCH_LOAD_CANARY_TOKEN=REDACTED_OPERATOR_TOKEN \
   FIREWATCH_LOAD_CELL=wm/10/587/391 \
   FIREWATCH_LOAD_PAGE_SIZE=100 \
   FIREWATCH_LOAD_CONCURRENCY_STAGES=1,2,4,8 \
   FIREWATCH_LOAD_REQUESTS_PER_STAGE=40 \
   npm run load:thermal-v3
   ```

   Repeat first-page runs at the normal UI page size and the supported maximum
   of 100. For continuation traffic, capture one real first-page
   `time.asOf`, `time.knownAt`, and `page.nextCursor`, then repeat the command
   with the same cell and page size. Add these assignments to the full command
   above (this fragment is not a standalone command):

   ```sh
   FIREWATCH_LOAD_AS_OF=2026-07-31T12:00:00.000Z \
   FIREWATCH_LOAD_KNOWN_AT=2026-07-31T12:00:00.000Z \
   FIREWATCH_LOAD_AFTER=REDACTED_OPAQUE_CURSOR
   ```

   The continuation cursor is never emitted in results. The
   harness refuses non-HTTPS, non-Vercel, non-Preview, mismatched-host or
   deployment-ID, Production-host, excessive-stage, excessive-total, and
   oversized-response workloads. It aborts if attestation changes and emits no
   raw cell or host. Store signed result artifacts with the deployment and
   database sizes.
9. Define enforced request and concurrency numbers below 50% of the lowest
   measured saturation point. Do not copy the examples above into Production.

## Telemetry and alerts

Every request that reaches the Next.js route emits one schema-validated,
low-cardinality
`firewatch.thermal_v3.request` JSON event with status, outcome, first versus
continuation, bounded duration, zoom, page row count, `hasMore`, bounded
SQLSTATE (`54000` or `57014` only), and lease-release result. It cannot contain
URLs, raw cells, cursors, IPs, headers, exception text, or credentials.

Before canary, dashboard and alert:

- p50/p95/p99 latency and request count;
- `409`, `429`, `503`, `54000`, and `57014` rates;
- `expired_fallback` lease releases;
- PostgREST pool use and active/waiting reader queries;
- database CPU, temporary files, `pg_stat_statements`, and relevant index use.

Keep cells/cursors out of metric labels. A separately reviewed bounded sampling
pipeline is required before adding top-cell diagnostics.

Requests denied by Vercel WAF never invoke the route and therefore do not emit
the application event. Add Vercel Firewall analytics or a reviewed log drain
to the dashboard, broken down by rule and action, and alert on deny/challenge
rate, sudden allowed-traffic changes, function-invocation divergence, and
false-positive reports. Verify retention and access controls before canary.

## Production canary and rollback

1. Exercise Preview key rotation and emergency revocation.
2. Provision a separately named Production fixed-role key and Redis identity;
   leave the UI flag false and access mode `canary` with a Production-only token
   digest.
3. Enable admission. Only the server-verified canary bearer can pass the API
   gate; all other callers fail closed before Redis/Supabase. Run a minimum
   24-hour soak inside the measured envelope.
4. Perform one rollback drill. First set
   `FIREWATCH_THERMAL_V3_UI_ENABLED=false`, then disable admission/revoke its
   credential, wait for the longest lease plus in-flight reader budget, verify
   `503` and no active readers, and only then roll back database migration.
5. Preserve all ingested evidence. Neither application nor database rollback
   deletes or reinterprets observations.
6. Enable broad browser traffic only after every issue #59 acceptance item is
   evidenced and checked: remove the canary digest, switch access mode to
   `public`, then enable the UI flag in a separately reviewed deployment.
