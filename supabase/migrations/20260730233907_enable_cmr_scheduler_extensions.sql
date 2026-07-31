-- Operational scheduler dependencies for the CMR Edge collector. Keep cron in
-- pg_catalog as required by pg_cron; keep network functions outside exposed
-- application schemas.
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
