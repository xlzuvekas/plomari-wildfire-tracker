-- Bound the complete PostgREST transaction before any curated discovery RPC
-- begins. A function-local timeout starts too late and can be hoisted by
-- PostgREST, so the shared impersonated role is the authoritative boundary.
alter role firewatch_discovery_reader
  set statement_timeout = '4s';

-- The original Nearby projection carried a five-second function setting.
-- Remove it so PostgREST cannot hoist a weaker limit over the role boundary.
alter function api.nearby_incidents_v3(
  integer, integer, integer,
  timestamptz, timestamptz, timestamptz,
  text, integer
) reset statement_timeout;

-- Role configuration and function metadata use separate PostgREST caches.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
