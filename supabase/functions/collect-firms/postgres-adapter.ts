import type {
  HttpExchangeReference,
  HttpRequestEvidence,
  HttpResponseEvidence,
  HttpResponseOccurrence,
  HttpTransportErrorEvidence,
} from "../../../lib/evidence/recorded-fetch.ts";
import {
  FIRMS_SHADOW_PRODUCTS,
  serializeFirmsDetection,
  serializeFirmsRejection,
  type FirmsShadowFailureCode,
  type FirmsShadowPersistence,
  type FirmsShadowPlan,
  type FirmsShadowProductSummary,
  type FirmsShadowReservation,
  type FirmsShadowSummary,
} from "../../../lib/satellite/firms-collector.server.ts";
import type {
  FirmsDetection,
  FirmsParseResult,
  FirmsProduct,
} from "../../../lib/satellite/firms.ts";
import type {
  CollectorDatabase,
  DatabaseRow,
  DatabaseSession,
} from "./database.ts";
import { requireSingleRow } from "./database.ts";
import { canonicalJson, sha256Hex, uuidV7 } from "./identifiers.ts";

const LEASE_SECONDS = 150;
const SCHEMA_VERSION = "firms-area-csv-shadow-v1";

const REQUEST_PARAMS = Object.freeze({
  dateRequestMode: "explicit_starting_on",
  dayRangeMaximum: 5,
  maximumAreaSquareDegrees: 100,
  maximumLatitudeSpanDegrees: 10,
  maximumLongitudeSpanDegrees: 10,
  maximumResponseBytesPerProduct: 2_000_000,
  maximumTotalResponseBytes: 8_000_000,
  products: FIRMS_SHADOW_PRODUCTS,
  requestTimeoutMs: 15_000,
  responseFormat: "csv",
});

const CAPABILITIES = Object.freeze({
  collection: "shadow",
  credentialPersistence: "forbidden",
  dateRequestMode: "explicit_starting_on",
  negativeAssessment: false,
  products: FIRMS_SHADOW_PRODUCTS,
  responseFormat: "csv",
  sensorAssessability: "unknown",
});

const CONFIG_SCHEMA = Object.freeze({
  additionalProperties: false,
  required: Object.freeze(["area", "dateFrom", "dayCount"]),
  type: "object",
});

const DETAIL_LIMITATIONS = Object.freeze([
  "thermal_pixel_not_flame_location",
  "not_incident_confirmation",
  "pixel_orientation_not_source_supplied",
  "modeled_support_is_not_pixel_footprint",
  "source_time_precision_minute",
  "not_official_status",
  "not_protective_guidance",
  "not_all_clear",
]);

const COMPLETION_LIMITATIONS = Object.freeze([
  "requested_bbox_is_not_satellite_coverage",
  "sensor_assessability_unknown",
  "empty_response_is_not_all_clear",
  "cmr_catalog_metadata_does_not_assess_anomalies",
  "not_official_status",
  "not_protective_guidance",
  "not_incident_resolution",
]);

type CatalogContext = Readonly<{
  sourceId: string;
  endpointId: string;
  targetId: string;
  targetRevisionId: string;
  adapterReleaseId: string;
  adapterVersion: string;
  cursorState: Readonly<Record<string, unknown>>;
}>;

type ExecutionContext = CatalogContext & Readonly<{
  collectionId: string;
  jobId: string;
  runId: string;
  leaseToken: string;
  workerId: string;
  plan: FirmsShadowPlan;
}>;

type CatalogRow = DatabaseRow & {
  runtime_role: string;
  has_collector_capability: boolean;
  runtime_superuser: boolean;
  runtime_bypasses_rls: boolean;
  runtime_inherits: boolean;
  runtime_createdb: boolean;
  runtime_createrole: boolean;
  runtime_replication: boolean;
  member_of_postgres: boolean;
  member_of_service_role: boolean;
  member_of_authenticator: boolean;
  member_of_catalog_admin: boolean;
  member_of_reconciler: boolean;
  member_of_publisher: boolean;
  member_of_dispatcher: boolean;
  direct_memberships: unknown;
  effective_memberships: unknown;
  collector_memberships: unknown;
  source_id: string | number | bigint;
  endpoint_id: string | number | bigint;
  target_id: string | number | bigint;
  target_revision_id: string | number | bigint;
  adapter_release_id: string | number | bigint;
  adapter_version: string;
  cursor_state: unknown;
};

type ExchangeState = Readonly<{
  reference: HttpExchangeReference;
  product: FirmsProduct;
  occurrence: HttpResponseOccurrence | null;
}>;

function stringId(value: string | number | bigint, name: string) {
  const result = String(value);
  if (!/^\d+$/u.test(result)) throw new Error(`Invalid database ${name}.`);
  return result;
}

function canonicalTimestamp(value: string | Date, name: string) {
  const result = value instanceof Date ? value.toISOString() : value;
  const time = Date.parse(result);
  if (!Number.isFinite(time)) throw new Error(`Invalid database ${name}.`);
  return new Date(time).toISOString();
}

function objectValue(value: unknown, name: string) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid database ${name}.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactRoleSet(value: unknown, expected: readonly string[]) {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}

function jsonParameter(value: unknown) {
  return JSON.parse(canonicalJson(value)) as unknown;
}

function safeWorkerId() {
  return `firms-edge-${uuidV7()}`;
}

function executionFor(
  current: ExecutionContext | null,
  collectionId?: string,
) {
  if (
    current === null ||
    (collectionId !== undefined && current.collectionId !== collectionId)
  ) {
    throw new Error("The FIRMS collection does not own an active execution.");
  }
  return current;
}

function productFromRequest(request: HttpRequestEvidence): FirmsProduct {
  const product = request.requestMetadataSafe.product;
  if (
    typeof product !== "string" ||
    !FIRMS_SHADOW_PRODUCTS.includes(product as FirmsProduct)
  ) {
    throw new FirmsCollectorDatabaseError("The FIRMS request product is invalid.");
  }
  return product as FirmsProduct;
}

function failureClass(code: FirmsShadowFailureCode) {
  switch (code) {
    case "deadline":
    case "timeout":
      return "timeout";
    case "network":
      return "network";
    case "upstream":
      return "upstream";
    case "parser":
      return "parser";
    case "database":
      return "database";
    case "response_too_large":
    case "validation":
      return "validation";
  }
}

function coarseRejectionCode(reasons: readonly string[]) {
  if (reasons.includes("identity-collision")) return "identity_collision";
  if (reasons.includes("column-count-mismatch")) return "invalid_column_count";
  if (reasons.includes("invalid-acquisition-time")) return "invalid_timestamp";
  if (reasons.includes("invalid-coordinate")) return "invalid_coordinate";
  if (reasons.includes("invalid-measurement")) return "invalid_measurement";
  if (reasons.includes("invalid-confidence")) return "invalid_confidence";
  if (
    reasons.includes("satellite-mismatch") ||
    reasons.includes("instrument-mismatch")
  ) return "invalid_product_platform";
  if (
    reasons.includes("outside-request-area") ||
    reasons.includes("outside-request-date-range")
  ) return "provenance_mismatch";
  return "unsupported_schema";
}

function exactScale(value: number, decimals: number) {
  return Number.isFinite(value) && Number(value.toFixed(decimals)) === value;
}

function detectionFitsPersistenceContract(detection: FirmsDetection) {
  const brightnessPrimary = detection.product === "MODIS_NRT"
    ? detection.brightnessKelvin
    : detection.brightTi4Kelvin;
  const brightnessSecondary = detection.product === "MODIS_NRT"
    ? detection.brightT31Kelvin
    : detection.brightTi5Kelvin;
  return exactScale(detection.latitude, 6) &&
    exactScale(detection.longitude, 6) &&
    exactScale(detection.scanKm, 3) && detection.scanKm <= 20 &&
    exactScale(detection.trackKm, 3) && detection.trackKm <= 20 &&
    exactScale(detection.frpMw, 3) && detection.frpMw <= 999_999_999.999 &&
    exactScale(brightnessPrimary, 2) &&
    brightnessPrimary >= 100 && brightnessPrimary <= 1_000 &&
    exactScale(brightnessSecondary, 2) &&
    brightnessSecondary >= 100 && brightnessSecondary <= 1_000 &&
    detection.satelliteRaw.length <= 32 && detection.version.length <= 128;
}

export class FirmsCollectorDatabaseError extends Error {
  constructor(message = "The FIRMS collector database rejected the operation.") {
    super(message);
    this.name = "FirmsCollectorDatabaseError";
  }
}

export class PostgresFirmsAdapter implements FirmsShadowPersistence {
  private execution: ExecutionContext | null = null;
  private requestNo = 0;
  private readonly exchanges = new Map<FirmsProduct, ExchangeState>();

  constructor(
    private readonly database: CollectorDatabase,
    private readonly clockMs: () => number = Date.now,
  ) {}

  private requireLeastPrivilegedRuntime(row: CatalogRow) {
    if (
      row.runtime_role !== "firewatch_firms_collector_runtime" ||
      !row.has_collector_capability ||
      row.runtime_superuser ||
      row.runtime_bypasses_rls ||
      !row.runtime_inherits ||
      row.runtime_createdb ||
      row.runtime_createrole ||
      row.runtime_replication ||
      row.member_of_postgres ||
      row.member_of_service_role ||
      row.member_of_authenticator ||
      row.member_of_catalog_admin ||
      row.member_of_reconciler ||
      row.member_of_publisher ||
      row.member_of_dispatcher ||
      !exactRoleSet(row.direct_memberships, ["firewatch_collector"]) ||
      !exactRoleSet(row.effective_memberships, ["anon", "firewatch_collector"]) ||
      !exactRoleSet(row.collector_memberships, ["anon"])
    ) {
      throw new FirmsCollectorDatabaseError(
        "The FIRMS collector is not using its least-privileged login.",
      );
    }
  }

  async assertRuntimeIdentity() {
    const row = requireSingleRow(
      await this.database.query<CatalogRow>(this.identitySql()),
      "The FIRMS runtime database identity did not resolve.",
    );
    this.requireLeastPrivilegedRuntime(row);
  }

  private identitySql() {
    return `select
      current_user as runtime_role,
      pg_has_role(current_user, 'firewatch_collector', 'member')
        as has_collector_capability,
      role.rolsuper as runtime_superuser,
      role.rolbypassrls as runtime_bypasses_rls,
      role.rolinherit as runtime_inherits,
      role.rolcreatedb as runtime_createdb,
      role.rolcreaterole as runtime_createrole,
      role.rolreplication as runtime_replication,
      pg_has_role(current_user, 'postgres', 'member') as member_of_postgres,
      pg_has_role(current_user, 'service_role', 'member') as member_of_service_role,
      pg_has_role(current_user, 'authenticator', 'member') as member_of_authenticator,
      pg_has_role(current_user, 'firewatch_catalog_admin', 'member') as member_of_catalog_admin,
      pg_has_role(current_user, 'firewatch_reconciler', 'member') as member_of_reconciler,
      pg_has_role(current_user, 'firewatch_publisher', 'member') as member_of_publisher,
      pg_has_role(current_user, 'firewatch_dispatcher', 'member') as member_of_dispatcher,
      to_jsonb(array(
        select granted.rolname from pg_catalog.pg_auth_members as membership
        join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
        where membership.member = role.oid order by granted.rolname
      )) as direct_memberships,
      to_jsonb(array(
        select inherited.rolname from pg_catalog.pg_roles as inherited
        where inherited.rolname <> current_user
          and pg_has_role(current_user, inherited.oid, 'member')
        order by inherited.rolname
      )) as effective_memberships,
      to_jsonb(array(
        select granted.rolname from pg_catalog.pg_auth_members as membership
        join pg_catalog.pg_roles as granted on granted.oid = membership.roleid
        where membership.member = (
          select collector.oid from pg_catalog.pg_roles as collector
          where collector.rolname = 'firewatch_collector'
        ) order by granted.rolname
      )) as collector_memberships
    from pg_catalog.pg_roles as role where role.rolname = current_user`;
  }

  private async catalogContext(session: DatabaseSession): Promise<CatalogContext> {
    const rows = await session.query<CatalogRow>(
      `select identity.*,
         source.id as source_id, endpoint.id as endpoint_id,
         target.id as target_id, revision.id as target_revision_id,
         adapter.id as adapter_release_id, adapter.version_label as adapter_version,
         target_state.cursor_state
       from (${this.identitySql()}) as identity
       cross join core.sources as source
       join core.endpoints as endpoint on endpoint.source_id = source.id
       join ingest.endpoint_state as endpoint_state on endpoint_state.endpoint_id = endpoint.id
       join core.collection_targets as target
         on target.source_id = source.id and target.endpoint_id = endpoint.id
       join core.collection_target_revisions as revision
         on revision.collection_target_id = target.id and revision.endpoint_id = endpoint.id
       join ingest.collection_target_state as target_state
         on target_state.collection_target_revision_id = revision.id
        and target_state.collection_target_id = target.id
       join core.adapter_releases as adapter on adapter.source_id = source.id
       join ingest.adapter_release_state as adapter_state
         on adapter_state.adapter_release_id = adapter.id
       where source.slug = 'nasa-firms'
         and source.enabled and source.license_status = 'approved'
         and source.commercial_use_allowed is true
         and source.redistribution_allowed is true
         and endpoint.endpoint_key = 'area-csv'
         and endpoint.base_url = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'
         and endpoint.http_method = 'GET' and endpoint.auth_mode = 'path_secret'
         and endpoint.credential_ref = 'FIRMS_MAP_KEY'
         and endpoint_state.enabled and endpoint_state.paused_reason is null
         and target.target_key = 'global-discovery' and target.visibility = 'restricted'
         and target.enabled
         and revision.version_no >= 2 and revision.enabled
         and revision.effective_at <= now()
         and revision.request_params = $1::jsonb
         and adapter.release_no = 1 and adapter.schema_version = $2
         and adapter.capabilities = $3::jsonb
         and adapter.config_schema = $4::jsonb
         and adapter_state.enabled and adapter_state.retired_at is null
         and (select count(*) from core.firms_products as product
              where product.source_id = source.id
                and product.enabled and product.license_status = 'approved'
                and not product.assessment_enabled) = 4
         and not exists (
           select 1 from core.collection_target_revisions as newer
           where newer.collection_target_id = revision.collection_target_id
             and newer.effective_at <= now()
             and (newer.effective_at > revision.effective_at or
               (newer.effective_at = revision.effective_at
                and newer.version_no > revision.version_no))
         )
         and not exists (
           select 1 from core.adapter_releases as newer_adapter
           join ingest.adapter_release_state as newer_state
             on newer_state.adapter_release_id = newer_adapter.id
           where newer_adapter.source_id = adapter.source_id
             and newer_adapter.release_no > adapter.release_no
             and newer_state.enabled and newer_state.retired_at is null
         )`,
      [
        jsonParameter(REQUEST_PARAMS),
        SCHEMA_VERSION,
        jsonParameter(CAPABILITIES),
        jsonParameter(CONFIG_SCHEMA),
      ],
    );
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new FirmsCollectorDatabaseError(
        "The FIRMS collector catalog is disabled, incomplete, or ambiguous.",
      );
    }
    const row = rows[0];
    this.requireLeastPrivilegedRuntime(row);
    return Object.freeze({
      sourceId: stringId(row.source_id, "source id"),
      endpointId: stringId(row.endpoint_id, "endpoint id"),
      targetId: stringId(row.target_id, "target id"),
      targetRevisionId: stringId(row.target_revision_id, "target revision id"),
      adapterReleaseId: stringId(row.adapter_release_id, "adapter release id"),
      adapterVersion: row.adapter_version,
      cursorState: objectValue(row.cursor_state, "cursor state"),
    });
  }

  async reapExpiredExecution(): Promise<boolean> {
    const row = requireSingleRow(
      await this.database.query<DatabaseRow & {
        reaped_run_id: string | number | bigint | null;
      }>(
        `select ingest.reap_expired_firms_collection_job(
           $1::core.uuid_v7
         ) as reaped_run_id`,
        [uuidV7(this.clockMs())],
      ),
      "The FIRMS expired-execution reaper did not return a result.",
    );
    return row.reaped_run_id !== null;
  }

  async reserveCollection(plan: FirmsShadowPlan): Promise<FirmsShadowReservation> {
    return this.database.transaction(async (session) => {
      const catalog = await this.catalogContext(session);
      const workerId = safeWorkerId();
      const jobKey = `firms-shadow:${plan.planKey}`;
      await session.query(
        `insert into ingest.jobs (
           public_id, contract_version, source_id, endpoint_id,
           collection_target_id, collection_target_revision_id,
           adapter_release_id, idempotency_key, priority, scheduled_for,
           available_at, max_attempts, input
         ) values (
           $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint,
           $4::bigint, $5::bigint, $6::bigint, $7, 800,
           $8::timestamptz, now(), 3, $9::jsonb
         ) on conflict (idempotency_key) do nothing`,
        [
          uuidV7(this.clockMs()), catalog.sourceId, catalog.endpointId,
          catalog.targetId, catalog.targetRevisionId, catalog.adapterReleaseId,
          jobKey, plan.scheduledFor,
          jsonParameter({ collector: "firms_shadow", plan }),
        ],
      );
      const job = requireSingleRow(
        await session.query<DatabaseRow & {
          id: string | number | bigint;
          status: string;
          attempt_count: number;
          lease_token: string | null;
          lease_owner: string | null;
        }>(
          `select id, status, attempt_count, lease_token, lease_owner
           from ingest.jobs
           where idempotency_key = $1 and source_id = $2::bigint
             and endpoint_id = $3::bigint and collection_target_id = $4::bigint
             and collection_target_revision_id = $5::bigint
             and adapter_release_id = $6::bigint and input = $7::jsonb`,
          [
            jobKey, catalog.sourceId, catalog.endpointId, catalog.targetId,
            catalog.targetRevisionId, catalog.adapterReleaseId,
            jsonParameter({ collector: "firms_shadow", plan }),
          ],
        ),
        "The FIRMS collection job identity did not resolve.",
      );
      const jobId = stringId(job.id, "job id");
      if (job.status === "succeeded") {
        return this.completedReservation(session, jobId, plan);
      }
      if (job.status === "running") return Object.freeze({ state: "busy" });
      if (job.status !== "pending" && job.status !== "retry") {
        throw new FirmsCollectorDatabaseError(
          "The deterministic FIRMS collection slot previously failed closed.",
        );
      }
      const claimedRows = await session.query<DatabaseRow & {
        lease_token: string | null;
        lease_owner: string | null;
        attempt_count: number;
      }>(
        `select * from ingest.claim_firms_collection_job_exact(
           $1::bigint, $2, make_interval(secs => $3::integer)
         )`,
        [jobId, workerId, LEASE_SECONDS],
      );
      if (claimedRows.length === 0) return Object.freeze({ state: "busy" });
      const claimed = requireSingleRow(
        claimedRows,
        "The FIRMS exact-claim function returned multiple jobs.",
      );
      if (claimed.lease_token === null || claimed.lease_owner !== workerId) {
        throw new FirmsCollectorDatabaseError();
      }
      const collectionId = uuidV7(this.clockMs());
      const run = requireSingleRow(
        await session.query<DatabaseRow & { id: string | number | bigint; public_id: string }>(
          `insert into ingest.runs (
             public_id, contract_version, job_id, source_id, endpoint_id,
             collection_target_id, collection_target_revision_id,
             adapter_release_id, lease_token, lease_owner, attempt_no,
             collector_version, cursor_before, request_meta
           ) values (
             $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint, $4::bigint,
             $5::bigint, $6::bigint, $7::bigint, $8::uuid, $9, $10,
             $11, $12::jsonb, $13::jsonb
           ) returning id, public_id::uuid::text as public_id`,
          [
            collectionId, jobId, catalog.sourceId, catalog.endpointId,
            catalog.targetId, catalog.targetRevisionId, catalog.adapterReleaseId,
            claimed.lease_token, workerId, claimed.attempt_count,
            catalog.adapterVersion, jsonParameter(catalog.cursorState),
            jsonParameter({ operation: "firms_area_csv_shadow", scope: "bounded_area" }),
          ],
        ),
        "The FIRMS ingestion run was not created.",
      );
      this.execution = Object.freeze({
        ...catalog,
        collectionId: run.public_id,
        jobId,
        runId: stringId(run.id, "run id"),
        leaseToken: claimed.lease_token,
        workerId,
        plan,
      });
      this.requestNo = 0;
      this.exchanges.clear();
      return Object.freeze({ state: "execute", collectionId: run.public_id });
    });
  }

  private async completedReservation(
    session: DatabaseSession,
    jobId: string,
    plan: FirmsShadowPlan,
  ): Promise<FirmsShadowReservation> {
    const row = requireSingleRow(
      await session.query<DatabaseRow & { details: unknown }>(
        `select health.details from ingest.runs as run
         join truth.source_health as health on health.run_id = run.id
         join ingest.firms_query_completions as completion
           on completion.health_cursor = health.cursor
         where run.job_id = $1::bigint and run.status = 'success'`,
        [jobId],
      ),
      "A completed FIRMS job is missing its durable completion summary.",
    );
    const summary = objectValue(row.details, "completion details").firms_summary;
    if (
      summary === null || typeof summary !== "object" || Array.isArray(summary) ||
      (summary as { status?: unknown }).status !== "complete" ||
      canonicalJson((summary as { plan?: unknown }).plan) !== canonicalJson(plan)
    ) {
      throw new FirmsCollectorDatabaseError(
        "A completed FIRMS job has no matching reconstructible summary.",
      );
    }
    return Object.freeze({
      state: "already-complete",
      summary: summary as FirmsShadowSummary,
    });
  }

  async heartbeatCollection(input: Readonly<{
    collectionId: string;
    plan: FirmsShadowPlan;
  }>): Promise<void> {
    const execution = executionFor(this.execution, input.collectionId);
    if (canonicalJson(input.plan) !== canonicalJson(execution.plan)) {
      throw new FirmsCollectorDatabaseError("The FIRMS heartbeat plan changed.");
    }
    const row = requireSingleRow(
      await this.database.query<DatabaseRow & { renewed: boolean }>(
        `select ingest.heartbeat_collection_job(
           $1::bigint, $2::uuid, $3, make_interval(secs => $4::integer)
         ) as renewed`,
        [execution.jobId, execution.leaseToken, execution.workerId, LEASE_SECONDS],
      ),
      "The FIRMS lease heartbeat did not return a result.",
    );
    if (row.renewed !== true) {
      throw new FirmsCollectorDatabaseError("The FIRMS collector lease was lost.");
    }
  }

  async issue(request: HttpRequestEvidence): Promise<HttpExchangeReference> {
    const execution = executionFor(this.execution);
    const product = productFromRequest(request);
    if (this.exchanges.has(product)) {
      throw new FirmsCollectorDatabaseError("A FIRMS product was issued twice.");
    }
    this.requestNo += 1;
    const fingerprint = await sha256Hex(canonicalJson({
      method: request.method,
      url: request.requestUrlSafe,
      query: request.requestQuerySafe,
      headers: request.requestHeadersSafe,
      metadata: request.requestMetadataSafe,
      body: null,
    }));
    const row = requireSingleRow(
      await this.database.query<DatabaseRow & {
        id: string | number | bigint;
        run_id: string | number | bigint;
      }>(
        `insert into ingest.http_exchanges (
           public_id, contract_version, run_id, source_id, endpoint_id,
           request_no, idempotency_key, request_method, request_url_redacted,
           request_query_safe, request_fingerprint_sha256,
           request_headers_safe, request_metadata_safe
         ) values (
           $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint, $4::bigint,
           $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb
         ) returning id, run_id`,
        [
          uuidV7(this.clockMs()), execution.runId, execution.sourceId,
          execution.endpointId, this.requestNo,
          `firms-http:${execution.runId}:${this.requestNo}`,
          request.method, request.requestUrlSafe,
          jsonParameter(request.requestQuerySafe), fingerprint,
          jsonParameter(request.requestHeadersSafe),
          jsonParameter(request.requestMetadataSafe),
        ],
      ),
      "The FIRMS HTTP exchange was not issued.",
    );
    const reference = Object.freeze({
      exchangeId: stringId(row.id, "HTTP exchange id"),
      runId: stringId(row.run_id, "HTTP exchange run id"),
    });
    this.exchanges.set(product, Object.freeze({ reference, product, occurrence: null }));
    return reference;
  }

  private exchangeReference(reference: HttpExchangeReference) {
    const execution = executionFor(this.execution);
    if (!/^\d+$/u.test(reference.exchangeId) || reference.runId !== execution.runId) {
      throw new FirmsCollectorDatabaseError(
        "The HTTP exchange does not belong to this FIRMS run.",
      );
    }
    return reference.exchangeId;
  }

  private exchangeProduct(reference: HttpExchangeReference) {
    for (const [product, exchange] of this.exchanges) {
      if (exchange.reference.exchangeId === reference.exchangeId) return product;
    }
    throw new FirmsCollectorDatabaseError("The FIRMS HTTP exchange is unknown.");
  }

  async finishResponse(
    reference: HttpExchangeReference,
    response: HttpResponseEvidence,
  ): Promise<HttpResponseOccurrence> {
    const execution = executionFor(this.execution);
    const exchangeId = this.exchangeReference(reference);
    const product = this.exchangeProduct(reference);
    const digest = await sha256Hex(response.body);
    const occurrence = await this.database.transaction(async (session) => {
      await session.query(
        `insert into ingest.content_blobs (
           public_id, contract_version, identity_version, content_sha256,
           content_type, content_encoding, byte_size, inline_bytes
         ) values (
           $1::core.uuid_v7, '1.1.0', '2.0.0', $2, $3, null,
           $4::bigint, $5::bytea
         ) on conflict (content_sha256) do nothing`,
        [
          uuidV7(this.clockMs()), digest,
          response.safeHeaders["content-type"] ?? "application/octet-stream",
          response.body.byteLength, response.body,
        ],
      );
      const blob = requireSingleRow(
        await session.query<DatabaseRow & {
          id: string | number | bigint;
          byte_size: string | number | bigint;
        }>(
          `select id, byte_size from ingest.content_blobs
           where content_sha256 = $1
             and representation_kind in ('inline_bytes', 'storage_object')`,
          [digest],
        ),
        "The exact FIRMS response content blob did not resolve.",
      );
      if (stringId(blob.byte_size, "blob byte size") !== String(response.body.byteLength)) {
        throw new FirmsCollectorDatabaseError("The FIRMS response digest size disagreed.");
      }
      const raw = requireSingleRow(
        await session.query<DatabaseRow & {
          id: string | number | bigint;
          retrieved_at: string | Date;
        }>(
          `insert into ingest.raw_objects (
             public_id, contract_version, source_id, endpoint_id, run_id,
             blob_id, content_sha256, idempotency_key, retrieved_at,
             metadata, http_exchange_id
           ) values (
             $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint, $4::bigint,
             $5::bigint, $6, $7, now(), '{}'::jsonb, $8::bigint
           ) returning id, retrieved_at`,
          [
            uuidV7(this.clockMs()), execution.sourceId, execution.endpointId,
            execution.runId, stringId(blob.id, "blob id"), digest,
            `firms-raw:${execution.runId}:${exchangeId}`, exchangeId,
          ],
        ),
        "The exact FIRMS raw response was not inserted.",
      );
      const finished = requireSingleRow(
        await session.query<DatabaseRow & { finished: boolean }>(
          `select ingest.finish_http_exchange(
             $1::bigint, $2::bigint, $3::uuid, $4,
             'response', $5::smallint, $6::bigint,
             $7::jsonb, null, null, $8::jsonb
           ) as finished`,
          [
            exchangeId, execution.runId, execution.leaseToken,
            execution.workerId, response.status, stringId(raw.id, "raw object id"),
            jsonParameter(response.safeHeaders), jsonParameter(response.safeMetadata),
          ],
        ),
        "The FIRMS HTTP response terminalization did not return a result.",
      );
      if (finished.finished !== true) {
        throw new FirmsCollectorDatabaseError(
          "The FIRMS HTTP response was not terminalized.",
        );
      }
      return Object.freeze({
        rawObjectId: stringId(raw.id, "raw object id"),
        httpExchangeId: exchangeId,
        runId: execution.runId,
        contentSha256: digest,
        retrievedAt: canonicalTimestamp(raw.retrieved_at, "retrieval time"),
      });
    });
    this.exchanges.set(product, Object.freeze({ reference, product, occurrence }));
    return occurrence;
  }

  async finishTransportError(
    reference: HttpExchangeReference,
    error: HttpTransportErrorEvidence,
  ): Promise<void> {
    const execution = executionFor(this.execution);
    const exchangeId = this.exchangeReference(reference);
    const finished = requireSingleRow(
      await this.database.query<DatabaseRow & { finished: boolean }>(
        `select ingest.finish_http_exchange(
           $1::bigint, $2::bigint, $3::uuid, $4,
           'transport_error', null, null, '{}'::jsonb,
           $5, $6, $7::jsonb
         ) as finished`,
        [
          exchangeId, execution.runId, execution.leaseToken, execution.workerId,
          error.errorClass, error.errorDetailSafe, jsonParameter(error.safeMetadata),
        ],
      ),
      "The FIRMS transport error terminalization did not return a result.",
    );
    if (finished.finished !== true) {
      throw new FirmsCollectorDatabaseError(
        "The FIRMS transport error was not terminalized.",
      );
    }
  }

  private productExchange(product: FirmsProduct) {
    const exchange = this.exchanges.get(product);
    if (exchange === undefined) {
      throw new FirmsCollectorDatabaseError("The FIRMS product was not issued.");
    }
    return exchange;
  }

  private async normalizedDetection(detection: FirmsDetection) {
    const canonicalData = {
      acquiredAt: detection.observedAt,
      brightnessContract: detection.product === "MODIS_NRT"
        ? "modis_brightness_t31"
        : "viirs_bright_ti4_ti5",
      brightnessPrimaryK: detection.product === "MODIS_NRT"
        ? detection.brightnessKelvin
        : detection.brightTi4Kelvin,
      brightnessSecondaryK: detection.product === "MODIS_NRT"
        ? detection.brightT31Kelvin
        : detection.brightTi5Kelvin,
      confidenceClass: detection.product === "MODIS_NRT"
        ? null
        : detection.confidenceCode,
      confidencePercent: detection.product === "MODIS_NRT"
        ? detection.confidencePercent
        : null,
      dayNight: detection.dayNight,
      frpMw: detection.frpMw,
      instrument: detection.instrument,
      latitude: detection.latitude,
      longitude: detection.longitude,
      product: detection.product,
      satellite: detection.satellite,
      scanKm: detection.scanKm,
      sourceDatasetVersion: detection.version,
      sourceSatelliteRaw: detection.satelliteRaw,
      trackKm: detection.trackKm,
    } as const;
    const epoch = Date.parse(detection.observedAt) / 1000;
    if (!Number.isFinite(epoch)) {
      throw new FirmsCollectorDatabaseError("The FIRMS acquisition time is invalid.");
    }
    const identity = await sha256Hex([
      "firms-detection-v1", detection.product, detection.satellite,
      epoch.toFixed(6), detection.latitude.toFixed(6),
      detection.longitude.toFixed(6),
    ].join("|"));
    const contentSha256 = await sha256Hex(canonicalJson(canonicalData));
    const serialized = serializeFirmsDetection(detection, {
      sourceRevisionPublicId: uuidV7(this.clockMs()),
      observationPublicId: uuidV7(this.clockMs()),
      detailPublicId: uuidV7(this.clockMs()),
    });
    return Object.freeze({
      ...serialized,
      detection_identity_sha256: identity,
      normalized_content_sha256: contentSha256,
      source_record_key: `firms:${identity}`,
      source_revision_idempotency_key: `firms-source:${identity}:${contentSha256}`,
      observation_idempotency_key: `firms-observation:${identity}:${contentSha256}`,
      canonical_data: canonicalData,
      raw_payload: Object.freeze({
        itemIndex: detection.itemIndex,
        product: detection.product,
        rowNumber: detection.rowNumber,
        schema: serialized.source_row_contract,
      }),
      row_fingerprint_sha256: await sha256Hex(canonicalJson({
        itemIndex: detection.itemIndex,
        rowNumber: detection.rowNumber,
        canonicalData,
      })),
    });
  }

  private async responseContext(
    session: DatabaseSession,
    execution: ExecutionContext,
    product: FirmsProduct,
    exchange: ExchangeState,
  ) {
    const row = requireSingleRow(
      await session.query<DatabaseRow & {
        product_id: string | number | bigint;
        parser_contract: string;
        exchange_outcome: string;
        http_status: number | null;
        completed_at: string | Date;
        request_fingerprint_sha256: string;
        issued_at: string;
        response_raw_object_id: string | number | bigint | null;
        response_content_sha256: string | null;
        response_retrieved_at: string | Date | null;
      }>(
        `select
           product.id as product_id, product.parser_contract,
           exchange.outcome as exchange_outcome, exchange.http_status,
           exchange.completed_at, exchange.request_fingerprint_sha256,
           exchange.request_metadata_safe->>'issued_at' as issued_at,
           exchange.response_raw_object_id,
           raw.content_sha256 as response_content_sha256,
           raw.retrieved_at as response_retrieved_at
         from ingest.http_exchanges as exchange
         join core.firms_products as product
           on product.source_id = exchange.source_id
          and product.product_key = $5
         left join ingest.raw_objects as raw
           on raw.id = exchange.response_raw_object_id
          and raw.http_exchange_id = exchange.id
          and raw.run_id = exchange.run_id
          and raw.source_id = exchange.source_id
          and raw.endpoint_id = exchange.endpoint_id
         where exchange.id = $1::bigint and exchange.run_id = $2::bigint
           and exchange.source_id = $3::bigint and exchange.endpoint_id = $4::bigint
           and exchange.request_query_safe->>'product' = $5
           and exchange.outcome <> 'pending'`,
        [
          exchange.reference.exchangeId, execution.runId, execution.sourceId,
          execution.endpointId, product,
        ],
      ),
      "The FIRMS product is not backed by one terminal exchange.",
    );
    const completedAt = canonicalTimestamp(row.completed_at, "exchange completion time");
    const retrievedAt = row.response_retrieved_at === null
      ? null
      : canonicalTimestamp(row.response_retrieved_at, "response retrieval time");
    if (exchange.occurrence !== null && (
      row.response_raw_object_id === null ||
      stringId(row.response_raw_object_id, "raw object id") !==
        exchange.occurrence.rawObjectId ||
      row.response_content_sha256 !== exchange.occurrence.contentSha256 ||
      retrievedAt !== exchange.occurrence.retrievedAt
    )) {
      throw new FirmsCollectorDatabaseError(
        "The FIRMS response occurrence changed before parsing.",
      );
    }
    return Object.freeze({
      productId: stringId(row.product_id, "product id"),
      parserContract: row.parser_contract,
      exchangeOutcome: row.exchange_outcome,
      httpStatus: row.http_status,
      completedAt,
      issuedAt: canonicalTimestamp(row.issued_at, "request issue time"),
      requestFingerprintSha256: row.request_fingerprint_sha256,
      rawObjectId: row.response_raw_object_id === null
        ? null
        : stringId(row.response_raw_object_id, "raw object id"),
      responseContentSha256: row.response_content_sha256,
      retrievedAt,
    });
  }

  async persistProduct(input: Readonly<{
    collectionId: string;
    plan: FirmsShadowPlan;
    product: FirmsProduct;
    parsed: FirmsParseResult;
  }>): Promise<FirmsShadowProductSummary> {
    const execution = executionFor(this.execution, input.collectionId);
    if (
      canonicalJson(input.plan) !== canonicalJson(execution.plan) ||
      input.parsed.product !== input.product
    ) {
      throw new FirmsCollectorDatabaseError("The parsed FIRMS product identity changed.");
    }
    const exchange = this.productExchange(input.product);
    if (exchange.occurrence === null) {
      throw new FirmsCollectorDatabaseError(
        "A parsed FIRMS product requires its durable response occurrence.",
      );
    }
    const persistenceRejected = input.parsed.detections.filter(
      (detection) => !detectionFitsPersistenceContract(detection),
    );
    const normalized = await Promise.all(
      input.parsed.detections
        .filter(detectionFitsPersistenceContract)
        .map((detection) => this.normalizedDetection(detection)),
    );
    const contentByIdentity = new Map<string, Set<string>>();
    for (const item of normalized) {
      const contents = contentByIdentity.get(item.detection_identity_sha256) ?? new Set();
      contents.add(item.normalized_content_sha256);
      contentByIdentity.set(item.detection_identity_sha256, contents);
    }
    const collisions = new Set(
      [...contentByIdentity]
        .filter(([, contents]) => contents.size > 1)
        .map(([identity]) => identity),
    );
    const accepted = normalized.filter(
      (item) => !collisions.has(item.detection_identity_sha256),
    );
    const rejectionInputs = await Promise.all([
      ...input.parsed.rejectedRows.map(async (rejection) => {
        const serialized = serializeFirmsRejection(rejection);
        return Object.freeze({
          ...serialized,
          row_fingerprint_sha256: await sha256Hex(canonicalJson(serialized)),
        });
      }),
      ...persistenceRejected.map(async (detection) => {
        const serialized = Object.freeze({
          item_index: detection.itemIndex,
          row_number: detection.rowNumber,
          reasons: Object.freeze(["persistence-contract-mismatch"]),
        });
        return Object.freeze({
          ...serialized,
          row_fingerprint_sha256: await sha256Hex(canonicalJson(serialized)),
        });
      }),
      ...normalized
        .filter((item) => collisions.has(item.detection_identity_sha256))
        .map(async (item) => {
          const serialized = Object.freeze({
            item_index: item.item_index,
            row_number: item.row_number,
            reasons: Object.freeze(["identity-collision"]),
          });
          return Object.freeze({
            ...serialized,
            row_fingerprint_sha256: await sha256Hex(canonicalJson(serialized)),
          });
        }),
    ]);
    const indexed = [...accepted, ...rejectionInputs].map((item) => item.item_index);
    if (
      new Set(indexed).size !== indexed.length ||
      indexed.length !== input.parsed.returnedRows
    ) {
      throw new FirmsCollectorDatabaseError(
        "The FIRMS parser accounting cannot be reconstructed.",
      );
    }

    return this.database.transaction(async (session) => {
      const context = await this.responseContext(
        session,
        execution,
        input.product,
        exchange,
      );
      if (
        context.exchangeOutcome !== "response" ||
        context.httpStatus !== 200 ||
        context.rawObjectId === null ||
        context.retrievedAt === null ||
        context.responseContentSha256 === null
      ) {
        throw new FirmsCollectorDatabaseError(
          "A parsed FIRMS product requires its exact terminal 200 response.",
        );
      }

      const uniqueIncoming = [...new Map(
        accepted.map((item) => [
          `${item.detection_identity_sha256}:${item.normalized_content_sha256}`,
          item,
        ]),
      ).values()];
      await session.query(
        `select pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(lock_key.value, 0)
         )
         from jsonb_array_elements_text($1::jsonb) as lock_key(value)
         order by lock_key.value`,
        [jsonParameter([...new Set(
          uniqueIncoming.map((item) => item.source_record_key),
        )].sort())],
      );
      const existing = uniqueIncoming.length === 0
        ? []
        : await session.query<DatabaseRow & {
          detection_identity_sha256: string;
          normalized_content_sha256: string;
          detail_id: string | number | bigint;
          observation_cursor: string | number | bigint;
        }>(
          `select detail.detection_identity_sha256,
             detail.normalized_content_sha256,
             detail.id as detail_id, detail.observation_cursor
           from ingest.firms_detection_details as detail
           join jsonb_to_recordset($1::jsonb) as item(
             detection_identity_sha256 text,
             normalized_content_sha256 text
           ) on item.detection_identity_sha256 = detail.detection_identity_sha256
             and item.normalized_content_sha256 = detail.normalized_content_sha256
           where detail.product_id = $2::bigint`,
          [jsonParameter(uniqueIncoming), context.productId],
        );
      const resolution = new Map<string, Readonly<{
        detailId: string;
        observationCursor: string;
      }>>();
      for (const item of existing) {
        resolution.set(
          `${item.detection_identity_sha256}:${item.normalized_content_sha256}`,
          Object.freeze({
            detailId: stringId(item.detail_id, "existing detail id"),
            observationCursor: stringId(
              item.observation_cursor,
              "existing observation cursor",
            ),
          }),
        );
      }
      const candidates = uniqueIncoming.filter((item) =>
        !resolution.has(
          `${item.detection_identity_sha256}:${item.normalized_content_sha256}`,
        )
      );

      if (candidates.length > 0) {
        const revisions = await session.query<DatabaseRow & {
          id: string | number | bigint;
          source_record_key: string;
          revision_no: string | number | bigint;
          previous_revision_id: string | number | bigint | null;
        }>(
          `with input as (
             select * from jsonb_to_recordset($1::jsonb) as item(
               source_revision_public_id uuid,
               source_record_key text,
               detection_identity_sha256 text,
               source_revision_idempotency_key text,
               normalized_content_sha256 text,
               acquired_at timestamptz,
               satellite text,
               latitude numeric,
               longitude numeric,
               raw_payload jsonb,
               canonical_data jsonb
             )
           )
           insert into ingest.source_revisions (
             public_id, contract_version, identity_version, source_id,
             source_record_key, external_id, revision_no, previous_revision_id,
             run_id, raw_object_id, adapter_release_id, idempotency_key,
             content_sha256, schema_version, observed_at, observed_precision,
             observed_timezone, published_precision, modified_precision,
             retrieved_at, valid_from, raw_payload, canonical_data, geom,
             quality_flags
           )
           select item.source_revision_public_id::core.uuid_v7,
             '1.1.0', '2.0.0', $2::bigint, item.source_record_key,
             item.detection_identity_sha256, coalesce(prior.revision_no, 0) + 1,
             prior.id, $3::bigint, $4::bigint, $5::bigint,
             item.source_revision_idempotency_key,
             item.normalized_content_sha256, $6,
             item.acquired_at, 'exact', 'UTC', 'unknown', 'unknown',
             $7::timestamptz, item.acquired_at,
             item.raw_payload, item.canonical_data,
             extensions.st_setsrid(
               extensions.st_makepoint(
                 item.longitude::double precision,
                 item.latitude::double precision
               ), 4326
             ), $8::text[]
           from input as item
           left join lateral (
             select revision.id, revision.revision_no
             from ingest.source_revisions as revision
             where revision.source_id = $2::bigint
               and revision.source_record_key = item.source_record_key
             order by revision.revision_no desc, revision.id desc limit 1
           ) as prior on true
           order by item.source_record_key
           returning id, source_record_key, revision_no, previous_revision_id`,
          [
            jsonParameter(candidates), execution.sourceId, execution.runId,
            context.rawObjectId, execution.adapterReleaseId, SCHEMA_VERSION,
            context.retrievedAt, DETAIL_LIMITATIONS,
          ],
        );
        if (revisions.length !== candidates.length) {
          throw new FirmsCollectorDatabaseError(
            "FIRMS source revision insertion was incomplete.",
          );
        }
        const revisionByRecord = new Map(
          revisions.map((row) => [row.source_record_key, Object.freeze({
            id: stringId(row.id, "source revision id"),
            revisionNo: Number(stringId(row.revision_no, "source revision number")),
            previousRevisionId: row.previous_revision_id === null
              ? null
              : stringId(row.previous_revision_id, "previous source revision id"),
          })]),
        );
        const observationInputs = candidates.map((item) => {
          const revision = revisionByRecord.get(item.source_record_key);
          if (revision === undefined) {
            throw new FirmsCollectorDatabaseError("A FIRMS source revision was lost.");
          }
          return { ...item, source_revision_id: revision.id };
        });
        const observations = await session.query<DatabaseRow & {
          source_record_key: string;
          cursor: string | number | bigint;
        }>(
          `with input as (
             select * from jsonb_to_recordset($1::jsonb) as item(
               observation_public_id uuid,
               observation_idempotency_key text,
               source_record_key text,
               source_revision_id bigint,
               acquired_at timestamptz,
               latitude numeric,
               longitude numeric,
               scan_km numeric,
               track_km numeric
             )
           )
           insert into ingest.global_observations (
             public_id, contract_version, identity_version, source_id,
             source_revision_id, idempotency_key, observation_kind,
             source_record_key, observed_at, observed_precision,
             observed_timezone, effective_precision, published_precision,
             modified_precision, retrieved_at, valid_from,
             trust_class, evidence_class, visibility, geom,
             geometry_precision_m, geometry_precision_source,
             validation_state, validation_reasons, properties, quality_flags
           )
           select item.observation_public_id::core.uuid_v7,
             '1.1.0', '2.0.0', $2::bigint, item.source_revision_id,
             item.observation_idempotency_key, 'thermal_anomaly',
             item.source_record_key, item.acquired_at, 'exact', 'UTC',
             'unknown', 'unknown', 'unknown', $3::timestamptz,
             item.acquired_at, 'official_observation', 'thermal_detection',
             'restricted',
             extensions.st_setsrid(
               extensions.st_makepoint(
                 item.longitude::double precision,
                 item.latitude::double precision
               ), 4326
             ),
             (sqrt(power(item.scan_km::double precision, 2)
               + power(item.track_km::double precision, 2)) * 500)::numeric(14,3),
             'estimated', 'accepted', '{}'::text[], '{}'::jsonb, $4::text[]
           from input as item order by item.source_record_key
           returning source_record_key, cursor`,
          [
            jsonParameter(observationInputs), execution.sourceId,
            context.retrievedAt, DETAIL_LIMITATIONS,
          ],
        );
        if (observations.length !== candidates.length) {
          throw new FirmsCollectorDatabaseError(
            "FIRMS observation insertion was incomplete.",
          );
        }
        const observationByRecord = new Map(
          observations.map((row) => [
            row.source_record_key,
            stringId(row.cursor, "observation cursor"),
          ]),
        );
        const detailInputs = candidates.map((item) => {
          const revision = revisionByRecord.get(item.source_record_key);
          const observationCursor = observationByRecord.get(item.source_record_key);
          if (revision === undefined || observationCursor === undefined) {
            throw new FirmsCollectorDatabaseError("A FIRMS typed row was lost.");
          }
          return {
            ...item,
            source_revision_id: revision.id,
            version_no: revision.revisionNo,
            previous_source_revision_id: revision.previousRevisionId,
            observation_cursor: observationCursor,
          };
        });
        const details = await session.query<DatabaseRow & {
          id: string | number | bigint;
          detection_identity_sha256: string;
          normalized_content_sha256: string;
          observation_cursor: string | number | bigint;
        }>(
          `with input as (
             select * from jsonb_to_recordset($1::jsonb) as item(
               detail_public_id uuid,
               detection_identity_sha256 text,
               normalized_content_sha256 text,
               observation_cursor bigint,
               source_revision_id bigint,
               previous_source_revision_id bigint,
               version_no bigint,
               product_key text,
               satellite text,
               source_satellite_raw text,
               instrument text,
               acquired_at timestamptz,
               latitude numeric,
               longitude numeric,
               scan_km numeric,
               track_km numeric,
               confidence_class text,
               confidence_percent numeric,
               brightness_primary_k numeric,
               brightness_secondary_k numeric,
               brightness_contract text,
               frp_mw numeric,
               day_night text,
               source_dataset_version text,
               source_row_contract text
             )
           )
           insert into ingest.firms_detection_details (
             public_id, contract_version, identity_version,
             normalized_content_sha256, observation_cursor,
             source_revision_id, source_id, product_id, product_key,
             satellite, source_satellite_raw, instrument, acquired_at,
             acquired_date, acquired_time_utc, source_time_precision,
             latitude, longitude, scan_km, track_km,
             spatial_support_method, footprint_orientation_deg,
             confidence_class, confidence_percent,
             brightness_primary_k, brightness_secondary_k,
             brightness_contract, frp_mw, day_night, source_dataset_version,
             source_row_contract, published_at, retrieved_at, version_no,
             previous_detail_id, original_detail_id, limitations
           )
           select item.detail_public_id::core.uuid_v7,
             '1.1.0', 'firms-detection-v1',
             item.normalized_content_sha256, item.observation_cursor,
             item.source_revision_id, $2::bigint, $3::bigint, item.product_key,
             item.satellite, item.source_satellite_raw, item.instrument,
             item.acquired_at, (item.acquired_at at time zone 'UTC')::date,
             (item.acquired_at at time zone 'UTC')::time(0), 'minute',
             item.latitude, item.longitude, item.scan_km, item.track_km,
             'centroid_with_circumscribed_radius_v1', null,
             item.confidence_class, item.confidence_percent,
             item.brightness_primary_k, item.brightness_secondary_k,
             item.brightness_contract, item.frp_mw, item.day_night,
             item.source_dataset_version, item.source_row_contract,
             null, $4::timestamptz, item.version_no,
             prior_detail.id, prior_detail.original_detail_id, $5::text[]
           from input as item
           left join ingest.firms_detection_details as prior_detail
             on prior_detail.source_revision_id = item.previous_source_revision_id
           order by item.detection_identity_sha256
           returning id, detection_identity_sha256,
             normalized_content_sha256, observation_cursor`,
          [
            jsonParameter(detailInputs), execution.sourceId, context.productId,
            context.retrievedAt, DETAIL_LIMITATIONS,
          ],
        );
        if (details.length !== candidates.length) {
          throw new FirmsCollectorDatabaseError(
            "FIRMS detail insertion was incomplete.",
          );
        }
        for (const item of details) {
          resolution.set(
            `${item.detection_identity_sha256}:${item.normalized_content_sha256}`,
            Object.freeze({
              detailId: stringId(item.id, "detail id"),
              observationCursor: stringId(item.observation_cursor, "observation cursor"),
            }),
          );
        }
      }

      if (accepted.length > 0) {
        const rows = accepted.map((item) => {
          const resolved = resolution.get(
            `${item.detection_identity_sha256}:${item.normalized_content_sha256}`,
          );
          if (resolved === undefined) {
            throw new FirmsCollectorDatabaseError(
              "A FIRMS accepted occurrence did not resolve.",
            );
          }
          return {
            item_index: item.item_index,
            row_number: item.row_number,
            row_fingerprint_sha256: item.row_fingerprint_sha256,
            detection_detail_id: resolved.detailId,
            observation_cursor: resolved.observationCursor,
          };
        });
        const inserted = await session.query(
          `insert into ingest.firms_response_rows (
             run_id, http_exchange_id, item_index, source_row_number,
             source_id, product_id, product_key, disposition,
             detection_detail_id, observation_cursor,
             row_fingerprint_sha256, rejection_code, rejection_reasons,
             lease_token, lease_owner
           )
           select $1::bigint, $2::bigint, item.item_index, item.row_number,
             $3::bigint, $4::bigint, $5, 'accepted',
             item.detection_detail_id, item.observation_cursor,
             item.row_fingerprint_sha256, null, '{}'::text[], $6::uuid, $7
           from jsonb_to_recordset($8::jsonb) as item(
             item_index integer, row_number integer,
             row_fingerprint_sha256 text, detection_detail_id bigint,
             observation_cursor bigint
           ) order by item.item_index returning item_index`,
          [
            execution.runId, exchange.reference.exchangeId, execution.sourceId,
            context.productId, input.product, execution.leaseToken,
            execution.workerId, jsonParameter(rows),
          ],
        );
        if (inserted.length !== accepted.length) {
          throw new FirmsCollectorDatabaseError(
            "FIRMS accepted occurrences were not inserted exactly once.",
          );
        }
      }

      if (rejectionInputs.length > 0) {
        const rows = rejectionInputs.map((item) => ({
          ...item,
          rejection_code: coarseRejectionCode(item.reasons),
        }));
        const inserted = await session.query(
          `insert into ingest.firms_response_rows (
             run_id, http_exchange_id, item_index, source_row_number,
             source_id, product_id, product_key, disposition,
             row_fingerprint_sha256, rejection_code, rejection_reasons,
             lease_token, lease_owner
           )
           select $1::bigint, $2::bigint, item.item_index, item.row_number,
             $3::bigint, $4::bigint, $5, 'rejected',
             item.row_fingerprint_sha256, item.rejection_code,
             item.reasons, $6::uuid, $7
           from jsonb_to_recordset($8::jsonb) as item(
             item_index integer, row_number integer,
             row_fingerprint_sha256 text, rejection_code text,
             reasons text[]
           ) order by item.item_index returning item_index`,
          [
            execution.runId, exchange.reference.exchangeId, execution.sourceId,
            context.productId, input.product, execution.leaseToken,
            execution.workerId, jsonParameter(rows),
          ],
        );
        if (inserted.length !== rejectionInputs.length) {
          throw new FirmsCollectorDatabaseError(
            "FIRMS rejected occurrences were not inserted exactly once.",
          );
        }
      }

      const outcome = input.parsed.status === "ok" && rejectionInputs.length === 0
        ? "complete"
        : input.parsed.status === "error"
        ? "failed"
        : "partial";
      const failureCode = outcome === "complete"
        ? null
        : input.parsed.errorCode === null
        ? "schema_rejection"
        : `parser_${input.parsed.errorCode.replaceAll("-", "_")}`;
      const result = requireSingleRow(
        await session.query<DatabaseRow & { id: string | number | bigint }>(
          `insert into ingest.firms_query_product_results (
             public_id, contract_version, run_id, http_exchange_id,
             response_raw_object_id, response_content_sha256,
             response_retrieved_at, source_id, endpoint_id,
             product_id, product_key, west, south, east, north,
             date_from, day_count, date_to, date_request_mode, issued_at,
             logical_request_sha256, http_request_fingerprint_sha256,
             parser_contract, outcome, failure_code,
             returned_row_count, accepted_row_count, rejected_row_count,
             schema_rejection_count, lineage_gap_count, completed_at,
             lease_token, lease_owner
           ) select
             $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint,
             $4::bigint, $5, $6::timestamptz, $7::bigint, $8::bigint,
             $9::bigint, $10, $11, $12, $13, $14,
             $15::date, $16, $17::date, 'explicit_starting_on',
             $18::timestamptz,
             ingest.firms_area_logical_request_sha256_v1(
               endpoint.base_url, $10, $11, $12, $13, $14, $15::date, $16
             ),
             $19, $20, $21, $22, $23, $24, $25, $25, 0,
             $26::timestamptz, $27::uuid, $28
           from core.endpoints as endpoint where endpoint.id = $8::bigint
           returning id`,
          [
            uuidV7(this.clockMs()), execution.runId,
            exchange.reference.exchangeId, context.rawObjectId,
            context.responseContentSha256, context.retrievedAt,
            execution.sourceId, execution.endpointId, context.productId,
            input.product, input.plan.area.west, input.plan.area.south,
            input.plan.area.east, input.plan.area.north,
            input.plan.dateFrom, input.plan.dayCount, input.plan.dateTo,
            context.issuedAt, context.requestFingerprintSha256,
            context.parserContract, outcome, failureCode,
            input.parsed.returnedRows, accepted.length, rejectionInputs.length,
            context.completedAt, execution.leaseToken, execution.workerId,
          ],
        ),
        "The FIRMS product result was not inserted.",
      );
      stringId(result.id, "product result id");
      const latestObservedAt = accepted.reduce<string | null>(
        (latest, item) => latest === null || item.acquired_at > latest
          ? item.acquired_at
          : latest,
        null,
      );
      return Object.freeze({
        product: input.product,
        outcome,
        returnedCount: input.parsed.returnedRows,
        acceptedCount: accepted.length,
        rejectedCount: rejectionInputs.length,
        newDetailCount: candidates.length,
        duplicateCount: accepted.length - candidates.length,
        latestObservedAt,
      });
    });
  }

  async persistProductFailure(input: Readonly<{
    collectionId: string;
    plan: FirmsShadowPlan;
    product: FirmsProduct;
    code: FirmsShadowFailureCode;
  }>): Promise<FirmsShadowProductSummary> {
    const execution = executionFor(this.execution, input.collectionId);
    if (canonicalJson(input.plan) !== canonicalJson(execution.plan)) {
      throw new FirmsCollectorDatabaseError("The failed FIRMS product plan changed.");
    }
    const exchange = this.productExchange(input.product);
    return this.database.transaction(async (session) => {
      const context = await this.responseContext(
        session,
        execution,
        input.product,
        exchange,
      );
      const hasResponse = context.rawObjectId !== null;
      if (
        hasResponse !== (context.responseContentSha256 !== null) ||
        hasResponse !== (context.retrievedAt !== null)
      ) {
        throw new FirmsCollectorDatabaseError(
          "The failed FIRMS product has a partial response occurrence.",
        );
      }
      requireSingleRow(
        await session.query<DatabaseRow & { id: string | number | bigint }>(
          `insert into ingest.firms_query_product_results (
             public_id, contract_version, run_id, http_exchange_id,
             response_raw_object_id, response_content_sha256,
             response_retrieved_at, source_id, endpoint_id,
             product_id, product_key, west, south, east, north,
             date_from, day_count, date_to, date_request_mode, issued_at,
             logical_request_sha256, http_request_fingerprint_sha256,
             parser_contract, outcome, failure_code,
             returned_row_count, accepted_row_count, rejected_row_count,
             schema_rejection_count, lineage_gap_count, completed_at,
             lease_token, lease_owner
           ) select
             $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint,
             $4::bigint, $5, $6::timestamptz, $7::bigint, $8::bigint,
             $9::bigint, $10, $11, $12, $13, $14,
             $15::date, $16, $17::date, 'explicit_starting_on',
             $18::timestamptz,
             ingest.firms_area_logical_request_sha256_v1(
               endpoint.base_url, $10, $11, $12, $13, $14, $15::date, $16
             ), $19, $20, 'failed', $21,
             0, 0, 0, 0, 0, $22::timestamptz, $23::uuid, $24
           from core.endpoints as endpoint where endpoint.id = $8::bigint
           returning id`,
          [
            uuidV7(this.clockMs()), execution.runId,
            exchange.reference.exchangeId, context.rawObjectId,
            context.responseContentSha256, context.retrievedAt,
            execution.sourceId, execution.endpointId, context.productId,
            input.product, input.plan.area.west, input.plan.area.south,
            input.plan.area.east, input.plan.area.north,
            input.plan.dateFrom, input.plan.dayCount, input.plan.dateTo,
            context.issuedAt, context.requestFingerprintSha256,
            context.parserContract, input.code, context.completedAt,
            execution.leaseToken, execution.workerId,
          ],
        ),
        "The failed FIRMS product result was not inserted.",
      );
      return Object.freeze({
        product: input.product,
        outcome: "failed",
        returnedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        newDetailCount: 0,
        duplicateCount: 0,
        latestObservedAt: null,
      });
    });
  }

  async completeCollection(summary: FirmsShadowSummary): Promise<void> {
    const execution = executionFor(this.execution, summary.collectionId);
    if (
      canonicalJson(summary.plan) !== canonicalJson(execution.plan) ||
      summary.products.length !== 4 ||
      summary.rejectedCount !== 0 ||
      canonicalJson(summary.products.map((product) => product.product)) !==
        canonicalJson(FIRMS_SHADOW_PRODUCTS)
    ) {
      throw new FirmsCollectorDatabaseError(
        "The FIRMS completion is not an exact schema-clean product set.",
      );
    }
    const cursorAfter = Object.freeze({
      firms: Object.freeze({
        area: summary.plan.areaToken,
        dateFrom: summary.plan.dateFrom,
        dateTo: summary.plan.dateTo,
        requestMode: "explicit_starting_on",
      }),
    });
    await this.database.transaction(async (session) => {
      const finalized = requireSingleRow(
        await session.query<DatabaseRow & { finished: boolean }>(
          `select ingest.finish_ingestion_run(
             $1::bigint, $2::uuid, $3, 'success', 200::smallint,
             null, null, null, $4, null, null, $5::timestamptz,
             4, $4, $6, 0, $7,
             $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
             null, now()
           ) as finished`,
          [
            execution.runId, execution.leaseToken, execution.workerId,
            summary.returnedCount, summary.latestObservedAt,
            summary.newDetailCount, summary.duplicateCount,
            jsonParameter(execution.cursorState), jsonParameter(cursorAfter),
            jsonParameter({ operation: "firms_area_csv_shadow", scope: "bounded_area" }),
            jsonParameter({
              coverage: "requested_bbox_only",
              negative_assessment_eligible: false,
              request_count: 4,
              sensor_assessability: "unknown",
            }),
          ],
        ),
        "The FIRMS run finalizer did not return a result.",
      );
      if (finalized.finished !== true) {
        throw new FirmsCollectorDatabaseError("The FIRMS completion lease was lost.");
      }
      const health = requireSingleRow(
        await session.query<DatabaseRow & {
          cursor: string | number | bigint;
          checked_at: string | Date;
        }>(
          `insert into truth.source_health (
             public_id, contract_version, source_id, endpoint_id,
             collection_target_id, collection_target_revision_id, run_id,
             idempotency_key, status, circuit_state, visibility,
             checked_at, last_success_at, latest_source_observed_at,
             consecutive_failures, source_lag, fetch_latency_ms,
             error_rate, duplicate_ratio, geographic_completeness,
             record_count, schema_failure_count, details
           )
           select $1::core.uuid_v7, '1.1.0', run.source_id, run.endpoint_id,
             run.collection_target_id, run.collection_target_revision_id,
             run.id, $3, 'healthy', 'closed', 'restricted', now(), now(),
             $4::timestamptz, 0,
             case when $4::timestamptz is null then null
               else greatest(now() - $4::timestamptz, interval '0 seconds') end,
             least(2147483647::numeric, greatest(0::numeric,
               floor(extract(epoch from (run.finished_at - run.started_at)) * 1000)
             ))::integer,
             0,
             case when $5::numeric = 0 then 0
               else $6::numeric / $5::numeric end,
             1, $7::bigint, 0, $8::jsonb
           from ingest.runs as run
           where run.id = $2::bigint and run.status = 'success'
           returning cursor, checked_at`,
          [
            uuidV7(this.clockMs()), execution.runId,
            `firms-health:${execution.plan.planKey}`,
            summary.latestObservedAt,
            summary.acceptedCount,
            summary.duplicateCount,
            summary.returnedCount,
            jsonParameter({
              anomalyAssessment: "not_assessed",
              firms_summary: summary,
              negativeAssessmentEligible: false,
              sensorAssessability: "unknown",
            }),
          ],
        ),
        "The healthy FIRMS source sample was not inserted.",
      );
      const healthCursor = stringId(health.cursor, "health cursor");
      await session.query(
        `insert into ingest.firms_query_completions (
           health_cursor, run_id, source_id, endpoint_id,
           collection_target_id, collection_target_revision_id,
           west, south, east, north, date_from, day_count, date_to,
           date_request_mode, completed_products, request_count,
           returned_row_count, accepted_row_count, schema_rejection_count,
           lineage_gap_count, request_coverage_kind, sensor_assessability,
           known_at, freshness_deadline, limitations
         )
         select $1::bigint, run.id, run.source_id, run.endpoint_id,
           run.collection_target_id, run.collection_target_revision_id,
           $3, $4, $5, $6, $7::date, $8, $9::date,
           'explicit_starting_on',
           array['MODIS_NRT','VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT','VIIRS_SNPP_NRT']::text[],
           4, $10::bigint, $10::bigint, 0, 0,
           'requested_bbox_only', 'unknown', health.checked_at,
           health.checked_at + revision.stale_after, $11::text[]
         from ingest.runs as run
         join truth.source_health as health
           on health.cursor = $1::bigint and health.run_id = run.id
         join core.collection_target_revisions as revision
           on revision.id = run.collection_target_revision_id
         where run.id = $2::bigint`,
        [
          healthCursor, execution.runId, summary.plan.area.west,
          summary.plan.area.south, summary.plan.area.east,
          summary.plan.area.north, summary.plan.dateFrom,
          summary.plan.dayCount, summary.plan.dateTo,
          summary.returnedCount, COMPLETION_LIMITATIONS,
        ],
      );
    });
    this.execution = null;
    this.exchanges.clear();
  }

  async failCollection(input: Readonly<{
    collectionId: string;
    plan: FirmsShadowPlan;
    code: FirmsShadowFailureCode;
  }>): Promise<void> {
    const execution = executionFor(this.execution, input.collectionId);
    if (canonicalJson(input.plan) !== canonicalJson(execution.plan)) {
      throw new FirmsCollectorDatabaseError("The FIRMS failure plan changed.");
    }
    const errorClass = failureClass(input.code);
    await this.database.transaction(async (session) => {
      const run = requireSingleRow(
        await session.query<DatabaseRow & { status: string }>(
          `select status from ingest.runs where id = $1::bigint`,
          [execution.runId],
        ),
        "The failing FIRMS run no longer exists.",
      );
      if (run.status === "failed") return;
      if (run.status !== "running") {
        throw new FirmsCollectorDatabaseError(
          "A successful FIRMS run cannot be rewritten as failed.",
        );
      }
      await session.query(
        `select ingest.abandon_pending_firms_http_exchanges(
           $1::bigint, $2::uuid, $3, $4
         )`,
        [execution.runId, execution.leaseToken, execution.workerId, input.code],
      );
      const counts = requireSingleRow(
        await session.query<DatabaseRow & {
          request_count: string | number | bigint;
          returned_count: string | number | bigint;
          accepted_count: string | number | bigint;
          rejected_count: string | number | bigint;
          new_detail_count: string | number | bigint;
          latest_observed_at: string | Date | null;
        }>(
          `select
             (select count(*) from ingest.http_exchanges
               where run_id = $1::bigint) as request_count,
             (select count(*) from ingest.firms_response_rows
               where run_id = $1::bigint) as returned_count,
             (select count(*) from ingest.firms_response_rows
               where run_id = $1::bigint and disposition = 'accepted')
               as accepted_count,
             (select count(*) from ingest.firms_response_rows
               where run_id = $1::bigint and disposition = 'rejected')
               as rejected_count,
             (select count(*) from ingest.source_revisions
               where run_id = $1::bigint) as new_detail_count,
             (select max(detail.acquired_at)
               from ingest.firms_response_rows as response_row
               join ingest.firms_detection_details as detail
                 on detail.id = response_row.detection_detail_id
               where response_row.run_id = $1::bigint
                 and response_row.disposition = 'accepted') as latest_observed_at`,
          [execution.runId],
        ),
        "The failing FIRMS run counts did not resolve.",
      );
      const requestCount = Number(stringId(counts.request_count, "request count"));
      const returnedCount = Number(stringId(counts.returned_count, "returned count"));
      const acceptedCount = Number(stringId(counts.accepted_count, "accepted count"));
      const rejectedCount = Number(stringId(counts.rejected_count, "rejected count"));
      const newDetailCount = Number(stringId(counts.new_detail_count, "new detail count"));
      const duplicateCount = acceptedCount - newDetailCount;
      if (duplicateCount < 0 || returnedCount !== acceptedCount + rejectedCount) {
        throw new FirmsCollectorDatabaseError(
          "The failed FIRMS run accounting is inconsistent.",
        );
      }
      const latestObservedAt = counts.latest_observed_at === null
        ? null
        : canonicalTimestamp(counts.latest_observed_at, "latest observation");
      const finished = requireSingleRow(
        await session.query<DatabaseRow & { finished: boolean }>(
          `select ingest.finish_ingestion_run(
             $1::bigint, $2::uuid, $3, 'failed', null, null, null, null,
             $4, $5, $6, $7::timestamptz,
             $8, $4, $9, $10, $11,
             $12::jsonb, null, $13::jsonb, $14::jsonb, $15::jsonb,
             now() + interval '5 minutes'
           ) as finished`,
          [
            execution.runId, execution.leaseToken, execution.workerId,
            returnedCount, errorClass,
            "The bounded FIRMS shadow collection failed closed.",
            latestObservedAt, requestCount, newDetailCount,
            rejectedCount, duplicateCount,
            jsonParameter(execution.cursorState),
            jsonParameter({ operation: "firms_area_csv_shadow", scope: "bounded_area" }),
            jsonParameter({
              coverage: "requested_bbox_only",
              negative_assessment_eligible: false,
              request_count: requestCount,
              sensor_assessability: "unknown",
            }),
            jsonParameter({ class: errorClass, reason: input.code, terminal: true }),
          ],
        ),
        "The failed FIRMS run finalizer did not return a result.",
      );
      if (finished.finished !== true) {
        throw new FirmsCollectorDatabaseError("The failed FIRMS run lost its lease.");
      }
      requireSingleRow(
        await session.query<DatabaseRow & { cursor: string | number | bigint }>(
          `insert into truth.source_health (
             public_id, contract_version, source_id, endpoint_id,
             collection_target_id, collection_target_revision_id, run_id,
             idempotency_key, status, circuit_state, visibility,
             checked_at, last_success_at, latest_source_observed_at,
             consecutive_failures, error_class, fetch_latency_ms,
             error_rate, geographic_completeness, record_count,
             schema_failure_count, details
           )
           select $1::core.uuid_v7, '1.1.0', run.source_id, run.endpoint_id,
             run.collection_target_id, run.collection_target_revision_id,
             run.id, $3, 'failed', 'closed', 'restricted', now(),
             state.last_succeeded_at, $4::timestamptz,
             state.consecutive_failures, $5,
             least(2147483647::numeric, greatest(0::numeric,
               floor(extract(epoch from (run.finished_at - run.started_at)) * 1000)
             ))::integer,
             1, null, $6::bigint, $7::integer, $8::jsonb
           from ingest.runs as run
           join ingest.collection_target_state as state
             on state.collection_target_id = run.collection_target_id
            and state.collection_target_revision_id = run.collection_target_revision_id
           where run.id = $2::bigint and run.status = 'failed'
           returning cursor`,
          [
            uuidV7(this.clockMs()), execution.runId,
            `firms-health-failed:${execution.runId}`,
            latestObservedAt, errorClass, returnedCount, rejectedCount,
            jsonParameter({
              anomalyAssessment: "not_assessed",
              failure: { class: errorClass, reason: input.code },
              negativeAssessmentEligible: false,
              sensorAssessability: "unknown",
            }),
          ],
        ),
        "The failed FIRMS source-health sample was not inserted.",
      );
    });
    this.execution = null;
    this.exchanges.clear();
  }
}

export const FIRMS_RUNTIME_CATALOG_CONTRACT = Object.freeze({
  capabilities: CAPABILITIES,
  configSchema: CONFIG_SCHEMA,
  requestParams: REQUEST_PARAMS,
  schemaVersion: SCHEMA_VERSION,
});
