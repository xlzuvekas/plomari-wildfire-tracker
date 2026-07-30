-- Plomari Wildfire Tracker — Supabase-side collection cron.
--
-- Paste AFTER setup.sql, and EDIT the origin below if the deployment URL
-- differs. Requires Supabase (pg_cron + pg_net are preinstalled extensions
-- there). cron.schedule() upserts by job name, so re-pasting is safe.
--
-- Why collect=1&ts=<epoch>: a plain GET could be served entirely by Vercel's
-- CDN cache (s-maxage) without invoking the function, so nothing would be
-- stored. Routes answer collect requests with Cache-Control: no-store, and
-- the ts= value defeats any intermediate cache keying.
--
-- If Vercel Deployment Protection is enabled for production, add
--   headers := jsonb_build_object('x-vercel-protection-bypass', '<secret>')
-- to each net.http_get call (see docs/db/README.md).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('firewatch-thermal', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://plomari-wildfire-tracker.vercel.app/api/thermal?collect=1&ts='
           || extract(epoch from now())::bigint,
    timeout_milliseconds := 25000);
$$);

select cron.schedule('firewatch-wind', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://plomari-wildfire-tracker.vercel.app/api/wind?collect=1&ts='
           || extract(epoch from now())::bigint,
    timeout_milliseconds := 25000);
$$);

select cron.schedule('firewatch-updates', '*/2 * * * *', $$
  select net.http_get(
    url := 'https://plomari-wildfire-tracker.vercel.app/api/updates?collect=1&ts='
           || extract(epoch from now())::bigint,
    timeout_milliseconds := 25000);
$$);

-- Retention: after 7 days keep one snapshot per source per hour; hard-drop
-- rows older than 60 days. response_cache/thermal_detections/wire_items are
-- bounded by design and are not pruned here.
select cron.schedule('firewatch-prune', '17 3 * * *', $$
  delete from source_snapshots s
   where s.fetched_at < now() - interval '7 days'
     and s.id not in (
       select distinct on (source, date_trunc('hour', fetched_at)) id
         from source_snapshots
        where fetched_at < now() - interval '7 days'
        order by source, date_trunc('hour', fetched_at), fetched_at desc);
  delete from source_snapshots where fetched_at < now() - interval '60 days';
$$);

-- Teardown (if ever needed):
--   select cron.unschedule('firewatch-thermal');
--   select cron.unschedule('firewatch-wind');
--   select cron.unschedule('firewatch-updates');
--   select cron.unschedule('firewatch-prune');
