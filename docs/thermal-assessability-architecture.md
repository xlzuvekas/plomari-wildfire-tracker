# Thermal assessability evidence

Status: private foundation only. No collector, schedule, public API state, map
marker transition, incident resolution, notification, or all-clear is enabled by
this design.

## Why an empty FIRMS response is insufficient

The FIRMS Area CSV collector proves that four bounded product requests completed,
their response bytes were recorded, and every returned row was accepted or
rejected with lineage. It does not prove that a later satellite pass covered the
original pixel, that the sensor could assess the whole modeled support area, or
that cloud, missing data, bow-tie deletion, sun glint, and invalid geolocation did
not obscure it. CMR granule footprints are catalog metadata and likewise do not
assess pixel contents.

Accordingly, `ingest.firms_query_completions.negative_assessment_eligible`
remains false. Neither an empty FIRMS query nor a CMR footprint may clear,
resolve, hide, or recolor a detection.

## Evidence required for a future pass-bounded assessment

The VIIRS Collection 2 375 m active-fire product provides a two-dimensional
`fire mask` and matching per-pixel `algorithm QA` array. Firewatch must pair that
asset with the exact image-resolution geolocation asset for the same platform
and granule:

| FIRMS product | Platform | FireMask asset / `VersionID` | Geolocation asset / `VersionID` | FireMask geolocation-reference attribute |
| --- | --- | --- | --- | --- |
| `VIIRS_SNPP_NRT` | Suomi-NPP | `VNP14IMG` / `002` | `VNP03IMG` / `002` | `VNP03IMG` |
| `VIIRS_NOAA20_NRT` | NOAA-20 | `VJ114IMG` / `002` | `VJ103IMG` / `021` | `VJ103IMG` |
| `VIIRS_NOAA21_NRT` | NOAA-21 | `VJ214IMG` / `002` | `VJ203IMG` / `021` | `VJ203IMG` |

The pair contract must retain, separately for the FireMask and geolocation
assets, each source-local granule ID, exact `VersionID`, observation interval,
applicable algorithm version, PGE/process versions, exact response occurrence,
and content hash. It also pins the exact CMR footprint encoding. Legacy CMR rows
whose encoding was not persisted remain ineligible, and an UMM-G
`BoundingRectangle` is never interchangeable with a `GPolygon`: rectangle
north/south coordinates are bounds, not great-circle edges. Only an explicitly
persisted `umm-g-gpolygon` may satisfy the catalog-coverage gate. The two local
IDs must be distinct. FireMask collection
`002` is paired with geolocation collection `002` for Suomi-NPP and `021` for
NOAA-20 and NOAA-21; collapsing these values to a shared major version would
discard evidence needed to prove the match.

The FireMask `InputPointer` is also retained exactly as source metadata. It is
a comma-separated list that can contain full paths to several inputs, so it
must not be normalized to or compared as though it were one LocalGranuleID.
Instead, the platform-specific FireMask metadata attribute named in the table
(`VNP03IMG`, `VJ103IMG`, or `VJ203IMG`) must equal the persisted geolocation
`LocalGranuleID` exactly. Product, platform, exact versions, and both observation
intervals must match the reviewed pairing rules. Both filenames' UTC acquisition
date and minute tokens must also match the independently persisted CMR interval,
preventing a mutually consistent pair from being attached to a different pass.
Contract `0.1.0-internal` accepts only the six-segment
`PRODUCT.AYYYYDDD.HHMM.VERSION.PRODUCED.nc` filename form used by the reviewed
standard/reprocessed LAADS assets. NRT asset-delivery names require a separate,
explicitly versioned grammar and may not be admitted by broadening this one.
The adapter and assessment-rule identifiers and versions are immutable evidence
as well. Large NetCDF/HDF5 assets belong in private, content-addressed object
storage; database rows retain their hashes and lineage. Downloads and parsing
must happen in a bounded worker, outside a database transaction and outside a
browser or request-time route.

NASA defines FireMask classes 0–9 as not processed, bow-tie deletion, sun glint,
water, cloud, land, unclassified, and low/nominal/high-confidence fire pixels.
Firewatch must retain the immutable source assets containing the raw per-pixel
values, then derive counts from those values rather than accepting aggregate QA
claims from a caller. A single reviewed decoder invocation is hard-limited to
100,000 pixels, and the persisted pixel accounting enforces the same bound. The
decoder applies the exact reviewed masks:
algorithm-QA bits 0–6 (`0x7f`) and geolocation-invalid bits 0–2 (`0x07`). A
pixel is nominal only when
`(algorithm_qa & 0x7f) = 0`, and its geolocation is valid only when
`(geolocation_quality & 0x07) = 0`. Latitude and longitude must also be non-fill,
finite values with latitude in `[-90, 90]` and longitude in `[-180, 180]`.
The exact source-declared latitude and longitude `_FillValue` attributes must be
persisted separately with the geolocation asset's immutable raw-object lineage.
The pinned `VNP03IMG`, `VJ103IMG`, and `VJ203IMG` coordinate arrays are Float32,
so the contract accepts only that storage type and retains each decoded finite
Float32 value with its exact eight-character, lowercase, big-endian IEEE-754
bits. Float64 claims fail closed. The decoder and stored assessment must use
those persisted values rather than caller-authored or inferred defaults.
Firewatch's first rule is intentionally stricter than the source product:

- any fire class (7–9) yields `fire_returned`;
- an internal `no_firemask_class_candidate` requires at least one intersecting
  pixel, valid geolocation for every assessed pixel, nominal algorithm QA for
  every assessed pixel, and only water or land classes (3 or 5). The name means
  literally that no FireMask class 7–9 was observed in that assessed pass; it
  never means "no fire";
- not processed, bow-tie, sun glint, cloud, unclassified, invalid geolocation,
  non-nominal QA, missing support coverage, or mixed/invalid accounting remains
  `indeterminate`.

The future public state, if separately reviewed and versioned, can only say that
one earlier thermal pixel was not re-detected in one later complete assessable
pass. It can never mean no fire, fire out, containment, incident resolution,
area safety, official status, protective guidance, or an all-clear.

## Temporal and spatial gates

A future reconciler must prove all of the following before it can append a
pass-bounded assessment:

1. The FireMask and geolocation assets are the reviewed pair for the original
   detection's platform and product, and their CMR row explicitly retains an
   `umm-g-gpolygon` footprint source. Missing legacy provenance or a UMM-G
   bounding rectangle fails closed.
2. Because FIRMS `acquired_at` is minute-precision, the later pass starts at or
   after the inclusive boundary `acquired_at + interval '1 minute'`; a timestamp
   later within the same source minute does not establish a later pass.
3. The worker persists the footprint union of the geolocated assessed pixels and
   the canonical modeled support as immutable WGS84 geography evidence.
   The coverage predicate must use a globally safe, geography-aware method that
   handles the antimeridian and polar regions; a naive planar longitude/latitude
   comparison is not authoritative. Worker-supplied coverage topology is checked
   in a local gnomonic projection centered on the server-owned detection. Each
   CMR-to-canonical and assessed-to-canonical pair is transformed into that same
   local CRS for the authoritative coverage predicate. PostGIS geography uses
   spherical great-circle polygon edges; the matching spherical gnomonic
   projection maps those edges to straight lines without vertex expansion and
   avoids known polar and antimeridian edge cases in longitude/latitude and
   spherical predicates. RFC 7946 footprints split into MultiPolygon parts at
   `+180/-180` are accepted only after every projected polygon component validates
   independently; their coincident seam is then dissolved before coverage is
   evaluated. Malformed components and inputs outside the local projection domain
   fail closed.
   Only persisted operands evaluated by PostGIS may establish complete support
   coverage. A CMR catalog footprint,
   centroid intersection, requested API bounding box, or unpersisted in-memory
   calculation is insufficient.
4. Every intersecting pixel passes the conservative mask, QA, and geolocation
   rule above.
5. Asset retrieval, parsing, and assessment evidence were recorded before the
   assessment's knowledge cutoff.
6. The rule identifier and version, pixel accounting, source limitations, and
   exact evidence foreign keys are retained.

Spatial evaluation occurs once when immutable evidence is written. A future
read projection must join the selected assessment's exact evidence ID and its
persisted assessed-pixel coverage union; it must not repeat an unbounded spatial
search on every request.

The TypeScript decoder is deliberately not allowed to accept a caller-authored
"coverage complete" boolean or emit `no_firemask_class_candidate`. It derives
pixel classes and QA/geolocation counts from source-bound raw pixel fields; only
a generated SQL expression may derive the conservative internal candidate after
PostGIS verifies persisted, global-safe coverage. This SQL-only authority is
default-off and cannot be enabled by a runtime flag, worker input, or TypeScript
result.

All catalog objects, collection, parsing, and assessment writes remain disabled
by default and private. No outcome carries negative-assessment, official-status,
protective-action, incident-resolution, notification, or all-clear authority.
This foundation must not alter any public or v3 API behavior; any public state
requires a separately reviewed and versioned v4 design.

## Activation sequence

1. Merge and deploy the private schema and rule contract with every new catalog
   object disabled and unreviewed.
2. Confirm applicable NASA Earthdata/LAADS access terms and EULAs manually.
3. Implement a least-privileged worker that records both asset responses before
   parsing and refuses unpaired, truncated, oversized, or version-mismatched
   assets. Before enabling it, revise CMR persistence to retain the parser's
   exact `footprintSource`; do not backfill legacy nulls by inference.
4. Validate one sanitized or manually selected granule in shadow mode, including
   cloud, missing-data, bow-tie, glint, fire, and valid land/water fixtures.
5. Review query plans, storage retention, cost limits, source health, alerts,
   rotation, and rollback.
6. Only then design a separate v4 public projection and UI state. Keep v3 frozen
   so old strict clients never receive a new enum value.

## Primary references

- [NASA VIIRS Collection 2 375 m Active Fire Product User's Guide, version 1.2](https://www.earthdata.nasa.gov/s3fs-public/2025-06/VIIRS_C2_AF-375m_User_Guide_1.2.pdf)
- [NASA LAADS VNP14IMG Collection 2 product page](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP14IMG)
- [NASA LAADS VNP14IMG Collection 2 metadata example (`InputPointer` and `VNP03IMG`)](https://ladsweb.modaps.eosdis.nasa.gov/opendap/RemoteResources/laads/allData/5200/VNP14IMG/2012/143/VNP14IMG.A2012143.1354.002.2024006163518.nc.dmr.html)
- [NASA LAADS VNP03IMG Collection 2 product page](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP03IMG)
- [NASA LAADS VJ114IMG Collection 2 product page](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VJ114IMG)
- [NASA LAADS VJ103IMG Collection 2.1 product page](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VJ103IMG)
- [NASA LAADS VJ214IMG Collection 2 product page](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VJ214IMG)
- [NASA LAADS VJ203IMG Collection 2.1 product page](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VJ203IMG)
- [NASA Earthdata UMM-G 1.6.7 schema](https://git.earthdata.nasa.gov/projects/EMFD/repos/unified-metadata-model/browse/granule/v1.6.7/umm-g-json-schema.json)
- [PostGIS `ST_Transform` custom gnomonic polar example](https://postgis.net/docs/manual-3.4/en/ST_Transform.html)
- [PostGIS geography great-circle edge example](https://postgis.net/workshops/postgis-intro/geography_exercises.html)
- [PROJ gnomonic projection reference](https://proj.org/en/stable/operations/projections/gnom.html)
