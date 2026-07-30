import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const KNOWN_DIRECT_FETCH_COUNTS = new Map([
  ["app/api/thermal/route.ts", 1],
  ["app/api/updates/route.ts", 2],
  ["app/api/wind/route.ts", 1],
  // Browser calls below are to Firewatch's own routes, not upstream providers.
  ["app/page.tsx", 3],
]);

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(absolute);
    return /\.tsx?$/u.test(entry.name)
      ? [relative(REPOSITORY_ROOT, absolute)]
      : [];
  });
}

describe("upstream evidence boundary", () => {
  it("keeps the legacy direct-fetch inventory explicit and prevents expansion", () => {
    const actual = new Map(
      ["app", "lib"]
        .flatMap((directory) =>
          productionTypeScriptFiles(join(REPOSITORY_ROOT, directory)),
        )
        .map((path) => [path, source(path).match(/\bfetch\s*\(/gu)?.length ?? 0] as const)
        .filter(([, count]) => count > 0),
    );

    expect(actual).toEqual(KNOWN_DIRECT_FETCH_COUNTS);
  });

  it("requires new high-impact adapters to receive an evidence transport", () => {
    const openRouter = source("lib/assist/openrouter.ts");
    const cmr = source("lib/satellite/cmr.ts");
    const recordedFetch = source("lib/evidence/recorded-fetch.ts");

    expect(openRouter).toContain("fetchImpl: typeof fetch");
    expect(openRouter).not.toContain("fetchImpl?: typeof fetch");
    expect(openRouter).not.toMatch(/\?\?\s*fetch\b/u);
    expect(cmr).not.toMatch(/\bfetch\s*\(/u);
    expect(recordedFetch).toContain("fetchImpl: typeof fetch");
    expect(recordedFetch).not.toMatch(/\?\?\s*fetch\b/u);
  });
});
