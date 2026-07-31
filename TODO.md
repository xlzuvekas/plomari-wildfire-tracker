# Feature TODO

Current focus: **UI & usability, mobile-first** — the primary user is someone
near the incident, on a phone, one-handed, in sunlight, possibly on a bad
connection.

## P0 — Field-critical (mobile first)

- [x] **"Where am I?" geolocation.** Requested only after an explicit tap;
  permission and availability errors are surfaced without leaving a background
  watch running. YOU marker + accuracy circle, readout
  with straight-line distance/bearing to the nearest satellite hotspot, the
  app-drawn archived road reference, and the incident reference. Never moves the
  map on a fix; "CENTER MAP ON ME" is an explicit button. Coordinates are not
  submitted to Firewatch, while the UI discloses that centering can request
  third-party map tiles near the resulting view.
- [x] **Safe-area fix.** `viewport-fit=cover` viewport export in `layout.tsx`
  so the existing `env(safe-area-inset-*)` CSS actually resolves on notched
  phones.
- [x] **New-alert notification.** New `actionRequired` wire items trigger a
  dismissible toast (tap → opens the item in the wire), a red badge on the
  UPDATES dock/toggle buttons, and vibration where supported. Every unseen item
  from later polls is retained in a queue; the newest current actionable item
  is surfaced on first load without replaying the older lookback.
- [x] **Offline resilience (PWA).** `app/manifest.ts` + PNG/SVG icons +
  `public/sw.js`: network-first for navigations and an explicit allowlist of the
  four public data endpoints. Cached data fallbacks are tagged and surfaced as
  stale snapshots; data storage is capped at 24 responses. `/_next/static` and
  basemap/overlay tiles remain cache-first (tiles capped at 400 entries).
  Registered in production builds only.
- [x] **Cache-preserving active polling.** Anonymous data GETs now use ordinary
  browser/CDN semantics instead of forcing `no-store`; hidden/offline tabs stop
  recurring polling, resume immediately when active, and guard against
  overlapping requests. Offline startup retains one service-worker snapshot
  read. A bounded `realtime=0` feed snapshot makes zero X API calls.
- [x] **Sunlight-readable text & map.** Raised every sub-10px font rule
  (0.42–0.6 rem → 0.6–0.66 rem floor), toned down extreme letter-spacing,
  brightened the basemap tile filters (satellite 0.66 → 0.9 brightness), and
  widened the sidebars (272→296 / 316→336 px) to compensate.

## P1 — Usability

- [ ] **Manual refresh + freshness indicator.** No refresh button exists;
  cadence is static text. Add pull-to-refresh or a refresh control with
  last-updated / next-poll in the header so users regain trust after a signal
  drop.
- [ ] **Surface feed errors globally.** Failures only show as chips inside the
  (closed-by-default on mobile) panels. Promote degraded feeds to a compact
  status strip or dock badges, and stop collapsing `unconfigured` vs
  `upstream-error` into one "UNAVAILABLE" label.
- [ ] **Shareable map state.** Sync base layer, active layers, thermal window,
  and position to the URL; add `navigator.share`. Reload currently resets
  everything.
- [ ] **Tame map-tap inspect.** Any tap opens the coordinate popup, fighting
  pan/tap on touch. Long-press-only on mobile, or a dedicated inspect mode.
- [x] **Single tabbed panel.** One left panel with Layers / Thermal / Wind /
  Updates tabs — the separate right-side updates panel is gone, freeing the
  whole right edge of the map (and unblocking the locate + zoom controls).
  The panel sizes to content on desktop so more map shows.
- [ ] **Single-language popups on mobile.** Popups and the evacuation banner
  render EN and EL simultaneously — the widest content on small screens.
  Respect the selected language on mobile; also verify `<html lang>` stays in
  sync (hardcoded `"en"` in layout, mutated client-side).
- [ ] **One-handed reachability.** Move key actions toward the dock; let the
  evacuation banner size itself instead of hardcoded `--mobile-alert` heights
  (174/184/194 px) against variable bilingual content. (Partially addressed:
  the banner is now collapsible to a small pill, persisted in localStorage.)

## P2 — Accessibility & polish

- [ ] **Bottom-sheet semantics.** Add a focus trap, Escape/swipe-to-close, and
  `role="dialog"`; tab/tabpanel keyboard semantics and desktop keyboard panel
  movement are implemented.
- [ ] **Don't encode by color alone.** Confidence legend and category badges
  differentiate only by hue — add shapes/text like the thermal dots do.
- [ ] **Heading structure.** `h1` is the only heading; panel titles are spans.
- [ ] **Landscape/short-viewport pass.** Desktop `min-height: 580px` +
  `overflow: hidden` can clip short viewports outside the 900px query.
- [ ] **Field micro-features.** Map scale control and larger desktop touch
  targets. (Hidden/offline polling is now paused.)

## Foundation (prerequisite for the bigger features)

- [ ] **Extract shared incident config.** Incident center/radius/start time are
  hardcoded in `app/page.tsx` and each API route. Move to `lib/incident.ts` —
  prerequisite for multi-incident support and template reuse.
- [ ] **Split `app/page.tsx` (~4,900 lines).** `lib/types.ts`, `lib/format.ts`,
  `lib/geo.ts` (destination, midpoint, distance/bearing, scenarioShape), and
  components for the dock, sheets, ribbon, and map. No behavior change.
- [x] **Add tests.** Vitest covers the route suites (thermal, updates, wind,
  fireservice), truth contracts and fixture replay, the CMR collector and
  production runtime, demand policy, and the service worker.
- [x] **CI.** GitHub Action runs lint, typecheck, the full test suite, and the
  production build, plus a database job (Supabase `db lint` + pgTAP) on pushes
  and pull requests.

## Larger features

- [ ] **Multi-incident / fire recognition — REQUIRED BEFORE PUBLIC LAUNCH.**
  The app currently hardcodes the Plomari incident (center, radius, start
  time, archived road-reference geometry, settlements, sources). A public release must
  recognize fires other than Plomari. Path:
  1. Extract the incident definition into `lib/incident.ts` (see Foundation).
  2. Parameterize the three API routes and the map by incident.
  3. Discover incidents instead of hardcoding: the Fire Service board already
     lists active incidents per municipality (the updates route scrapes it),
     and FIRMS regional detections can be clustered into incident candidates —
     combine the two into an incident list with a picker/landing view.
  4. Per-incident evacuation data stays manual/official-only (112 feed).
- [ ] **Historical playback.** Persist FIRMS snapshots (Postgres via
  docker-compose, or Vercel KV/blob) + timeline scrubber over the incident's
  life.
- [ ] **Measured air quality layer.** Open-Meteo Air Quality (PM2.5/PM10) as an
  observed/modeled-labeled complement.
- [ ] **Fire-weather indices.** Open-Meteo FWI fields as a modeled fire-danger
  panel.
- [ ] **Web Push for action-required items.** The in-app toast ships; true
  push while the app is closed needs the persistence layer above.
- [ ] **Replace steady-state X polling with X Activity API delivery.** After a
  narrow-write, idempotent Supabase ingest path exists, register one verified
  webhook and `post.create` subscriptions for the three official accounts.
  Keep the current five-minute, CDN-cached reads only as an incident-mode/failure
  fallback, add replay handling, and configure hard spend limits plus 50/80%
  usage alerts before enabling the webhook in production.
- [ ] **Post-incident burn-scar layer.** Sentinel-2 false-color via no-key WMTS
  once contained.
- [ ] **Structured i18n.** Move inline `localize()` pairs to message catalogs
  if a third language is ever wanted.
- [ ] **FIRMS key onboarding.** Dev-mode console hint linking to the NASA
  map-key form when thermal is `unconfigured`.
- [ ] **Voluntary project support.** Add Stripe Checkout or Payment Links using
  hosted payment pages only. Do not store card/payment data, and keep all
  operational alerts and safety features fully independent of donations.
