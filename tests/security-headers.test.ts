import { describe, expect, it } from "vitest";

import nextConfig, { SECURITY_HEADERS } from "../next.config";

function headerValue(key: string) {
  const header = SECURITY_HEADERS.find((entry) => entry.key === key);
  if (!header) throw new Error(`Missing security header: ${key}`);
  return header.value;
}

describe("security headers", () => {
  it("applies the security header set to every path", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toBeDefined();
    expect(rules?.at(-1)?.source).toBe("/(.*)");
    expect(rules?.at(-1)?.headers).toEqual(SECURITY_HEADERS);
  });

  it("locks framing, sniffing, referrers, and powerful features", () => {
    expect(headerValue("X-Frame-Options")).toBe("DENY");
    expect(headerValue("X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue("Referrer-Policy")).toBe("no-referrer");
    expect(headerValue("Strict-Transport-Security")).toContain("max-age=");
    expect(headerValue("Permissions-Policy")).toContain("geolocation=(self)");
    expect(headerValue("Permissions-Policy")).toContain("camera=()");
  });

  it("restricts the content-security-policy to self plus the tile providers", () => {
    const csp = headerValue("Content-Security-Policy");
    const directives = new Map(
      csp.split(";").map((directive) => {
        const [name, ...values] = directive.trim().split(/\s+/u);
        return [name, values] as const;
      }),
    );

    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("worker-src")).toEqual(["'self'"]);
    expect(directives.has("upgrade-insecure-requests")).toBe(true);

    for (const source of ["img-src", "connect-src"] as const) {
      const values = directives.get(source) ?? [];
      expect(values).toContain("'self'");
      expect(values).toContain("https://gibs.earthdata.nasa.gov");
      expect(values).toContain("https://*.basemaps.cartocdn.com");
      expect(values).toContain("https://server.arcgisonline.com");
      expect(values).toContain("https://services.arcgisonline.com");
      expect(values).toContain("https://*.tile.opentopomap.org");
      // No plaintext or wildcard-everything sources.
      expect(values.some((value) => value.startsWith("http:"))).toBe(false);
      expect(values).not.toContain("*");
    }
  });
});
