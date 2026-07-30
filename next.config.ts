import type { NextConfig } from "next";

// Third-party hosts the map legitimately loads raster tiles / WMS imagery from.
// Keep this in sync with BASEMAPS and the GIBS WMS layers in app/page.tsx.
const TILE_IMAGE_HOSTS = [
  "https://*.basemaps.cartocdn.com", // CARTO dark basemap
  "https://server.arcgisonline.com", // Esri World Imagery
  "https://*.tile.opentopomap.org", // OpenTopoMap terrain
  "https://gibs.earthdata.nasa.gov", // NASA GIBS thermal / aerosol WMS
];

// A public-facing safety tool should ship a restrictive, explicit policy.
// 'unsafe-inline' is required for styles (Leaflet injects inline styles) and
// for Next.js' inline hydration/runtime scripts, which are not nonce-tagged
// in this app. Everything else is locked to same-origin plus the tile hosts.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILE_IMAGE_HOSTS.join(" ")}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
]
  .join("; ")
  .concat(";");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // The app intentionally does no geolocation, camera, mic, or payment access.
  {
    key: "Permissions-Policy",
    value: "geolocation=(), camera=(), microphone=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
