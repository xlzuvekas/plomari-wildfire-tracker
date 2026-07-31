import type {
  HttpEvidenceLedger,
  HttpExchangeReference,
  HttpRequestEvidence,
  HttpResponseEvidence,
  HttpTransportErrorEvidence,
} from "../../../lib/evidence/recorded-fetch.ts";
import {
  CMR_INCREMENTAL_CADENCE_MS,
  CMR_INCREMENTAL_OVERLAP_MS,
  boundedCmrFullPlan,
  fiveMinuteCmrIncrementalPlan,
  type CmrHarvestFailureCode,
  type CmrHarvestPersistence,
  type CmrHarvestPlan,
  type CmrHarvestReservation,
  type CmrHarvestSummary,
  type CmrPersistedPage,
  type CmrPersistedPageResult,
} from "../../../lib/satellite/cmr-collector.server.ts";
import {
  CMR_FIREMASK_PRODUCTS,
  CMR_PAGE_SIZE,
  type SatellitePass,
} from "../../../lib/satellite/cmr.ts";
import {
  type CollectorDatabase,
  type DatabaseRow,
  type DatabaseSession,
  optionalSingleRow,
  requireSingleRow,
} from "./database.ts";
import { canonicalJson, sha256Hex, uuidV7 } from "./identifiers.ts";

const SOURCE_SLUG = "nasa-cmr-firemask";
const ENDPOINT_KEY = "granules-umm-g-1-6-7";
const TARGET_KEY = "global-firemask-granules";
const LEASE_SECONDS = 150;
const COLLECTOR_SCHEMA_VERSION = "cmr-umm-g-1.6.7-pass-v1";
const CMR_ADAPTER_CAPABILITIES = Object.freeze({
  anomalyAssessment: "not_assessed",
  catalogMetadataOnly: true,
  pagination: "CMR-Search-After",
  products: CMR_FIREMASK_PRODUCTS.map((product) => product.shortName),
  ummGVersion: "1.6.7",
});
const CMR_ADAPTER_CONFIG_SCHEMA = Object.freeze({});
const CMR_TARGET_REQUEST_PARAMS = Object.freeze({
  bootstrapLookbackHours: 36,
  incrementalOverlapMinutes: 10,
  maximumPagesPerProduct: 20,
  pageSize: CMR_PAGE_SIZE,
  products: CMR_FIREMASK_PRODUCTS.map((product) => ({
    satellite: product.satellite,
    shortName: product.shortName,
    version: product.version,
  })),
  provider: "LANCEMODIS",
  reconciliationIntervalHours: 24,
  responseFormat: "umm_json",
  sortKeys: ["-start_date", "granule_ur"],
});

export type CmrInvocationMode = "auto" | "bootstrap" | "reconciliation";

export type CmrPlanResolution =
  | Readonly<{ state: "execute"; plan: CmrHarvestPlan }>
  | Readonly<{
      state: "current";
      requestedTo: string;
      watermarkTo: string;
    }>;

type CatalogContext = Readonly<{
  sourceId: string;
  endpointId: string;
  targetId: string;
  targetRevisionId: string;
  adapterReleaseId: string;
  adapterVersion: string;
  cursorState: Readonly<Record<string, unknown>>;
}>;

type ExecutionContext = CatalogContext &
  Readonly<{
    harvestId: string;
    jobId: string;
    runId: string;
    leaseToken: string;
    workerId: string;
    plan: CmrHarvestPlan;
  }>;

type LatestCompletionRow = DatabaseRow & {
  health_cursor: string | number | bigint;
  watermark_to: string | Date;
  baseline_checked_at: string | Date;
  reconciliation_interval_hours: string | number | bigint;
};

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

type JobRow = DatabaseRow & {
  id: string | number | bigint;
  status: string;
  lease_token: string | null;
  lease_owner: string | null;
  attempt_count: number;
};

type RunRow = DatabaseRow & {
  id: string | number | bigint;
  public_id: string;
};

type ExchangeRow = DatabaseRow & {
  id: string | number | bigint;
  run_id: string | number | bigint;
};

type ResponseExchangeRow = DatabaseRow & {
  raw_object_id: string | number | bigint;
  retrieved_at: string | Date;
};

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
  return Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}

function scheduledSlot(scheduledFor: string) {
  const parsed = Date.parse(scheduledFor);
  if (!Number.isFinite(parsed)) {
    throw new TypeError("CMR scheduled time must be a valid UTC timestamp.");
  }
  return Math.floor(parsed / CMR_INCREMENTAL_CADENCE_MS) *
    CMR_INCREMENTAL_CADENCE_MS;
}

function boundedPositiveInteger(
  value: string | number | bigint,
  name: string,
  maximum: number,
) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new CmrCollectorDatabaseError(`Invalid database ${name}.`);
  }
  return result;
}

function safeWorkerId() {
  return `cmr-edge-${uuidV7()}`;
}

function jsonParameter(value: unknown) {
  return canonicalJson(value);
}

export function cmrRejectionIdentity(input: Readonly<{
  conceptId: string | null;
  revisionId: number | null;
}>) {
  return Object.freeze({
    catalogGranuleId:
      input.conceptId !== null &&
      /^G[0-9]+-[A-Za-z0-9_-]+$/u.test(input.conceptId)
        ? input.conceptId
        : null,
    cmrRevisionId:
      input.revisionId !== null &&
      Number.isSafeInteger(input.revisionId) &&
      input.revisionId > 0
        ? input.revisionId
        : null,
  });
}

export function cmrDuplicateContentMatches(input: Readonly<{
  incomingSha256: string;
  existingSha256: string;
}>) {
  return /^[a-f0-9]{64}$/u.test(input.incomingSha256) &&
    input.incomingSha256 === input.existingSha256;
}

function executionFor(
  current: ExecutionContext | null,
  harvestId?: string,
) {
  if (current === null || (harvestId !== undefined && current.harvestId !== harvestId)) {
    throw new Error("The CMR harvest does not own an active database execution.");
  }
  return current;
}

export class CmrCollectorDatabaseError extends Error {
  constructor(message = "The CMR collector database rejected the operation.") {
    super(message);
    this.name = "CmrCollectorDatabaseError";
  }
}

export class PostgresCmrAdapter
  implements CmrHarvestPersistence, HttpEvidenceLedger
{
  private execution: ExecutionContext | null = null;
  private requestNo = 0;
  private recoveryFromRunId: string | null = null;

  constructor(
    private readonly database: CollectorDatabase,
    private readonly clockMs: () => number = Date.now,
  ) {}

  async assertRuntimeIdentity() {
    const row = requireSingleRow(
      await this.database.query<
        Pick<
          CatalogRow,
          | "runtime_role"
          | "has_collector_capability"
          | "runtime_superuser"
          | "runtime_bypasses_rls"
          | "runtime_inherits"
          | "runtime_createdb"
          | "runtime_createrole"
          | "runtime_replication"
          | "member_of_postgres"
          | "member_of_service_role"
          | "member_of_authenticator"
          | "member_of_catalog_admin"
          | "member_of_reconciler"
          | "member_of_publisher"
          | "member_of_dispatcher"
          | "direct_memberships"
          | "effective_memberships"
          | "collector_memberships"
        > &
          DatabaseRow
      >(
        `select
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
           pg_has_role(current_user, 'service_role', 'member')
             as member_of_service_role,
           pg_has_role(current_user, 'authenticator', 'member')
             as member_of_authenticator,
           pg_has_role(current_user, 'firewatch_catalog_admin', 'member')
             as member_of_catalog_admin,
           pg_has_role(current_user, 'firewatch_reconciler', 'member')
             as member_of_reconciler,
           pg_has_role(current_user, 'firewatch_publisher', 'member')
             as member_of_publisher,
           pg_has_role(current_user, 'firewatch_dispatcher', 'member')
             as member_of_dispatcher,
           to_jsonb(array(
             select granted_role.rolname
             from pg_catalog.pg_auth_members as membership
             join pg_catalog.pg_roles as granted_role
               on granted_role.oid = membership.roleid
             where membership.member = role.oid
             order by granted_role.rolname
           )) as direct_memberships,
           to_jsonb(array(
             select inherited_role.rolname
             from pg_catalog.pg_roles as inherited_role
             where inherited_role.rolname <> current_user
               and pg_has_role(current_user, inherited_role.oid, 'member')
             order by inherited_role.rolname
           )) as effective_memberships,
           to_jsonb(array(
             select granted_role.rolname
             from pg_catalog.pg_auth_members as membership
             join pg_catalog.pg_roles as granted_role
               on granted_role.oid = membership.roleid
             where membership.member = (
               select collector.oid
               from pg_catalog.pg_roles as collector
               where collector.rolname = 'firewatch_collector'
             )
             order by granted_role.rolname
           )) as collector_memberships
         from pg_catalog.pg_roles as role
         where role.rolname = current_user`,
      ),
      "The CMR runtime database identity did not resolve.",
    );
    this.requireLeastPrivilegedRuntime(row);
  }

  async reapExpiredExecution(): Promise<boolean> {
    const result = requireSingleRow(
      await this.database.query<DatabaseRow & {
        reaped_run_id: string | number | bigint | null;
      }>(
        `select ingest.reap_expired_cmr_collection_job(
           $1::core.uuid_v7
         ) as reaped_run_id`,
        [uuidV7(this.clockMs())],
      ),
      "The CMR expired-execution reaper did not return a result.",
    );
    if (result.reaped_run_id === null) return false;
    this.recoveryFromRunId = stringId(
      result.reaped_run_id,
      "reaped run id",
    );
    return true;
  }

  private recoveryPlan(plan: CmrHarvestPlan): CmrHarvestPlan {
    if (this.recoveryFromRunId === null) return plan;
    return Object.freeze({
      ...plan,
      harvestKey:
        `${plan.harvestKey}-recovery-${this.recoveryFromRunId}`,
    });
  }

  private requireLeastPrivilegedRuntime(
    row: Pick<
      CatalogRow,
      | "runtime_role"
      | "has_collector_capability"
      | "runtime_superuser"
      | "runtime_bypasses_rls"
      | "runtime_inherits"
      | "runtime_createdb"
      | "runtime_createrole"
      | "runtime_replication"
      | "member_of_postgres"
      | "member_of_service_role"
      | "member_of_authenticator"
      | "member_of_catalog_admin"
      | "member_of_reconciler"
      | "member_of_publisher"
      | "member_of_dispatcher"
      | "direct_memberships"
      | "effective_memberships"
      | "collector_memberships"
    >,
  ) {
    if (
      row.runtime_role === "postgres" ||
      row.runtime_role === "service_role" ||
      row.runtime_role === "authenticator" ||
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
      throw new CmrCollectorDatabaseError(
        "The CMR collector is not using its least-privileged login.",
      );
    }
  }

  async resolvePlan(
    mode: CmrInvocationMode,
    scheduledFor: string,
  ): Promise<CmrPlanResolution> {
    // Even a no-op/current response is an operational assertion. Resolve the
    // same exact licensed source, endpoint switch, current target revision,
    // adapter release, and least-privileged login used by reservation before
    // consulting historical completions.
    await this.catalogContext(this.database);
    if (mode !== "auto") {
      return Object.freeze({
        state: "execute",
        plan: this.recoveryPlan(boundedCmrFullPlan({
          scanKind: mode,
          scheduledFor,
        })),
      });
    }
    const rows = await this.database.query<LatestCompletionRow>(
      `select
         completion.health_cursor,
         completion.watermark_to,
         baseline_health.checked_at as baseline_checked_at,
         (revision.request_params->>'reconciliationIntervalHours')::integer
           as reconciliation_interval_hours
       from ingest.cmr_scan_completions as completion
       join truth.source_health as health
         on health.cursor = completion.health_cursor
       join truth.source_health as baseline_health
         on baseline_health.cursor = completion.baseline_health_cursor
       join core.sources as source on source.id = health.source_id
       join core.endpoints as endpoint on endpoint.id = health.endpoint_id
       join core.collection_targets as target
         on target.id = health.collection_target_id
       join core.collection_target_revisions as revision
         on revision.id = health.collection_target_revision_id
        and revision.collection_target_id = health.collection_target_id
       where source.slug = $1
         and endpoint.endpoint_key = $2
         and target.target_key = $3
         and core.is_current_collection_target_revision(
           health.collection_target_id,
           health.collection_target_revision_id,
           now()
         )
       order by completion.health_cursor desc
       limit 1`,
      [SOURCE_SLUG, ENDPOINT_KEY, TARGET_KEY],
    );
    const latest = optionalSingleRow(rows, "CMR completion lookup was ambiguous.");
    if (latest === null) {
      return Object.freeze({
        state: "execute",
        plan: this.recoveryPlan(boundedCmrFullPlan({
          scanKind: "bootstrap",
          scheduledFor,
        })),
      });
    }

    const watermarkTo = canonicalTimestamp(latest.watermark_to, "watermark");
    const requestedSlot = scheduledSlot(scheduledFor);
    const requestedTo = new Date(requestedSlot).toISOString();
    const baselineCheckedAt = Date.parse(
      canonicalTimestamp(latest.baseline_checked_at, "baseline check time"),
    );
    const reconciliationIntervalHours = boundedPositiveInteger(
      latest.reconciliation_interval_hours,
      "reconciliation interval",
      24 * 31,
    );
    if (
      requestedSlot >=
      baselineCheckedAt + reconciliationIntervalHours * 60 * 60_000
    ) {
      return Object.freeze({
        state: "execute",
        plan: this.recoveryPlan(boundedCmrFullPlan({
          scanKind: "reconciliation",
          scheduledFor,
        })),
      });
    }
    const nextWatermark =
      Date.parse(requestedTo) - CMR_INCREMENTAL_OVERLAP_MS;
    if (Date.parse(watermarkTo) >= nextWatermark) {
      return Object.freeze({ state: "current", requestedTo, watermarkTo });
    }
    return Object.freeze({
      state: "execute",
      plan: this.recoveryPlan(fiveMinuteCmrIncrementalPlan({
        scheduledFor,
        previousWatermarkTo: watermarkTo,
        predecessorHealthCursor: stringId(
          latest.health_cursor,
          "completion cursor",
        ),
      })),
    });
  }

  private async catalogContext(session: DatabaseSession): Promise<CatalogContext> {
    const rows = await session.query<CatalogRow>(
      `select
         current_user as runtime_role,
         pg_has_role(current_user, 'firewatch_collector', 'member')
           as has_collector_capability,
         runtime_role.rolsuper as runtime_superuser,
         runtime_role.rolbypassrls as runtime_bypasses_rls,
         runtime_role.rolinherit as runtime_inherits,
         runtime_role.rolcreatedb as runtime_createdb,
         runtime_role.rolcreaterole as runtime_createrole,
         runtime_role.rolreplication as runtime_replication,
         pg_has_role(current_user, 'postgres', 'member') as member_of_postgres,
         pg_has_role(current_user, 'service_role', 'member')
           as member_of_service_role,
         pg_has_role(current_user, 'authenticator', 'member')
           as member_of_authenticator,
         pg_has_role(current_user, 'firewatch_catalog_admin', 'member')
           as member_of_catalog_admin,
         pg_has_role(current_user, 'firewatch_reconciler', 'member')
           as member_of_reconciler,
         pg_has_role(current_user, 'firewatch_publisher', 'member')
           as member_of_publisher,
         pg_has_role(current_user, 'firewatch_dispatcher', 'member')
           as member_of_dispatcher,
         to_jsonb(array(
           select granted_role.rolname
           from pg_catalog.pg_auth_members as membership
           join pg_catalog.pg_roles as granted_role
             on granted_role.oid = membership.roleid
           where membership.member = runtime_role.oid
           order by granted_role.rolname
         )) as direct_memberships,
         to_jsonb(array(
           select inherited_role.rolname
           from pg_catalog.pg_roles as inherited_role
           where inherited_role.rolname <> current_user
             and pg_has_role(current_user, inherited_role.oid, 'member')
           order by inherited_role.rolname
         )) as effective_memberships,
         to_jsonb(array(
           select granted_role.rolname
           from pg_catalog.pg_auth_members as membership
           join pg_catalog.pg_roles as granted_role
             on granted_role.oid = membership.roleid
           where membership.member = (
             select collector.oid
             from pg_catalog.pg_roles as collector
             where collector.rolname = 'firewatch_collector'
           )
           order by granted_role.rolname
         )) as collector_memberships,
         source.id as source_id,
         endpoint.id as endpoint_id,
         target.id as target_id,
         revision.id as target_revision_id,
         adapter.id as adapter_release_id,
         adapter.version_label as adapter_version,
         target_state.cursor_state
       from core.sources as source
       join core.endpoints as endpoint
         on endpoint.source_id = source.id
       join ingest.endpoint_state as endpoint_state
         on endpoint_state.endpoint_id = endpoint.id
       join core.collection_targets as target
         on target.source_id = source.id
        and target.endpoint_id = endpoint.id
       join core.collection_target_revisions as revision
         on revision.collection_target_id = target.id
        and revision.endpoint_id = endpoint.id
       join ingest.collection_target_state as target_state
         on target_state.collection_target_revision_id = revision.id
        and target_state.collection_target_id = target.id
       join core.adapter_releases as adapter
         on adapter.source_id = source.id
       join ingest.adapter_release_state as adapter_state
         on adapter_state.adapter_release_id = adapter.id
       join pg_catalog.pg_roles as runtime_role
         on runtime_role.rolname = current_user
       where source.slug = $1
         and endpoint.endpoint_key = $2
         and target.target_key = $3
         and source.enabled
         and source.license_status = 'approved'
         and source.redistribution_allowed is true
         and endpoint_state.enabled
         and endpoint_state.paused_reason is null
         and target.enabled
         and revision.enabled
         and revision.effective_at <= now()
         and endpoint.base_url =
           'https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7'
         and endpoint.http_method = 'GET'
         and endpoint.auth_mode = 'none'
         and endpoint.credential_ref is null
         and endpoint.poll_interval = interval '5 minutes'
         and endpoint.supports_cursor
         and endpoint.supports_backfill
         and revision.target_kind = 'global'
         and revision.scope = 'global'
         and revision.geometry_precision_source = 'not_applicable'
         and revision.claim_kind = 'satellite_pass_metadata'
         and revision.operational_role = 'context'
         and revision.cadence = interval '5 minutes'
         and revision.stale_after = interval '3 hours'
         and revision.request_params = $7::jsonb
         and adapter.schema_version = $4
         and adapter.capabilities = $5::jsonb
         and adapter.config_schema = $6::jsonb
         and adapter_state.enabled
         and adapter_state.retired_at is null
         and not exists (
           select 1
           from core.collection_target_revisions as newer
           where newer.collection_target_id = revision.collection_target_id
             and newer.effective_at <= now()
             and (
               newer.effective_at > revision.effective_at
               or (
                 newer.effective_at = revision.effective_at
                 and newer.version_no > revision.version_no
               )
             )
         )
         and not exists (
           select 1
           from core.adapter_releases as newer_adapter
           join ingest.adapter_release_state as newer_state
             on newer_state.adapter_release_id = newer_adapter.id
           where newer_adapter.source_id = adapter.source_id
             and newer_adapter.release_no > adapter.release_no
             and newer_state.enabled
             and newer_state.retired_at is null
         )`,
      [
        SOURCE_SLUG,
        ENDPOINT_KEY,
        TARGET_KEY,
        COLLECTOR_SCHEMA_VERSION,
        jsonParameter(CMR_ADAPTER_CAPABILITIES),
        jsonParameter(CMR_ADAPTER_CONFIG_SCHEMA),
        jsonParameter(CMR_TARGET_REQUEST_PARAMS),
      ],
    );
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new CmrCollectorDatabaseError(
        "The CMR collector catalog is disabled, incomplete, or ambiguous.",
      );
    }
    const row = rows[0];
    this.requireLeastPrivilegedRuntime(row);
    return Object.freeze({
      sourceId: stringId(row.source_id, "source id"),
      endpointId: stringId(row.endpoint_id, "endpoint id"),
      targetId: stringId(row.target_id, "target id"),
      targetRevisionId: stringId(
        row.target_revision_id,
        "target revision id",
      ),
      adapterReleaseId: stringId(
        row.adapter_release_id,
        "adapter release id",
      ),
      adapterVersion: row.adapter_version,
      cursorState: objectValue(row.cursor_state, "cursor state"),
    });
  }

  async reserveHarvest(plan: CmrHarvestPlan): Promise<CmrHarvestReservation> {
    return this.database.transaction(async (session) => {
      const catalog = await this.catalogContext(session);
      const workerId = safeWorkerId();
      const jobKey = `cmr-harvest:${plan.harvestKey}`;
      await session.query(
        `insert into ingest.jobs (
           public_id, contract_version, source_id, endpoint_id,
           collection_target_id, collection_target_revision_id,
           adapter_release_id, idempotency_key, priority, scheduled_for,
           available_at, max_attempts, input
         ) values (
           $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint,
           $4::bigint, $5::bigint, $6::bigint, $7, 900,
           $8::timestamptz, now(), 1, $9::jsonb
         )
         on conflict (idempotency_key) do nothing`,
        [
          uuidV7(this.clockMs()),
          catalog.sourceId,
          catalog.endpointId,
          catalog.targetId,
          catalog.targetRevisionId,
          catalog.adapterReleaseId,
          jobKey,
          plan.requestedTo,
          jsonParameter({ collector: "cmr_firemask_catalog", plan }),
        ],
      );
      const job = requireSingleRow(
        await session.query<JobRow>(
          `select id, status, lease_token, lease_owner, attempt_count
           from ingest.jobs
           where idempotency_key = $1
             and source_id = $2::bigint
             and endpoint_id = $3::bigint
             and collection_target_id = $4::bigint
             and collection_target_revision_id = $5::bigint
             and adapter_release_id = $6::bigint`,
          [
            jobKey,
            catalog.sourceId,
            catalog.endpointId,
            catalog.targetId,
            catalog.targetRevisionId,
            catalog.adapterReleaseId,
          ],
        ),
        "The CMR harvest job identity did not resolve.",
      );
      const jobId = stringId(job.id, "job id");

      if (job.status === "succeeded") {
        return this.completedReservation(session, jobId, plan);
      }
      if (job.status !== "pending") {
        if (job.status === "running") return Object.freeze({ state: "busy" });
        throw new CmrCollectorDatabaseError(
          "The deterministic CMR harvest slot previously failed closed.",
        );
      }

      const claimed = await session.query<JobRow>(
        `select *
         from ingest.claim_cmr_collection_job_exact(
           $1::bigint, $2, make_interval(secs => $3::integer)
         )`,
        [jobId, workerId, LEASE_SECONDS],
      );
      if (claimed.length === 0) return Object.freeze({ state: "busy" });
      const claimedJob = requireSingleRow(
        claimed,
        "The CMR exact-claim function returned multiple jobs.",
      );
      if (
        claimedJob.lease_token === null ||
        claimedJob.lease_owner !== workerId
      ) {
        throw new CmrCollectorDatabaseError();
      }

      const harvestId = uuidV7(this.clockMs());
      const run = requireSingleRow(
        await session.query<RunRow>(
          `insert into ingest.runs (
             public_id, contract_version, job_id, source_id, endpoint_id,
             collection_target_id, collection_target_revision_id,
             adapter_release_id, lease_token, lease_owner, attempt_no,
             collector_version, cursor_before, request_meta
           ) values (
             $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint, $4::bigint,
             $5::bigint, $6::bigint, $7::bigint, $8::uuid, $9, $10,
             $11, $12::jsonb, $13::jsonb
           )
           returning id, public_id::uuid::text as public_id`,
          [
            harvestId,
            jobId,
            catalog.sourceId,
            catalog.endpointId,
            catalog.targetId,
            catalog.targetRevisionId,
            catalog.adapterReleaseId,
            claimedJob.lease_token,
            workerId,
            claimedJob.attempt_count,
            catalog.adapterVersion,
            jsonParameter(catalog.cursorState),
            jsonParameter({
              operation: "cmr_firemask_catalog",
              scope: "global",
            }),
          ],
        ),
        "The CMR ingestion run was not created.",
      );
      const runId = stringId(run.id, "run id");
      this.execution = Object.freeze({
        ...catalog,
        harvestId: run.public_id,
        jobId,
        runId,
        leaseToken: claimedJob.lease_token,
        workerId,
        plan,
      });
      this.requestNo = 0;
      return Object.freeze({ state: "execute", harvestId: run.public_id });
    });
  }

  private async completedReservation(
    session: DatabaseSession,
    jobId: string,
    plan: CmrHarvestPlan,
  ): Promise<CmrHarvestReservation> {
    const row = requireSingleRow(
      await session.query<DatabaseRow & { details: unknown }>(
        `select health.details
         from ingest.runs as run
         join truth.source_health as health on health.run_id = run.id
         join ingest.cmr_scan_completions as completion
           on completion.health_cursor = health.cursor
         where run.job_id = $1::bigint
           and run.status = 'success'`,
        [jobId],
      ),
      "A completed CMR job is missing its durable completion summary.",
    );
    const details = objectValue(row.details, "completion details");
    const summary = details.cmr_summary;
    if (
      summary === null ||
      typeof summary !== "object" ||
      Array.isArray(summary) ||
      (summary as { status?: unknown }).status !== "complete" ||
      canonicalJson((summary as { plan?: unknown }).plan) !== canonicalJson(plan)
    ) {
      throw new CmrCollectorDatabaseError(
        "A completed CMR job has no matching reconstructible summary.",
      );
    }
    return Object.freeze({
      state: "already-complete",
      summary: summary as CmrHarvestSummary,
    });
  }

  async heartbeatHarvest(input: Readonly<{
    harvestId: string;
    plan: CmrHarvestPlan;
  }>): Promise<void> {
    const execution = executionFor(this.execution, input.harvestId);
    if (canonicalJson(input.plan) !== canonicalJson(execution.plan)) {
      throw new CmrCollectorDatabaseError("The CMR heartbeat plan changed.");
    }
    const renewed = requireSingleRow(
      await this.database.query<DatabaseRow & { renewed: boolean }>(
        `select ingest.heartbeat_collection_job(
           $1::bigint, $2::uuid, $3, make_interval(secs => $4::integer)
         ) as renewed`,
        [
          execution.jobId,
          execution.leaseToken,
          execution.workerId,
          LEASE_SECONDS,
        ],
      ),
      "The CMR lease heartbeat did not return a result.",
    );
    if (renewed.renewed !== true) {
      throw new CmrCollectorDatabaseError("The CMR collector lease was lost.");
    }
  }

  async issue(request: HttpRequestEvidence): Promise<HttpExchangeReference> {
    const execution = executionFor(this.execution);
    this.requestNo += 1;
    const requestNo = this.requestNo;
    const fingerprint = await sha256Hex(
      canonicalJson({
        method: request.method,
        url: request.requestUrlSafe,
        query: request.requestQuerySafe,
        headers: request.requestHeadersSafe,
        metadata: request.requestMetadataSafe,
        body: null,
      }),
    );
    const exchange = requireSingleRow(
      await this.database.query<ExchangeRow>(
        `insert into ingest.http_exchanges (
           public_id, contract_version, run_id, source_id, endpoint_id,
           request_no, idempotency_key, request_method,
           request_url_redacted, request_query_safe,
           request_fingerprint_sha256, request_headers_safe,
           request_metadata_safe
         ) values (
           $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint, $4::bigint,
           $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb
         )
         returning id, run_id`,
        [
          uuidV7(this.clockMs()),
          execution.runId,
          execution.sourceId,
          execution.endpointId,
          requestNo,
          `cmr-http:${execution.plan.harvestKey}:${requestNo}`,
          request.method,
          request.requestUrlSafe,
          jsonParameter(request.requestQuerySafe),
          fingerprint,
          jsonParameter(request.requestHeadersSafe),
          jsonParameter(request.requestMetadataSafe),
        ],
      ),
      "The CMR HTTP exchange was not issued.",
    );
    return Object.freeze({
      exchangeId: stringId(exchange.id, "HTTP exchange id"),
      runId: stringId(exchange.run_id, "HTTP exchange run id"),
    });
  }

  private exchangeReference(
    reference: HttpExchangeReference,
    execution: ExecutionContext,
  ) {
    if (
      !/^\d+$/u.test(reference.exchangeId) ||
      reference.runId !== execution.runId
    ) {
      throw new CmrCollectorDatabaseError(
        "The HTTP exchange does not belong to this CMR run.",
      );
    }
    return reference.exchangeId;
  }

  async finishResponse(
    reference: HttpExchangeReference,
    response: HttpResponseEvidence,
  ): Promise<void> {
    const execution = executionFor(this.execution);
    const exchangeId = this.exchangeReference(reference, execution);
    const digest = await sha256Hex(response.body);
    await this.database.transaction(async (session) => {
      await session.query(
        `insert into ingest.content_blobs (
           public_id, contract_version, identity_version, content_sha256,
           content_type, content_encoding, byte_size, inline_bytes
         ) values (
           $1::core.uuid_v7, '1.1.0', '2.0.0', $2, $3, $4,
           $5::bigint, $6::bytea
         )
         on conflict (content_sha256) do nothing`,
        [
          uuidV7(this.clockMs()),
          digest,
          response.safeHeaders["content-type"] ?? "application/octet-stream",
          // Fetch exposes decoded application-visible bytes. Preserve the
          // upstream transfer encoding only on the HTTP exchange; the
          // content-addressed blob itself is an identity representation.
          null,
          response.body.byteLength,
          response.body,
        ],
      );
      const blob = requireSingleRow(
        await session.query<DatabaseRow & {
          id: string | number | bigint;
          byte_size: string | number | bigint;
        }>(
          `select id, byte_size
           from ingest.content_blobs
           where content_sha256 = $1
             and representation_kind in ('inline_bytes', 'storage_object')`,
          [digest],
        ),
        "The exact CMR response content blob did not resolve.",
      );
      if (stringId(blob.byte_size, "blob byte size") !== String(response.body.byteLength)) {
        throw new CmrCollectorDatabaseError("The CMR response digest size disagreed.");
      }
      const raw = requireSingleRow(
        await session.query<DatabaseRow & { id: string | number | bigint }>(
          `insert into ingest.raw_objects (
             public_id, contract_version, source_id, endpoint_id, run_id,
             blob_id, content_sha256, idempotency_key, retrieved_at,
             metadata, http_exchange_id
           ) values (
             $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint, $4::bigint,
             $5::bigint, $6, $7, now(), '{}'::jsonb, $8::bigint
           )
           returning id`,
          [
            uuidV7(this.clockMs()),
            execution.sourceId,
            execution.endpointId,
            execution.runId,
            stringId(blob.id, "blob id"),
            digest,
            `cmr-raw:${execution.plan.harvestKey}:${exchangeId}`,
            exchangeId,
          ],
        ),
        "The exact CMR raw response was not inserted.",
      );
      const finished = requireSingleRow(
        await session.query<DatabaseRow & { finished: boolean }>(
          `select ingest.finish_http_exchange(
             $1::bigint, $2::bigint, $3::uuid, $4,
             'response', $5::smallint, $6::bigint,
             $7::jsonb, null, null, $8::jsonb
           ) as finished`,
          [
            exchangeId,
            execution.runId,
            execution.leaseToken,
            execution.workerId,
            response.status,
            stringId(raw.id, "raw object id"),
            jsonParameter(response.safeHeaders),
            jsonParameter(response.safeMetadata),
          ],
        ),
        "The CMR HTTP response terminalization did not return a result.",
      );
      if (finished.finished !== true) {
        throw new CmrCollectorDatabaseError(
          "The CMR HTTP response was not terminalized.",
        );
      }
    });
  }

  async finishTransportError(
    reference: HttpExchangeReference,
    error: HttpTransportErrorEvidence,
  ): Promise<void> {
    const execution = executionFor(this.execution);
    const exchangeId = this.exchangeReference(reference, execution);
    const finished = requireSingleRow(
      await this.database.query<DatabaseRow & { finished: boolean }>(
        `select ingest.finish_http_exchange(
           $1::bigint, $2::bigint, $3::uuid, $4,
           'transport_error', null, null, '{}'::jsonb,
           $5, $6, $7::jsonb
         ) as finished`,
        [
          exchangeId,
          execution.runId,
          execution.leaseToken,
          execution.workerId,
          error.errorClass,
          error.errorDetailSafe,
          jsonParameter(error.safeMetadata),
        ],
      ),
      "The CMR transport error terminalization did not return a result.",
    );
    if (finished.finished !== true) {
      throw new CmrCollectorDatabaseError(
        "The CMR transport error was not terminalized.",
      );
    }
  }

  private async normalizedPass(
    pass: SatellitePass,
    execution: ExecutionContext,
  ) {
    const sourceRecordKey = `cmr:${pass.id}`;
    const canonicalData = {
      anomalyAssessment: pass.anomalyAssessment,
      catalogedAt: pass.catalogedAt,
      collectionId: pass.collectionId,
      coverage: pass.coverage,
      dayNight: pass.dayNight,
      footprint: pass.footprint,
      footprintBasis: "cmr_catalog_metadata",
      granuleId: pass.id,
      granuleUr: pass.granuleUr,
      observedFrom: pass.observedFrom,
      observedTo: pass.observedTo,
      producedAt: pass.producedAt,
      product: pass.product,
      productVersion: pass.productVersion,
      revisionId: pass.revisionId,
      satellite: pass.satellite,
      sensor: pass.sensor,
      ummGVersion: pass.ummGVersion,
    } as const;
    const canonical = canonicalJson(canonicalData);
    return Object.freeze({
      source_record_key: sourceRecordKey,
      item_index: pass.itemIndex,
      concept_id: pass.id,
      collection_id: pass.collectionId,
      cmr_revision_id: pass.revisionId,
      granule_ur: pass.granuleUr,
      product: pass.product,
      product_version: pass.productVersion,
      satellite: pass.satellite,
      sensor: pass.sensor,
      umm_g_version: pass.ummGVersion,
      observed_from: pass.observedFrom,
      observed_to: pass.observedTo,
      produced_at: pass.producedAt,
      cataloged_at: pass.catalogedAt,
      day_night: pass.dayNight,
      footprint: pass.footprint,
      content_sha256: await sha256Hex(canonical),
      source_revision_public_id: uuidV7(this.clockMs()),
      source_revision_idempotency_key:
        `cmr-source:${pass.id}:revision:${pass.revisionId}`,
      observation_public_id: uuidV7(this.clockMs()),
      observation_idempotency_key:
        `cmr-observation:${pass.id}:revision:${pass.revisionId}`,
      raw_payload: {
        cmrConceptId: pass.id,
        cmrRevisionId: pass.revisionId,
        itemIndex: pass.itemIndex,
        schema: "UMM-G",
        schemaVersion: pass.ummGVersion,
      },
      canonical_data: canonicalData,
      properties: {
        anomalyAssessment: "not-assessed",
        coverage: "catalog-footprint",
        footprintBasis: "cmr_catalog_metadata",
        product: pass.product,
      },
      run_id: execution.runId,
    });
  }

  async persistPage(page: CmrPersistedPage): Promise<CmrPersistedPageResult> {
    const execution = executionFor(this.execution, page.harvestId);
    if (
      page.exchange.runId !== execution.runId ||
      canonicalJson(page.plan) !== canonicalJson(execution.plan) ||
      page.parsed.status !== "ok" ||
      page.parsed.product !== page.product.shortName
    ) {
      throw new CmrCollectorDatabaseError("The parsed CMR page identity changed.");
    }
    const distinctConcepts = new Set(page.parsed.passes.map((pass) => pass.id));
    if (distinctConcepts.size !== page.parsed.passes.length) {
      throw new CmrCollectorDatabaseError(
        "A CMR page contained multiple revisions for one granule identity.",
      );
    }
    const exchangeId = this.exchangeReference(page.exchange, execution);
    const normalized = await Promise.all(
      page.parsed.passes.map((pass) =>
        this.normalizedPass(pass, execution),
      ),
    );

    return this.database.transaction(async (session) => {
      const response = requireSingleRow(
        await session.query<ResponseExchangeRow>(
          `select
             exchange.response_raw_object_id as raw_object_id,
             raw.retrieved_at
           from ingest.http_exchanges as exchange
           join ingest.raw_objects as raw
             on raw.id = exchange.response_raw_object_id
            and raw.http_exchange_id = exchange.id
           where exchange.id = $1::bigint
             and exchange.run_id = $2::bigint
             and exchange.source_id = $3::bigint
             and exchange.endpoint_id = $4::bigint
             and exchange.outcome = 'response'
             and exchange.http_status = 200`,
          [
            exchangeId,
            execution.runId,
            execution.sourceId,
            execution.endpointId,
          ],
        ),
        "The CMR page is not backed by its terminal raw response.",
      );
      const rawObjectId = stringId(response.raw_object_id, "raw object id");
      const retrievedAt = canonicalTimestamp(response.retrieved_at, "retrieval time");

      if (page.parsed.rejectedItems.length > 0) {
        const rejections = page.parsed.rejectedItems.map((rejection) => {
          const identity = cmrRejectionIdentity(rejection);
          return {
            item_index: rejection.itemIndex,
            product: page.product.shortName,
            catalog_granule_id: identity.catalogGranuleId,
            cmr_revision_id: identity.cmrRevisionId,
            reason: rejection.reason,
          };
        });
        const inserted = await session.query(
          `insert into ingest.cmr_rejections (
             run_id, http_exchange_id, item_index, product,
             catalog_granule_id, cmr_revision_id, reason,
             lease_token, lease_owner
           )
           select
             $1::bigint, $2::bigint, item.item_index, item.product,
             item.catalog_granule_id, item.cmr_revision_id, item.reason,
             $3::uuid, $4
           from jsonb_to_recordset($5::jsonb) as item(
             item_index integer,
             product text,
             catalog_granule_id text,
             cmr_revision_id bigint,
             reason text
           )
           on conflict (run_id, http_exchange_id, item_index) do nothing
           returning item_index`,
          [
            execution.runId,
            exchangeId,
            execution.leaseToken,
            execution.workerId,
            jsonParameter(rejections),
          ],
        );
        if (inserted.length !== rejections.length) {
          throw new CmrCollectorDatabaseError(
            "CMR rejection evidence was not inserted exactly once.",
          );
        }
      }

      if (normalized.length === 0) {
        return Object.freeze({
          acceptedCount: 0,
          duplicateCount: 0,
          rejectedCount: page.parsed.rejectedItems.length,
        });
      }

      await session.query(
        `select pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(lock_key.value, 0)
         )
         from jsonb_array_elements_text($1::jsonb) as lock_key(value)
         order by lock_key.value`,
        [jsonParameter(normalized.map((item) => item.source_record_key))],
      );
      const existing = await session.query<DatabaseRow & {
        observation_cursor: string | number | bigint;
        catalog_granule_id: string;
        cmr_revision_id: string | number | bigint;
        content_sha256: string;
      }>(
        `select
           detail.observation_cursor,
           detail.catalog_granule_id,
           detail.cmr_revision_id,
           revision.content_sha256
         from ingest.cmr_granule_details as detail
         join ingest.global_observations as observation
           on observation.cursor = detail.observation_cursor
         join ingest.source_revisions as revision
           on revision.id = observation.source_revision_id
         join jsonb_to_recordset($1::jsonb) as item(
           concept_id text,
           cmr_revision_id bigint
         )
           on item.concept_id = detail.catalog_granule_id
          and item.cmr_revision_id = detail.cmr_revision_id`,
        [jsonParameter(normalized)],
      );
      const duplicateKeys = new Set(
        existing.map(
          (item) => `${item.catalog_granule_id}:${String(item.cmr_revision_id)}`,
        ),
      );
      const normalizedByRevision = new Map(
        normalized.map((item) => [
          `${item.concept_id}:${item.cmr_revision_id}`,
          item,
        ]),
      );
      for (const item of existing) {
        const incoming = normalizedByRevision.get(
          `${item.catalog_granule_id}:${String(item.cmr_revision_id)}`,
        );
        if (
          incoming === undefined ||
          !cmrDuplicateContentMatches({
            incomingSha256: incoming.content_sha256,
            existingSha256: item.content_sha256,
          })
        ) {
          throw new CmrCollectorDatabaseError(
            "CMR reused a granule revision with conflicting normalized content.",
          );
        }
      }
      const candidates = normalized.filter(
        (item) =>
          !duplicateKeys.has(`${item.concept_id}:${item.cmr_revision_id}`),
      );
      const observationCursors = new Map(
        existing.map((item) => [
          `${item.catalog_granule_id}:${String(item.cmr_revision_id)}`,
          stringId(item.observation_cursor, "existing observation cursor"),
        ]),
      );

      if (candidates.length > 0) {
        const insertedRevisions = await session.query<
          DatabaseRow & { source_record_key: string; id: string | number | bigint }
        >(
          `with input as (
             select *
             from jsonb_to_recordset($1::jsonb) as item(
               source_record_key text,
               concept_id text,
               granule_ur text,
               observed_from timestamptz,
               produced_at timestamptz,
               cataloged_at timestamptz,
               footprint jsonb,
               content_sha256 text,
               source_revision_public_id uuid,
               source_revision_idempotency_key text,
               raw_payload jsonb,
               canonical_data jsonb
             )
           )
           insert into ingest.source_revisions (
             public_id, contract_version, identity_version, source_id,
             source_record_key, external_id, revision_no,
             previous_revision_id, run_id, raw_object_id,
             adapter_release_id, idempotency_key, content_sha256,
             schema_version, observed_at, observed_precision,
             observed_timezone, published_at, published_precision,
             published_timezone, modified_at, modified_precision,
             modified_timezone, retrieved_at, valid_from, title,
             raw_payload, canonical_data, geom, quality_flags
           )
           select
             item.source_revision_public_id::core.uuid_v7,
             '1.1.0', '2.0.0', $2::bigint,
             item.source_record_key, item.concept_id,
             coalesce(prior.revision_no, 0) + 1,
             prior.id, $3::bigint, $4::bigint, $5::bigint,
             item.source_revision_idempotency_key, item.content_sha256,
             $6, item.observed_from, 'exact', 'UTC',
             item.produced_at,
             case when item.produced_at is null then 'unknown' else 'exact' end,
             case when item.produced_at is null then null else 'UTC' end,
             item.cataloged_at, 'exact', 'UTC', $7::timestamptz,
             item.observed_from, item.granule_ur,
             item.raw_payload, item.canonical_data,
             extensions.st_setsrid(
               extensions.st_geomfromgeojson(item.footprint::text), 4326
             ),
             array['catalog_metadata_only', 'anomaly_not_assessed']::text[]
           from input as item
           left join lateral (
             select revision.id, revision.revision_no
             from ingest.source_revisions as revision
             where revision.source_id = $2::bigint
               and revision.source_record_key = item.source_record_key
             order by revision.revision_no desc, revision.id desc
             limit 1
           ) as prior on true
           order by item.source_record_key
           on conflict (idempotency_key) do nothing
           returning source_record_key, id`,
          [
            jsonParameter(candidates),
            execution.sourceId,
            execution.runId,
            rawObjectId,
            execution.adapterReleaseId,
            COLLECTOR_SCHEMA_VERSION,
            retrievedAt,
          ],
        );
        if (insertedRevisions.length !== candidates.length) {
          throw new CmrCollectorDatabaseError(
            "CMR source revision insertion conflicted without typed evidence.",
          );
        }
        const revisionIds = Object.fromEntries(
          insertedRevisions.map((row) => [
            row.source_record_key,
            stringId(row.id, "source revision id"),
          ]),
        );
        const observationInput = candidates.map((item) => ({
          ...item,
          source_revision_id: revisionIds[item.source_record_key],
        }));
        const observations = await session.query<
          DatabaseRow & { source_record_key: string; cursor: string | number | bigint }
        >(
          `with input as (
             select *
             from jsonb_to_recordset($1::jsonb) as item(
               source_record_key text,
               source_revision_id bigint,
               observation_public_id uuid,
               observation_idempotency_key text,
               observed_from timestamptz,
               observed_to timestamptz,
               produced_at timestamptz,
               cataloged_at timestamptz,
               footprint jsonb,
               properties jsonb
             )
           )
           insert into ingest.global_observations (
             public_id, contract_version, identity_version, source_id,
             source_revision_id, idempotency_key, observation_kind,
             source_record_key, observed_at, observed_precision,
             observed_timezone, effective_at, effective_precision,
             effective_timezone, published_at, published_precision,
             published_timezone, modified_at, modified_precision,
             modified_timezone,
             retrieved_at, valid_from, valid_to, trust_class,
             evidence_class, visibility, geom, geometry_precision_m,
             geometry_precision_source, validation_state,
             validation_reasons, properties, quality_flags
           )
           select
             item.observation_public_id::core.uuid_v7,
             '1.1.0', '2.0.0', $2::bigint,
             item.source_revision_id, item.observation_idempotency_key,
             'satellite_imagery', item.source_record_key,
             item.observed_from, 'exact', 'UTC',
             item.observed_from, 'exact', 'UTC',
             item.produced_at,
             case when item.produced_at is null then 'unknown' else 'exact' end,
             case when item.produced_at is null then null else 'UTC' end,
             item.cataloged_at, 'exact', 'UTC', $3::timestamptz,
             item.observed_from, item.observed_to,
             'official_observation', 'satellite_pass_metadata', 'public',
             extensions.st_setsrid(
               extensions.st_geomfromgeojson(item.footprint::text), 4326
             ),
             null, 'not_applicable', 'accepted', '{}'::text[],
             item.properties,
             array['catalog_metadata_only', 'anomaly_not_assessed']::text[]
           from input as item
           order by item.source_record_key
           returning source_record_key, cursor`,
          [jsonParameter(observationInput), execution.sourceId, retrievedAt],
        );
        if (observations.length !== candidates.length) {
          throw new CmrCollectorDatabaseError(
            "CMR observation insertion was incomplete.",
          );
        }
        for (const observation of observations) {
          const candidate = candidates.find(
            (item) => item.source_record_key === observation.source_record_key,
          );
          if (candidate === undefined) {
            throw new CmrCollectorDatabaseError(
              "CMR observation insertion returned an unknown record identity.",
            );
          }
          observationCursors.set(
            `${candidate.concept_id}:${candidate.cmr_revision_id}`,
            stringId(observation.cursor, "observation cursor"),
          );
        }
        const details = candidates.map((item) => ({
          ...item,
          observation_cursor: observationCursors.get(
            `${item.concept_id}:${item.cmr_revision_id}`,
          ),
        }));
        const insertedDetails = await session.query(
          `insert into ingest.cmr_granule_details (
             observation_cursor, catalog_granule_id,
             catalog_collection_id, cmr_revision_id, umm_g_version,
             product, product_version, satellite, sensor, observed_to,
             produced_at, cataloged_at, day_night
           )
           select
             item.observation_cursor, item.concept_id,
             item.collection_id, item.cmr_revision_id, item.umm_g_version,
             item.product, item.product_version, item.satellite,
             item.sensor, item.observed_to, item.produced_at,
             item.cataloged_at, item.day_night
           from jsonb_to_recordset($1::jsonb) as item(
             observation_cursor bigint,
             concept_id text,
             collection_id text,
             cmr_revision_id bigint,
             umm_g_version text,
             product text,
             product_version text,
             satellite text,
             sensor text,
             observed_to timestamptz,
             produced_at timestamptz,
             cataloged_at timestamptz,
             day_night text
           )
           order by item.concept_id
           returning observation_cursor`,
          [jsonParameter(details)],
        );
        if (insertedDetails.length !== candidates.length) {
          throw new CmrCollectorDatabaseError(
            "CMR typed detail insertion was incomplete.",
          );
        }
      }

      const occurrences = normalized.map((item) => {
        const observationCursor = observationCursors.get(
          `${item.concept_id}:${item.cmr_revision_id}`,
        );
        if (observationCursor === undefined) {
          throw new CmrCollectorDatabaseError(
            "CMR occurrence could not resolve its immutable observation.",
          );
        }
        return {
          item_index: item.item_index,
          observation_cursor: observationCursor,
          product: item.product,
          catalog_granule_id: item.concept_id,
          cmr_revision_id: item.cmr_revision_id,
        };
      });
      const insertedOccurrences = await session.query(
        `insert into ingest.cmr_granule_occurrences (
           run_id, http_exchange_id, item_index, observation_cursor, product,
           catalog_granule_id, cmr_revision_id, lease_token, lease_owner
         )
         select
           $1::bigint, $2::bigint, item.item_index, item.observation_cursor,
           item.product, item.catalog_granule_id, item.cmr_revision_id,
           $3::uuid, $4
         from jsonb_to_recordset($5::jsonb) as item(
           item_index integer,
           observation_cursor bigint,
           product text,
           catalog_granule_id text,
           cmr_revision_id bigint
         )
         order by item.item_index
         returning observation_cursor`,
        [
          execution.runId,
          exchangeId,
          execution.leaseToken,
          execution.workerId,
          jsonParameter(occurrences),
        ],
      );
      if (insertedOccurrences.length !== normalized.length) {
        throw new CmrCollectorDatabaseError(
          "CMR occurrence insertion was incomplete.",
        );
      }

      return Object.freeze({
        acceptedCount: candidates.length,
        duplicateCount: duplicateKeys.size,
        rejectedCount: page.parsed.rejectedItems.length,
      });
    });
  }

  async completeHarvest(summary: CmrHarvestSummary): Promise<void> {
    const execution = executionFor(this.execution, summary.harvestId);
    if (
      canonicalJson(summary.plan) !== canonicalJson(execution.plan) ||
      summary.products.length !== 3 ||
      summary.rejectedCount !== 0
    ) {
      throw new CmrCollectorDatabaseError(
        "The CMR completion summary is not a complete three-product scan.",
      );
    }
    const productNames = [...summary.products]
      .map((product) => product.product)
      .sort();
    if (
      canonicalJson(productNames) !==
      canonicalJson(["VJ114IMG_NRT", "VJ214IMG_NRT", "VNP14IMG_NRT"])
    ) {
      throw new CmrCollectorDatabaseError(
        "The CMR completion product set is invalid.",
      );
    }
    const latestObservedAt = summary.products.reduce<string | null>(
      (latest, product) => {
        if (product.latestObservedAt === null) return latest;
        return latest === null ||
          Date.parse(product.latestObservedAt) > Date.parse(latest)
          ? product.latestObservedAt
          : latest;
      },
      null,
    );
    const cursorAfter = Object.freeze({
      cmr: Object.freeze({
        completedWindowTo: summary.plan.requestedTo,
        scanKind: summary.plan.scanKind,
        watermarkTo: summary.plan.watermarkTo,
      }),
    });

    await this.database.transaction(async (session) => {
      const finalized = requireSingleRow(
        await session.query<DatabaseRow & { finished: boolean }>(
          `select ingest.finish_ingestion_run(
             $1::bigint, $2::uuid, $3, 'success', 200::smallint,
             null, null, null, $4, null, null, $5::timestamptz,
             $6, $7, $8, 0, $9,
             $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
             null, now()
           ) as finished`,
          [
            execution.runId,
            execution.leaseToken,
            execution.workerId,
            summary.fetchedCount,
            latestObservedAt,
            summary.requestCount,
            summary.fetchedCount,
            summary.acceptedCount,
            summary.duplicateCount,
            jsonParameter(execution.cursorState),
            jsonParameter(cursorAfter),
            jsonParameter({
              operation: "cmr_firemask_catalog",
              scope: "global",
            }),
            jsonParameter({ page_count: summary.pageCount }),
          ],
        ),
        "The CMR run finalizer did not return a result.",
      );
      if (finalized.finished !== true) {
        throw new CmrCollectorDatabaseError("The CMR run lost its completion lease.");
      }

      const health = requireSingleRow(
        await session.query<DatabaseRow & { cursor: string | number | bigint }>(
          `insert into truth.source_health (
             public_id, contract_version, source_id, endpoint_id,
             collection_target_id, collection_target_revision_id, run_id,
             idempotency_key, status, circuit_state, visibility,
             checked_at, last_success_at, latest_source_observed_at,
             consecutive_failures, source_lag, fetch_latency_ms,
             error_rate, duplicate_ratio, geographic_completeness,
             record_count, schema_failure_count, details
           )
           select
             $1::core.uuid_v7, '1.1.0', $2::bigint, $3::bigint,
             $4::bigint, $5::bigint, $6::bigint, $7,
             'healthy', 'closed', 'public', now(), now(), $8::timestamptz,
             0,
             case
               when $8::timestamptz is null then null
               else greatest(now() - $8::timestamptz, interval '0 seconds')
             end,
             greatest(
               0,
               floor(extract(epoch from (now() - run.started_at)) * 1000)
             )::integer,
             0,
             case when $9::numeric = 0 then 0
               else $10::numeric / $9::numeric end,
             1, $9::bigint, 0,
             $11::jsonb
           from ingest.runs as run
           where run.id = $6::bigint
             and run.status = 'success'
           returning cursor`,
          [
            uuidV7(this.clockMs()),
            execution.sourceId,
            execution.endpointId,
            execution.targetId,
            execution.targetRevisionId,
            execution.runId,
            `cmr-health:${summary.plan.harvestKey}`,
            latestObservedAt,
            summary.acceptedCount + summary.duplicateCount,
            summary.duplicateCount,
            jsonParameter({
              anomalyAssessment: "not_assessed",
              catalogMetadataOnly: true,
              cmr_summary: summary,
            }),
          ],
        ),
        "The healthy CMR source sample was not inserted.",
      );
      const healthCursor = stringId(health.cursor, "health cursor");
      await session.query(
        `insert into ingest.cmr_scan_completions (
           health_cursor, run_id, scan_kind, requested_from, requested_to,
           watermark_from, updated_since, watermark_to,
           predecessor_health_cursor, baseline_health_cursor,
           continuous_coverage_from, continuous_coverage_to, lineage_depth,
           completed_products, page_count, upstream_hit_count,
           accepted_granule_count, freshness_deadline
         ) values (
           $1::bigint, $2::bigint, $3, $4::timestamptz, $5::timestamptz,
           $6::timestamptz, $7::timestamptz, $8::timestamptz,
           $9::bigint, $1::bigint, $4::timestamptz, $5::timestamptz, 0,
           array['VJ114IMG_NRT', 'VJ214IMG_NRT', 'VNP14IMG_NRT']::text[],
           $10, $11::bigint, $12::bigint, now()
         )`,
        [
          healthCursor,
          execution.runId,
          summary.plan.scanKind,
          summary.plan.requestedFrom,
          summary.plan.requestedTo,
          summary.plan.watermarkFrom,
          summary.plan.updatedSince,
          summary.plan.watermarkTo,
          summary.plan.predecessorHealthCursor,
          summary.pageCount,
          summary.upstreamHitCount,
          summary.acceptedCount + summary.duplicateCount,
        ],
      );
      const productRows = summary.products.map((product) => ({
        product: product.product,
        page_count: product.pages,
        upstream_hit_count: product.upstreamHits,
        accepted_granule_count:
          product.acceptedCount + product.duplicateCount,
      }));
      const insertedProducts = await session.query(
        `insert into ingest.cmr_scan_product_completions (
           health_cursor, product, page_count, upstream_hit_count,
           accepted_granule_count
         )
         select
           $1::bigint, product.product, product.page_count,
           product.upstream_hit_count, product.accepted_granule_count
         from jsonb_to_recordset($2::jsonb) as product(
           product text,
           page_count integer,
           upstream_hit_count bigint,
           accepted_granule_count bigint
         )
         order by product.product
         returning product`,
        [healthCursor, jsonParameter(productRows)],
      );
      if (insertedProducts.length !== 3) {
        throw new CmrCollectorDatabaseError(
          "The CMR product completion set was not inserted.",
        );
      }
    });
    this.execution = null;
  }

  async failHarvest(input: Readonly<{
    harvestId: string;
    plan: CmrHarvestPlan;
    code: CmrHarvestFailureCode;
    detailSafe: string;
  }>): Promise<void> {
    const execution = executionFor(this.execution, input.harvestId);
    if (canonicalJson(input.plan) !== canonicalJson(execution.plan)) {
      throw new CmrCollectorDatabaseError("The CMR failure plan changed.");
    }
    const errorClass = failureClass(input.code);
    await this.database.transaction(async (session) => {
      const run = requireSingleRow(
        await session.query<DatabaseRow & { status: string }>(
          `select status from ingest.runs where id = $1::bigint`,
          [execution.runId],
        ),
        "The failing CMR run no longer exists.",
      );
      if (run.status === "failed") return;
      if (run.status !== "running") {
        throw new CmrCollectorDatabaseError(
          "A successful CMR run cannot be rewritten as failed.",
        );
      }
      await session.query(
        `select ingest.abandon_pending_cmr_http_exchanges(
           $1::bigint, $2::uuid, $3, $4
         )`,
        [
          execution.runId,
          execution.leaseToken,
          execution.workerId,
          input.code,
        ],
      );
      const counts = requireSingleRow(
        await session.query<DatabaseRow & {
          request_count: string | number | bigint;
          occurrence_count: string | number | bigint;
          accepted_count: string | number | bigint;
          rejected_count: string | number | bigint;
        }>(
          `select
             (select count(*) from ingest.http_exchanges
               where run_id = $1::bigint) as request_count,
             (select count(*)
               from ingest.cmr_granule_occurrences
               where run_id = $1::bigint) as occurrence_count,
             (select count(*)
               from ingest.source_revisions
               where run_id = $1::bigint) as accepted_count,
             (select count(*)
               from ingest.cmr_rejections
               where run_id = $1::bigint) as rejected_count`,
          [execution.runId],
        ),
        "The failing CMR run counts did not resolve.",
      );
      const requestCount = Number(stringId(counts.request_count, "request count"));
      const occurrenceCount = Number(
        stringId(counts.occurrence_count, "occurrence count"),
      );
      const acceptedCount = Number(stringId(counts.accepted_count, "accepted count"));
      const rejectedCount = Number(stringId(counts.rejected_count, "rejected count"));
      const duplicateCount = occurrenceCount - acceptedCount;
      if (duplicateCount < 0) {
        throw new CmrCollectorDatabaseError(
          "The failed CMR run occurrence counts are inconsistent.",
        );
      }
      const itemCount = occurrenceCount + rejectedCount;
      const finished = requireSingleRow(
        await session.query<DatabaseRow & { finished: boolean }>(
          `select ingest.finish_ingestion_run(
             $1::bigint, $2::uuid, $3, 'failed', null, null, null, null,
             $4, $5, $6, null,
             $7, $4, $8, $9, $10,
             $11::jsonb, null, $12::jsonb, $13::jsonb, $14::jsonb,
             now() + interval '5 minutes'
           ) as finished`,
          [
            execution.runId,
            execution.leaseToken,
            execution.workerId,
            itemCount,
            errorClass,
            input.detailSafe,
            requestCount,
            acceptedCount,
            rejectedCount,
            duplicateCount,
            jsonParameter(execution.cursorState),
            jsonParameter({
              operation: "cmr_firemask_catalog",
              scope: "global",
            }),
            jsonParameter({ page_count: requestCount }),
            jsonParameter({ class: errorClass, reason: input.code }),
          ],
        ),
        "The failed CMR run finalizer did not return a result.",
      );
      if (finished.finished !== true) {
        throw new CmrCollectorDatabaseError("The failed CMR run lost its lease.");
      }
      const healthStatus = errorClass === "rate_limit"
        ? "rate_limited"
        : "failed";
      const circuitState = errorClass === "rate_limit" ? "open" : "closed";
      requireSingleRow(
        await session.query<DatabaseRow & { cursor: string | number | bigint }>(
          `insert into truth.source_health (
             public_id, contract_version, source_id, endpoint_id,
             collection_target_id, collection_target_revision_id, run_id,
             idempotency_key, status, circuit_state, visibility,
             checked_at, last_success_at, consecutive_failures, error_class,
             fetch_latency_ms, error_rate, geographic_completeness,
             record_count, schema_failure_count, details
           )
           select
             $1::core.uuid_v7, '1.1.0', run.source_id, run.endpoint_id,
             run.collection_target_id, run.collection_target_revision_id,
             run.id, $3, $4, $5, 'public', now(), state.last_succeeded_at,
             state.consecutive_failures, $6,
             least(
               2147483647::numeric,
               greatest(
                 0::numeric,
                 floor(extract(epoch from (run.finished_at - run.started_at)) * 1000)
               )
             )::integer,
             1, null, $7::bigint, $8::integer, $9::jsonb
           from ingest.runs as run
           join ingest.collection_target_state as state
             on state.collection_target_id = run.collection_target_id
            and state.collection_target_revision_id =
              run.collection_target_revision_id
           where run.id = $2::bigint
             and run.status = 'failed'
             and run.finished_at is not null
           returning cursor`,
          [
            uuidV7(this.clockMs()),
            execution.runId,
            `cmr-health-failed:${execution.plan.harvestKey}`,
            healthStatus,
            circuitState,
            errorClass,
            occurrenceCount,
            rejectedCount,
            jsonParameter({
              anomalyAssessment: "not_assessed",
              catalogMetadataOnly: true,
              failure: { class: errorClass, reason: input.code },
            }),
          ],
        ),
        "The failed CMR source-health sample was not inserted.",
      );
    });
    this.execution = null;
  }
}

function failureClass(code: CmrHarvestFailureCode) {
  switch (code) {
    case "deadline":
    case "timeout":
      return "timeout";
    case "rate_limit":
      return "rate_limit";
    case "network":
      return "network";
    case "redirect":
    case "upstream":
    case "provider_timeout":
      return "upstream";
    case "database":
      return "database";
    case "invalid_headers":
    case "invalid_response":
    case "pagination_drift":
    case "page_limit":
    case "byte_limit":
      return "validation";
  }
}
