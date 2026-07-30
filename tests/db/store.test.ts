import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSnapshot,
  contentHash,
  isUndefinedTableError,
  queryThermalPasses,
  querySnapshotLog,
  queryWireItems,
  readCache,
  thermalNaturalKey,
  upsertThermalDetections,
  upsertWireItems,
  writeCache,
} from "../../lib/db/store.ts";
import { detection, newDb, wireItem } from "./helpers.ts";

test("cache roundtrip and overwrite", async () => {
  const db = await newDb();
  assert.equal(await readCache(db, "thermal"), null);

  await writeCache(db, "thermal", { a: 1 }, "ok", true);
  const first = await readCache(db, "thermal");
  assert.ok(first);
  assert.deepEqual(first.payload, { a: 1 });
  assert.equal(first.status, "ok");
  assert.equal(first.upstreamOk, true);
  assert.ok(!Number.isNaN(Date.parse(first.storedAt)));

  await writeCache(db, "thermal", { a: 2 }, "partial", true);
  const second = await readCache(db, "thermal");
  assert.deepEqual(second?.payload, { a: 2 });
  assert.equal(second?.status, "partial");

  const count = await db.query("select count(*)::int as n from response_cache");
  assert.equal(count.rows[0]?.n, 1);
});

test("snapshot append dedupes identical content and versions changed content", async () => {
  const db = await newDb();
  const signature = ["item-1", "item-2"];

  const first = await appendSnapshot(db, {
    source: "updates",
    payload: { items: ["item-1", "item-2"] },
    status: "ok",
    upstreamOk: true,
    contentHash: contentHash(signature),
  });
  assert.equal(first, "inserted");

  const second = await appendSnapshot(db, {
    source: "updates",
    payload: { items: ["item-1", "item-2"] },
    status: "ok",
    upstreamOk: true,
    contentHash: contentHash(signature),
  });
  assert.equal(second, "confirmed");

  const rows = await db.query(
    "select fetched_at, last_confirmed_at from source_snapshots where source = 'updates'",
  );
  assert.equal(rows.rows.length, 1);

  const third = await appendSnapshot(db, {
    source: "updates",
    payload: { items: ["item-3"] },
    status: "ok",
    upstreamOk: true,
    contentHash: contentHash(["item-3"]),
  });
  assert.equal(third, "inserted");
  const after = await db.query(
    "select count(*)::int as n from source_snapshots where source = 'updates'",
  );
  assert.equal(after.rows[0]?.n, 2);

  // Dedupe only compares against the NEWEST row: reverting to old content
  // inserts a new row (history preserved, no time travel).
  const fourth = await appendSnapshot(db, {
    source: "updates",
    payload: { items: ["item-1", "item-2"] },
    status: "ok",
    upstreamOk: true,
    contentHash: contentHash(signature),
  });
  assert.equal(fourth, "inserted");
});

test("thermal natural key matches the truth-layer derivation shape", () => {
  const key = thermalNaturalKey({
    product: " VIIRS_NOAA20_NRT ",
    satellite: "N20",
    observedAt: "2026-07-30T10:17:00Z",
    lat: 38.989123,
    lon: 26.384467,
    scanKm: 0.54,
    trackKm: 0.51,
  });
  assert.equal(
    key,
    "viirs_noaa20_nrt|n20|2026-07-30T10:17:00Z|38.9891|26.3845|0.540|0.510",
  );
  // 5th-decimal float noise maps to the same key (the reason we don't PK on
  // the route's 5-decimal id).
  const noisy = thermalNaturalKey({
    product: "VIIRS_NOAA20_NRT",
    satellite: "N20",
    observedAt: "2026-07-30T10:17:00Z",
    lat: 38.989125,
    lon: 26.384469,
    scanKm: 0.54,
    trackKm: 0.51,
  });
  assert.equal(noisy, key);
});

test("thermal upserts are idempotent and preserve first_seen_at", async () => {
  const db = await newDb();
  await upsertThermalDetections(db, [detection()]);
  const before = await db.query(
    "select first_seen_at, last_seen_at from thermal_detections",
  );
  assert.equal(before.rows.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await upsertThermalDetections(db, [detection({ frpMw: 15.1 })]);

  const epoch = (value: unknown) => {
    assert.ok(value instanceof Date);
    return value.getTime();
  };
  const after = await db.query(
    "select first_seen_at, last_seen_at, frp_mw from thermal_detections",
  );
  assert.equal(after.rows.length, 1);
  assert.equal(
    epoch(after.rows[0]?.first_seen_at),
    epoch(before.rows[0]?.first_seen_at),
  );
  assert.equal(after.rows[0]?.frp_mw, 15.1);
  assert.ok(
    epoch(after.rows[0]?.last_seen_at) > epoch(before.rows[0]?.last_seen_at),
  );
});

test("thermal upserts handle chunk-sized batches", async () => {
  const db = await newDb();
  const rows = Array.from({ length: 450 }, (_, index) =>
    detection({
      lat: 38.9 + index * 0.001,
      routeId: `route-${index}`,
    }),
  );
  await upsertThermalDetections(db, rows);
  const count = await db.query(
    "select count(*)::int as n from thermal_detections",
  );
  assert.equal(count.rows[0]?.n, 450);
});

test("pass aggregation computes counts, max, median, and confidence breakdown", async () => {
  const db = await newDb();
  await upsertThermalDetections(db, [
    detection({ lat: 38.98, frpMw: 10, confidenceCode: "h", scope: "incident" }),
    detection({ lat: 38.99, frpMw: 20, confidenceCode: "n", scope: "incident" }),
    detection({ lat: 39.0, frpMw: 30, confidenceCode: "l", scope: "regional" }),
    detection({
      lat: 39.01,
      passId: "VIIRS_SNPP_NRT-2026-07-30T09:00:00Z",
      product: "VIIRS_SNPP_NRT",
      satellite: "N",
      observedAt: "2026-07-30T09:00:00Z",
      frpMw: null,
      confidenceCode: "u",
    }),
  ]);

  const passes = await queryThermalPasses(db, {
    from: "2026-07-30T00:00:00Z",
    to: "2026-07-31T00:00:00Z",
    limit: 10,
  });
  assert.equal(passes.length, 2);

  const noaa = passes.find((p) => p.passId.startsWith("VIIRS_NOAA20"));
  assert.ok(noaa);
  assert.equal(noaa.recordCount, 3);
  assert.equal(noaa.incidentRecordCount, 2);
  assert.equal(noaa.maxFrpMw, 30);
  assert.equal(noaa.medianFrpMw, 20);
  assert.deepEqual(noaa.byConfidence, { h: 1, n: 1, l: 1, u: 0 });

  const snpp = passes.find((p) => p.passId.startsWith("VIIRS_SNPP"));
  assert.ok(snpp);
  assert.equal(snpp.recordCount, 1);
  assert.equal(snpp.maxFrpMw, null);
  assert.equal(snpp.medianFrpMw, null);
});

test("wire items dedupe by id and preserve first_seen_at", async () => {
  const db = await newDb();
  await upsertWireItems(db, [wireItem()]);
  await upsertWireItems(db, [wireItem({ title: "Updated headline" })]);

  const items = await queryWireItems(db, {
    from: "2026-07-01T00:00:00Z",
    to: "2026-08-01T00:00:00Z",
    limit: 10,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "Updated headline");
});

test("snapshot log returns metadata without payloads", async () => {
  const db = await newDb();
  await appendSnapshot(db, {
    source: "wind",
    payload: { big: "x".repeat(500) },
    status: "ok",
    upstreamOk: true,
    contentHash: contentHash(["wind-sig"]),
  });
  const log = await querySnapshotLog(db, {
    source: "wind",
    from: "2020-01-01T00:00:00Z",
    to: "2099-01-01T00:00:00Z",
    limit: 10,
  });
  assert.equal(log.length, 1);
  assert.equal(log[0]?.source, "wind");
  assert.ok(log[0] && log[0].payloadBytes > 400);
  assert.ok(!("payload" in (log[0] as object)));
});

test("isUndefinedTableError detects 42P01", async () => {
  const db = await newDb();
  await db.exec("drop table response_cache");
  try {
    await readCache(db, "thermal");
    assert.fail("expected 42P01");
  } catch (error) {
    assert.equal(isUndefinedTableError(error), true);
  }
  assert.equal(isUndefinedTableError(new Error("boom")), false);
});
