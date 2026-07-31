drop function if exists api.nearby_incidents_v3(
  integer, integer, integer, timestamptz, timestamptz, timestamptz,
  text, integer
);

drop function if exists truth.publication_gate_known_at(
  bigint, bigint, timestamptz
);

revoke usage on schema api from firewatch_discovery_reader;
revoke firewatch_discovery_reader from authenticator;
drop role if exists firewatch_discovery_reader;

notify pgrst, 'reload schema';
