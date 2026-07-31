import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import nextConfig, {
  MAPLIBRE_WORKER_HEADER_RULES,
} from "../next.config";

const VERSION = "6.1.0";
const PUBLIC_ROOT = new URL(
  `../public/vendor/maplibre-gl/${VERSION}/`,
  import.meta.url,
);
const PACKAGE_ROOT = new URL("../node_modules/maplibre-gl/", import.meta.url);
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const JAVASCRIPT_MIME = "application/javascript; charset=utf-8";

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8"));
}

function valueFor(
  headers: ReadonlyArray<Readonly<{ key: string; value: string }>>,
  key: string,
): string | undefined {
  return headers.find((header) => header.key === key)?.value;
}

describe("version-pinned MapLibre worker assets", () => {
  it("vendors exact MapLibre 6.1.0 bytes and its license", () => {
    const packageMetadata = readJson(
      new URL("package.json", PACKAGE_ROOT),
    ) as { version?: unknown };
    expect(packageMetadata.version).toBe(VERSION);

    for (const [publicName, packagePath] of [
      ["maplibre-gl-worker.mjs", "dist/maplibre-gl-worker.mjs"],
      ["maplibre-gl-shared.mjs", "dist/maplibre-gl-shared.mjs"],
      ["LICENSE.txt", "LICENSE.txt"],
    ] as const) {
      expect(readFileSync(new URL(publicName, PUBLIC_ROOT))).toEqual(
        readFileSync(new URL(packagePath, PACKAGE_ROOT)),
      );
    }

    expect(
      readFileSync(new URL("maplibre-gl-worker.mjs", PUBLIC_ROOT), "utf8"),
    ).toContain('from"./maplibre-gl-shared.mjs"');
  });

  it("serves both module files with exact immutable caching and JavaScript MIME headers", async () => {
    expect(MAPLIBRE_WORKER_HEADER_RULES.map((rule) => rule.source)).toEqual([
      `/vendor/maplibre-gl/${VERSION}/maplibre-gl-worker.mjs`,
      `/vendor/maplibre-gl/${VERSION}/maplibre-gl-shared.mjs`,
    ]);

    for (const rule of MAPLIBRE_WORKER_HEADER_RULES) {
      expect(valueFor(rule.headers, "Cache-Control")).toBe(IMMUTABLE_CACHE);
      expect(valueFor(rule.headers, "Content-Type")).toBe(JAVASCRIPT_MIME);
    }

    const rules = await nextConfig.headers?.();
    expect(rules?.slice(0, 2)).toEqual(MAPLIBRE_WORKER_HEADER_RULES);
  });
});
