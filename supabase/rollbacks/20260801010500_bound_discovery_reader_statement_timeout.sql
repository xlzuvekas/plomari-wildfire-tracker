-- Disable application exposure and drain discovery reads before applying this
-- rollback. It restores the exact pre-migration timeout configuration.
alter role firewatch_discovery_reader
  reset statement_timeout;

alter function api.nearby_incidents_v3(
  integer, integer, integer,
  timestamptz, timestamptz, timestamptz,
  text, integer
) set statement_timeout = '5s';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
