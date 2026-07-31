export type SatellitePassPresentationState =
  | "current-only-withheld"
  | "loading"
  | "unavailable"
  | "stale-valid-empty"
  | "stale"
  | "valid-empty"
  | "indeterminate-empty"
  | "footprints";

/**
 * Orders safety-relevant catalog states for presentation. In particular, an
 * old valid-empty snapshot must remain stale first; it cannot be restated as
 * a current no-intersection result after refresh has failed.
 */
export function satellitePassPresentationState(input: Readonly<{
  isLive: boolean;
  loading: boolean;
  unavailable: boolean;
  stale: boolean;
  validEmpty: boolean;
  indeterminateEmpty: boolean;
}>): SatellitePassPresentationState {
  if (!input.isLive) return "current-only-withheld";
  if (input.loading) return "loading";
  if (input.unavailable) return "unavailable";
  if (input.stale && input.validEmpty) return "stale-valid-empty";
  if (input.stale) return "stale";
  if (input.validEmpty) return "valid-empty";
  if (input.indeterminateEmpty) return "indeterminate-empty";
  return "footprints";
}
