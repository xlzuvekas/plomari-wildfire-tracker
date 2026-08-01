-- Exact rollback for the inert global candidate projection foundation.

revoke execute on function api.explore_candidate_cells_v3(
  timestamptz, timestamptz, timestamptz, integer, uuid, text, text,
  timestamptz, uuid
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher,
  anon, authenticated, service_role, firewatch_discovery_reader;

drop function if exists api.explore_candidate_cells_v3(
  timestamptz, timestamptz, timestamptz, integer, uuid, text, text,
  timestamptz, uuid
);

drop table if exists truth.global_candidate_projection_items;
drop table if exists truth.global_candidate_projection_runs;
drop table if exists truth.global_candidate_cells;

drop function if exists truth.validate_global_candidate_projection_item_insert();
drop function if exists truth.validate_global_candidate_cell_insert();
drop function if exists truth.global_candidate_signal_kinds_are_valid(text[]);
drop function if exists truth.global_candidate_semantic_key_v1(
  text, text, text, integer, integer, integer
);
drop function if exists truth.global_candidate_cell_key(
  integer, integer, integer
);
drop function if exists truth.global_candidate_cell_minimum_span_m(
  integer, integer
);

notify pgrst, 'reload schema';
