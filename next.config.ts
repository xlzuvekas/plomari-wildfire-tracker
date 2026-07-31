import type { NextConfig } from "next";

// Every third-party host the browser (or the service worker on its behalf)
// loads map imagery from. Keep in sync with BASEMAPS in app/page.tsx, the
// GIBS overlay URLs there, and TILE_HOSTS in public/sw.js.
const TILE_HOSTS = [
  "https://*.basemaps.cartocdn.com",
  "https://server.arcgisonline.com",
  "https://services.arcgisonline.com",
  "https://*.tile.opentopomap.org",
  "https://gibs.earthdata.nasa.gov",
].join(" ");

// script-src/style-src keep 'unsafe-inline' because the page is statically
// prerendered: Next emits inline bootstrap scripts and React renders inline
// style attributes, and a nonce-based policy would force dynamic per-request
// rendering. The app renders no upstream-controlled HTML.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILE_HOSTS}`,
  `connect-src 'self' ${TILE_HOSTS}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
