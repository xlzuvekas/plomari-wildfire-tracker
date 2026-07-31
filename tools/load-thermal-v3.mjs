const MAX_STAGES = 8;
const MAX_CONCURRENCY = 64;
const MAX_TOTAL_REQUESTS = 1_000;
const MAX_RESPONSE_BYTES = 1_050_000;
const REQUEST_TIMEOUT_MS = 13_000;
const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const deploymentIdPattern = /^dpl_[A-Za-z0-9]{16,128}$/u;

const expectedPreviewHost = process.env.FIREWATCH_LOAD_EXPECTED_PREVIEW_HOST;
if (
  expectedPreviewHost === undefined ||
  expectedPreviewHost !== expectedPreviewHost.toLowerCase() ||
  !hostnamePattern.test(expectedPreviewHost) ||
  !expectedPreviewHost.endsWith(".vercel.app")
) {
  throw new Error(
    "FIREWATCH_LOAD_EXPECTED_PREVIEW_HOST must be one canonical Vercel Preview hostname.",
  );
}

const expectedDeploymentId =
  process.env.FIREWATCH_LOAD_EXPECTED_DEPLOYMENT_ID;
if (!deploymentIdPattern.test(expectedDeploymentId ?? "")) {
  throw new Error(
    "FIREWATCH_LOAD_EXPECTED_DEPLOYMENT_ID must be one Vercel deployment ID.",
  );
}

const acknowledgement = process.env.FIREWATCH_LOAD_ACK;
if (
  acknowledgement !==
    `preview-read-model-only:${expectedPreviewHost}:${expectedDeploymentId}`
) {
  throw new Error(
    "FIREWATCH_LOAD_ACK must acknowledge the exact expected Preview hostname.",
  );
}

let target;
try {
  target = new URL(process.env.FIREWATCH_LOAD_TARGET_URL ?? "");
} catch {
  throw new Error("FIREWATCH_LOAD_TARGET_URL must be an exact Vercel Preview thermal-v3 URL.");
}
if (
  target.protocol !== "https:" ||
  target.username !== "" ||
  target.password !== "" ||
  target.port !== "" ||
  target.pathname !== "/api/v3/thermal-anomalies" ||
  target.search !== "" ||
  target.hash !== "" ||
  target.hostname !== expectedPreviewHost
) {
  throw new Error("FIREWATCH_LOAD_TARGET_URL must be an exact Vercel Preview thermal-v3 URL.");
}

const productionHostText = process.env.FIREWATCH_LOAD_PRODUCTION_HOSTS;
if (productionHostText === undefined || productionHostText.length === 0) {
  throw new Error("FIREWATCH_LOAD_PRODUCTION_HOSTS must deny at least one Production hostname.");
}
const productionHosts = productionHostText.split(",");
if (
  productionHosts.some(
    (host) =>
      host === "" ||
      host !== host.trim() ||
      host !== host.toLowerCase() ||
      !hostnamePattern.test(host),
  ) ||
  new Set(productionHosts).size !== productionHosts.length
) {
  throw new Error(
    "FIREWATCH_LOAD_PRODUCTION_HOSTS must be unique, canonical, comma-separated hostnames.",
  );
}
if (productionHosts.includes(target.hostname)) {
  throw new Error("The load harness refuses an explicitly denied Production hostname.");
}

const canaryToken = process.env.FIREWATCH_LOAD_CANARY_TOKEN;
if (!/^[A-Za-z0-9_-]{43,128}$/u.test(canaryToken ?? "")) {
  throw new Error("FIREWATCH_LOAD_CANARY_TOKEN must be one bounded base64url bearer token.");
}

const cell = process.env.FIREWATCH_LOAD_CELL;
if (!/^wm\/(?:[7-9]|10|11)\/\d+\/\d+$/u.test(cell ?? "")) {
  throw new Error("FIREWATCH_LOAD_CELL must be one canonical wm/z/x/y cell.");
}

const pageSize = Number(process.env.FIREWATCH_LOAD_PAGE_SIZE ?? "100");
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
  throw new Error("FIREWATCH_LOAD_PAGE_SIZE must be an integer from 1 through 100.");
}

const continuationCursor = process.env.FIREWATCH_LOAD_AFTER;
if (
  continuationCursor !== undefined &&
  (continuationCursor.length > 1_024 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(continuationCursor))
) {
  throw new Error("FIREWATCH_LOAD_AFTER must be one bounded opaque continuation cursor.");
}

function isCanonicalInstant(value) {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

const suppliedAsOf = process.env.FIREWATCH_LOAD_AS_OF;
const suppliedKnownAt = process.env.FIREWATCH_LOAD_KNOWN_AT;
if ((suppliedAsOf === undefined) !== (suppliedKnownAt === undefined)) {
  throw new Error("FIREWATCH_LOAD_AS_OF and FIREWATCH_LOAD_KNOWN_AT must be supplied together.");
}
if (
  continuationCursor !== undefined &&
  (suppliedAsOf === undefined || suppliedKnownAt === undefined)
) {
  throw new Error("Continuation load requires its cursor-bound asOf and knownAt values.");
}
const requestKnownAt = suppliedKnownAt ?? new Date().toISOString();
const requestAsOf = suppliedAsOf ?? requestKnownAt;
const nowMs = Date.now();
const maximumHistoryMs = 31 * 24 * 60 * 60_000;
if (
  !isCanonicalInstant(requestAsOf) ||
  !isCanonicalInstant(requestKnownAt) ||
  Date.parse(requestAsOf) > Date.parse(requestKnownAt) ||
  Date.parse(requestAsOf) < nowMs - maximumHistoryMs ||
  Date.parse(requestKnownAt) < nowMs - maximumHistoryMs ||
  Date.parse(requestKnownAt) > nowMs + 5 * 60_000 ||
  Date.parse(requestKnownAt) - Date.parse(requestAsOf) > maximumHistoryMs
) {
  throw new Error("The load cutoffs must satisfy the route's canonical 31-day time bounds.");
}

const stagePattern = /^[1-9]\d*(?:,[1-9]\d*)*$/u;
const stageText = process.env.FIREWATCH_LOAD_CONCURRENCY_STAGES ?? "1,2,4,8";
if (!stagePattern.test(stageText)) {
  throw new Error("FIREWATCH_LOAD_CONCURRENCY_STAGES must be comma-separated positive integers.");
}
const stages = stageText.split(",").map(Number);
if (
  stages.length > MAX_STAGES ||
  stages.some((value) => value > MAX_CONCURRENCY) ||
  stages.some((value, index) => index > 0 && value <= stages[index - 1])
) {
  throw new Error(
    "The load harness requires at most 8 strictly increasing stages, each capped at 64 concurrent requests.",
  );
}

const requestsPerStage = Number(process.env.FIREWATCH_LOAD_REQUESTS_PER_STAGE ?? "40");
if (!Number.isInteger(requestsPerStage) || requestsPerStage < 10) {
  throw new Error("FIREWATCH_LOAD_REQUESTS_PER_STAGE must be an integer of at least 10.");
}
const stagedRequestCount = stages.length * requestsPerStage;
if (stagedRequestCount + 2 > MAX_TOTAL_REQUESTS) {
  throw new Error("The load harness caps each run, including preflights, at 1000 requests.");
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

class UnsafeLoadResponseError extends Error {}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The run is already failing closed; cancellation is best effort.
  }
}

async function consumeBoundedResponse(response) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    await cancelResponseBody(response);
    throw new UnsafeLoadResponseError();
  }
  if (response.body === null) return;

  const reader = response.body.getReader();
  let receivedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new UnsafeLoadResponseError();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function hasExpectedAttestation(result) {
  return (
    result.deploymentEnvironment === "preview" &&
    result.deploymentHost === expectedPreviewHost &&
    result.deploymentId === expectedDeploymentId
  );
}

async function oneRequest(authenticated, runController) {
  const url = new URL(target);
  url.searchParams.set("cell", cell);
  url.searchParams.set("schemaVersion", "3");
  url.searchParams.set("asOf", requestAsOf);
  url.searchParams.set("knownAt", requestKnownAt);
  url.searchParams.set("limit", String(pageSize));
  if (continuationCursor !== undefined) {
    url.searchParams.set("after", continuationCursor);
  }
  const startedAt = performance.now();
  let response;
  try {
    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-store",
    };
    if (authenticated) {
      headers.Authorization = `Bearer ${canaryToken}`;
    }
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers,
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        runController.signal,
      ]),
    });
    const result = {
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      retryAfter: response.headers.get("retry-after"),
      deploymentEnvironment: response.headers.get(
        "x-firewatch-deployment-environment",
      ),
      deploymentHost: response.headers.get("x-firewatch-deployment-host"),
      deploymentId: response.headers.get("x-firewatch-deployment-id"),
    };
    if (!hasExpectedAttestation(result)) {
      await cancelResponseBody(response);
      runController.abort();
      return result;
    }
    await consumeBoundedResponse(response);
    return result;
  } catch {
    runController.abort();
    return {
      status: 0,
      elapsedMs: Math.round(performance.now() - startedAt),
      retryAfter: null,
      deploymentEnvironment: null,
      deploymentHost: null,
      deploymentId: null,
    };
  }
}

async function runStage(concurrency, runController) {
  const results = [];
  let nextRequest = 0;
  async function worker() {
    while (
      nextRequest < requestsPerStage &&
      !runController.signal.aborted
    ) {
      nextRequest += 1;
      results.push(await oneRequest(true, runController));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (
    runController.signal.aborted ||
    results.some((result) => !hasExpectedAttestation(result))
  ) {
    throw new Error(
      "Preview attestation changed during the run; remaining requests were stopped.",
    );
  }
  const latencies = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
  const statuses = Object.fromEntries(
    [...new Set(results.map((result) => result.status))]
      .sort((a, b) => a - b)
      .map((status) => [
        String(status),
        results.filter((result) => result.status === status).length,
      ]),
  );
  return {
    concurrency,
    requests: results.length,
    statuses,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.at(-1) ?? null,
    },
    retryAfterMissingOn429: results.filter(
      (result) => result.status === 429 && result.retryAfter === null,
    ).length,
  };
}

const runController = new AbortController();
const environmentProbe = await oneRequest(false, runController);
if (
  environmentProbe.status !== 503 ||
  !hasExpectedAttestation(environmentProbe)
) {
  throw new Error(
    "Credential-free Preview attestation failed; the canary token was not sent.",
  );
}
const authenticatedPreflight = await oneRequest(true, runController);
if (
  authenticatedPreflight.status !== 200 ||
  !hasExpectedAttestation(authenticatedPreflight)
) {
  throw new Error("Authenticated Preview readiness failed; no staged requests were sent.");
}

const stageResults = [];
for (const concurrency of stages) {
  stageResults.push(await runStage(concurrency, runController));
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      route: "/api/v3/thermal-anomalies",
      targetKind: "vercel-preview",
      zoom: Number(cell.split("/")[1]),
      pageType: continuationCursor === undefined ? "first" : "continuation",
      pageSize,
      requestsPerStage,
      totalRequests: stagedRequestCount + 2,
      stages: stageResults,
    },
    null,
    2,
  )}\n`,
);
