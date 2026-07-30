# Persistence runbook (Supabase Postgres)

The tracker runs fully without a database. With `DATABASE_URL` configured it
gains a shared read-through cache (fewer upstream hits — the Hellenic Fire
Service board rate-limited us at 60-second per-instance polling) and an
append-only historical record that outlives every upstream's rolling window
(NASA FIRMS serves only 24 h; RSS items roll off; the fire-service board is a
point-in-time page).

## Setup

1. **Create the Supabase project** (already done: `cggrrimijkmmzpwhodqt`).
   Pick/keep a region close to the Vercel function region — every store read
   costs one round trip.
2. **Create the schema**: paste `docs/db/setup.sql` into the Supabase SQL
   editor and run it. It is idempotent. (Alternative: a Claude session with
   the Supabase MCP server authenticated — config is committed in `.mcp.json`;
   authenticate via `claude /mcp` locally or claude.ai connector settings —
   can execute the file through the MCP `database` tools.)
3. **Point the app at the pooler**: in Vercel → Settings → Environment
   Variables, set `FIREWATCH_DATABASE_URL` to the **transaction-mode pooler**
   URI (Supabase dashboard → Connect → Transaction pooler, port **6543**) for
   Production, Preview, and Development. Redeploy.
   The app reads **only** `FIREWATCH_DATABASE_URL` — generic
   `DATABASE_URL`/`POSTGRES_URL` values are deliberately ignored. A generic
   `DATABASE_URL` inherited from a Vercel integration or shared environment
   has been observed pointing at an unrelated project's production database;
   requiring the app-scoped name makes that class of accident impossible.
   (The layer also never runs DDL, so even a mispointed URL degrades to
   `store.error: "not-initialized"` rather than writing.)
4. **Schedule collection**: edit the origin URL in `docs/db/cron.sql` if it
   differs, then paste it into the SQL editor. Thermal/wind collect every
   5 min, updates every 2 min, retention prunes daily. Jobs upsert by name;
   re-pasting is safe.
5. **Verify**:
   - `GET /api/updates` → the `store` key shows `configured: true` and
     `servedFrom` cycling `upstream` → `store`.
   - `select count(*) from source_snapshots;` grows without any site visitors.
   - `select jobname, status, return_message from cron.job_run_details
      order by end_time desc limit 10;`

## Vercel Deployment Protection

If protection is enabled for production, cron GETs are rejected. Create a
protection bypass secret (Vercel → Deployment Protection → Protection Bypass
for Automation) and add to each `net.http_get` in `cron.sql`:

```sql
headers := jsonb_build_object('x-vercel-protection-bypass', '<secret>')
```

## Behavior contract

- **No `FIREWATCH_DATABASE_URL`** → every route behaves exactly as before,
  plus an additive `store: { configured: false, servedFrom: "upstream", … }`
  key.
- **DB configured but schema missing** → SQLSTATE 42P01 is caught, surfaced
  as `store.error: "not-initialized"`, and the route falls through to a live
  upstream fetch. Any deploy/DB ordering works.
- **DB slow** → store reads race a 1.5 s timeout; on timeout the route
  fetches upstream directly (`store.error: "timeout"`). The store can never
  delay the map.
- **Upstream fails** → the newest stored payload is served within a hard
  staleness cap, marked `servedFrom: "store-stale"` with `storedAt` /
  `ageSeconds`. Stored payloads are never mutated, so their embedded
  timestamps stay truthful about when they were current.

### TTLs (server-shared, one upstream fetch per window globally)

| Cache key | TTL | Stale-serve cap |
| --- | --- | --- |
| `thermal` | 120 s | 3 h |
| `wind` | 240 s | 30 min |
| `updates` | 45 s | 15 min |
| `fire-service-board` (inner) | 300 s | 60 min |

## Table ↔ truth-layer mapping (#8/#13 roadmap)

| Table | Roadmap concept | Notes |
| --- | --- | --- |
| `source_snapshots` | workstream B "source items" (raw response history) | NOT the spec's `incident_state_snapshots` read model |
| `thermal_detections` | per-detection persistence required by spec §11.3 | `natural_key` matches PR #15's `firmsDetectionNaturalKey` semantics |
| `wire_items` | publisher item archive | headline/link only, mirroring the wire's content policy |
| `response_cache` | operational cache, not evidence | disposable at any time |

## Retention

`cron.sql` thins `source_snapshots` to one row per source per hour after
7 days and hard-drops after 60 days. `thermal_detections` and `wire_items`
are kept indefinitely (they are the incident record and grow slowly).
Steady-state growth is low tens of MB/week — comfortable on the free tier.

## Tests

`npm run test:db` runs the store suite against PGlite (in-process WASM
Postgres) using this exact `setup.sql`, so test DDL cannot drift from
production DDL. Requires Node ≥ 22.18 (native TS type stripping). Vercel
builds never run tests, so the runtime `engines` range is unchanged.

Optional: `npx skills add supabase/agent-skills` installs Supabase agent
skills for Claude-assisted work — team decision, not required.
