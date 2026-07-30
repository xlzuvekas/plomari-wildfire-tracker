export const CONTRACT_VERSION = "1.0.0" as const;

export const sourceKinds = [
  "official_alert",
  "official_status",
  "official_context",
  "sensor",
  "measurement",
  "model",
  "public_broadcaster",
  "publisher",
  "field_report",
] as const;

export const authorityScopes = [
  "protective_instruction",
  "incident_status",
  "road_status",
  "thermal_anomaly",
  "weather_measurement",
  "weather_model",
  "satellite_imagery",
  "local_context",
] as const;

export const timePrecisions = ["exact", "date_only", "unknown"] as const;

export const ingestionStatuses = [
  "running",
  "success",
  "not_modified",
  "partial",
  "failed",
] as const;

export const validationStates = [
  "accepted",
  "quarantined",
  "rejected",
] as const;

export const validationReasonCodes = [
  "invalid_structure",
  "invalid_timestamp",
  "future_timestamp",
  "outside_incident_window",
  "invalid_geometry",
  "invalid_measurement",
  "unknown_source",
  "authority_scope_mismatch",
  "untrusted_protective_instruction",
  "publisher_cannot_issue_protective_action",
  "parser_schema_drift",
] as const;

export const assertionTypes = [
  "observation",
  "report",
  "model",
  "instruction",
  "interpretation",
] as const;

export const assertionStates = [
  "active",
  "superseded",
  "retracted",
  "disputed",
] as const;

export const extractionMethods = [
  "source_field",
  "deterministic_parser",
  "assistive_classifier",
  "analyst",
] as const;

export const relevanceMethods = [
  "exact_identifier",
  "geometry",
  "keyword",
  "analyst_link",
] as const;

export const observationTypes = [
  "protective_instruction",
  "official_status",
  "thermal_detection",
  "satellite_imagery",
  "modeled_weather",
  "measured_weather",
  "publisher_report",
  "road_report",
  "smoke_model",
  "response_report",
] as const;

export const eventTypes = [
  "protective_instruction",
  "official_status_transition",
  "thermal_detection",
  "thermal_pass",
  "road_condition",
  "settlement_threat",
  "smoke_observation",
  "weather_observation",
  "weather_model_change",
  "response_update",
  "source_correction",
] as const;

export const eventLifecycles = [
  "active",
  "superseded",
  "resolved",
  "retracted",
  "disputed",
] as const;

export const verificationStates = [
  "official",
  "corroborated",
  "single_source",
  "unverified",
  "contradicted",
] as const;

export const evidenceRelationships = [
  "supports",
  "updates",
  "contradicts",
  "retracts",
  "supersedes",
] as const;

export const materialityLevels = ["critical", "high", "medium", "low"] as const;

export const materialChangeTypes = [
  ...eventTypes,
  "source_stale",
  "all_sources_unavailable",
] as const;

export const sourceHealthStates = [
  "healthy",
  "stale",
  "failed",
  "rate_limited",
  "authentication_failed",
  "unconfigured",
  "disabled",
  "unknown",
] as const;

export const contentPolicies = [
  "structured_data",
  "official_content",
  "headline_link_excerpt",
  "derived_model",
] as const;

export const protectiveInstructionKinds = [
  "readiness",
  "evacuate",
  "shelter",
  "cancel",
  "all_clear",
] as const;

export const normalizedOfficialStatuses = [
  "in_progress",
  "partial_control",
  "full_control",
  "ended",
  "unknown",
] as const;

export const roadConditionStates = [
  "open",
  "closed",
  "restricted",
  "unknown",
] as const;

export const adapterNames = [
  "fire-service-board",
  "x-official-account",
  "rss-official-context",
  "rss-publisher",
  "firms-area-csv",
  "gibs-imagery-metadata",
  "open-meteo-forecast",
  "aviation-weather-metar",
] as const;

export const adapterFixtureScenarios = [
  "success",
  "zero_result",
  "correction",
  "malformed_time",
  "future_time",
  "partial_failure",
  "timeout",
  "authentication",
  "quota",
  "malformed_payload",
] as const;

export const errorClasses = [
  "timeout",
  "authentication",
  "rate_limit",
  "network",
  "upstream",
  "parser",
  "validation",
  "database",
] as const;

export const FIRMS_COORDINATE_IDENTITY_DECIMALS = 4;
export const FIRMS_PASS_GAP_MINUTES = 10;
export const DEFAULT_FUTURE_TOLERANCE_SECONDS = 300;
