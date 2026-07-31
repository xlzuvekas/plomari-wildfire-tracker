import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const harnessUrl = new URL("../tools/load-thermal-v3.mjs", import.meta.url);
const harnessSource = readFileSync(harnessUrl, "utf8");
const CANARY_TOKEN = "t".repeat(43);
const PREVIEW_HOST = "firewatch-review-123.vercel.app";
const DEPLOYMENT_ID = `dpl_${"a".repeat(24)}`;
const BASE_ENVIRONMENT = {
  FIREWATCH_LOAD_ACK:
    `preview-read-model-only:${PREVIEW_HOST}:${DEPLOYMENT_ID}`,
  FIREWATCH_LOAD_TARGET_URL:
    `https://${PREVIEW_HOST}/api/v3/thermal-anomalies`,
  FIREWATCH_LOAD_EXPECTED_PREVIEW_HOST: PREVIEW_HOST,
  FIREWATCH_LOAD_EXPECTED_DEPLOYMENT_ID: DEPLOYMENT_ID,
  FIREWATCH_LOAD_PRODUCTION_HOSTS: "firewatch.example.com",
  FIREWATCH_LOAD_CANARY_TOKEN: CANARY_TOKEN,
  FIREWATCH_LOAD_CELL: "wm/10/587/391",
  FIREWATCH_LOAD_CONCURRENCY_STAGES: "1,2,4,8",
  FIREWATCH_LOAD_REQUESTS_PER_STAGE: "40",
} as const;

function runHarness(overrides: Readonly<Record<string, string>>) {
  return spawnSync(process.execPath, [fileURLToPath(harnessUrl)], {
    encoding: "utf8",
    env: { ...process.env, ...BASE_ENVIRONMENT, ...overrides },
    timeout: 2_000,
  });
}

describe("thermal v3 Preview-only load harness", () => {
  it.each([
    [
      "a Production denylist match",
      { FIREWATCH_LOAD_PRODUCTION_HOSTS: PREVIEW_HOST },
      "refuses an explicitly denied Production hostname",
    ],
    [
      "an acknowledgement not bound to the exact host",
      { FIREWATCH_LOAD_ACK: "preview-read-model-only" },
      "must acknowledge the exact expected Preview hostname",
    ],
    [
      "a non-default HTTPS port",
      {
        FIREWATCH_LOAD_TARGET_URL:
          `https://${PREVIEW_HOST}:444/api/v3/thermal-anomalies`,
      },
      "must be an exact Vercel Preview thermal-v3 URL",
    ],
    [
      "a non-increasing stage list",
      { FIREWATCH_LOAD_CONCURRENCY_STAGES: "1,2,2,4" },
      "strictly increasing stages",
    ],
    [
      "an oversized page",
      { FIREWATCH_LOAD_PAGE_SIZE: "101" },
      "must be an integer from 1 through 100",
    ],
    [
      "a continuation without bound cutoffs",
      { FIREWATCH_LOAD_AFTER: `a.${"b".repeat(43)}` },
      "requires its cursor-bound asOf and knownAt",
    ],
    [
      "more than 1000 total requests",
      {
        FIREWATCH_LOAD_CONCURRENCY_STAGES: "1,2,3,4,5,6,7,8",
        FIREWATCH_LOAD_REQUESTS_PER_STAGE: "125",
      },
      "including preflights, at 1000 requests",
    ],
  ])("fails before network access for %s", (_label, overrides, message) => {
    const result = runHarness(overrides);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(message);
    expect(output).not.toContain(CANARY_TOKEN);
    expect(output).not.toContain("wm/10/587/391");
  });

  it("attests without credentials before sending the bearer", () => {
    expect(harnessSource).toContain(
      "if (authenticated)",
    );
    expect(harnessSource).toMatch(
      /response\.headers\.get\(\s*"x-firewatch-deployment-environment"/u,
    );
    expect(harnessSource).toContain(
      'response.headers.get("x-firewatch-deployment-host")',
    );
    expect(harnessSource).toContain(
      'response.headers.get("x-firewatch-deployment-id")',
    );
    expect(harnessSource).toContain(
      "const environmentProbe = await oneRequest(false, runController)",
    );
    expect(harnessSource).toMatch(
      /const environmentProbe[\s\S]*?const authenticatedPreflight = await oneRequest\(true,[\s\S]*?const stageResults = \[\];/u,
    );
    expect(harnessSource.indexOf("const environmentProbe")).toBeLessThan(
      harnessSource.indexOf("const authenticatedPreflight"),
    );
  });

  it("bounds bodies and re-attests every staged response", () => {
    expect(harnessSource).toContain("const MAX_RESPONSE_BYTES = 1_050_000");
    expect(harnessSource).not.toContain("response.arrayBuffer()");
    expect(harnessSource).toContain(
      "receivedBytes > MAX_RESPONSE_BYTES",
    );
    expect(harnessSource).toContain(
      "results.some((result) => !hasExpectedAttestation(result))",
    );
    expect(harnessSource).toContain("runController.abort()");
  });

  it("supports bounded worst-case and cursor-bound continuation reads", () => {
    expect(harnessSource).toContain(
      'process.env.FIREWATCH_LOAD_PAGE_SIZE ?? "100"',
    );
    expect(harnessSource).toContain(
      'url.searchParams.set("after", continuationCursor)',
    );
    expect(harnessSource).toContain(
      'pageType: continuationCursor === undefined ? "first" : "continuation"',
    );
  });
});
