import assert from "node:assert/strict";
import test from "node:test";
import type { Queryable } from "../../lib/db/client.ts";
import { readThrough, readThroughThrowing } from "../../lib/db/read-through.ts";
import { newDb } from "./helpers.ts";

type Payload = { value: number; ok: boolean };

function upstream(payloads: Payload[]) {
  let calls = 0;
  return {
    fetch: async () => {
      const payload = payloads[calls] ?? payloads[payloads.length - 1];
      if (payload === undefined) throw new Error("no payload configured");
      calls += 1;
      return payload;
    },
    calls: () => calls,
  };
}

function options(db: Queryable | null, fetchUpstream: () => Promise<Payload>) {
  return {
    key: "test",
    ttlSeconds: 60,
    staleMaxSeconds: 600,
    fetchUpstream,
    upstreamOk: (p: Payload) => p.ok,
    status: (p: Payload) => (p.ok ? "ok" : "upstream-error"),
    snapshotSignature: (p: Payload) => [p.value],
    db,
  };
}

test("db: null is a pure passthrough (merge-before-DB guarantee)", async () => {
  const source = upstream([{ value: 1, ok: true }]);
  const result = await readThrough(options(null, source.fetch));
  assert.deepEqual(result.payload, { value: 1, ok: true });
  assert.equal(result.store.configured, false);
  assert.equal(result.store.servedFrom, "upstream");
  assert.equal(source.calls(), 1);
});

test("miss fetches upstream and writes; fresh hit skips upstream", async () => {
  const db = await newDb();
  const source = upstream([
    { value: 1, ok: true },
    { value: 2, ok: true },
  ]);

  const first = await readThrough(options(db, source.fetch));
  assert.equal(first.store.servedFrom, "upstream");
  assert.equal(source.calls(), 1);

  const second = await readThrough(options(db, source.fetch));
  assert.deepEqual(second.payload, { value: 1, ok: true });
  assert.equal(second.store.servedFrom, "store");
  assert.equal(source.calls(), 1);
  assert.ok(second.store.ageSeconds !== null && second.store.ageSeconds < 60);

  const snapshots = await db.query(
    "select count(*)::int as n from source_snapshots where source = 'test'",
  );
  assert.equal(snapshots.rows[0]?.n, 1);
});

test("expired cache + upstream failure serves store-stale within cap", async () => {
  const db = await newDb();
  const source = upstream([
    { value: 1, ok: true },
    { value: 0, ok: false },
  ]);

  await readThrough(options(db, source.fetch));
  await db.query(
    "update response_cache set stored_at = now() - interval '5 minutes'",
  );

  const result = await readThrough(options(db, source.fetch));
  assert.equal(source.calls(), 2);
  assert.deepEqual(result.payload, { value: 1, ok: true });
  assert.equal(result.store.servedFrom, "store-stale");
  assert.ok(result.store.ageSeconds !== null && result.store.ageSeconds >= 290);
});

test("stale beyond cap passes the upstream error payload through", async () => {
  const db = await newDb();
  const source = upstream([
    { value: 1, ok: true },
    { value: 0, ok: false },
  ]);

  await readThrough(options(db, source.fetch));
  await db.query(
    "update response_cache set stored_at = now() - interval '2 hours'",
  );

  const result = await readThrough(options(db, source.fetch));
  assert.deepEqual(result.payload, { value: 0, ok: false });
  assert.equal(result.store.servedFrom, "upstream");
});

test("a throwing store degrades to passthrough with error surfaced", async () => {
  const broken: Queryable = {
    query: async () => {
      throw new Error("connection refused");
    },
  };
  const source = upstream([{ value: 7, ok: true }]);
  const result = await readThrough(options(broken, source.fetch));
  assert.deepEqual(result.payload, { value: 7, ok: true });
  assert.equal(result.store.error, "unavailable");
  assert.equal(source.calls(), 1);
});

test("a missing schema surfaces not-initialized and still serves upstream", async () => {
  const db = await newDb();
  await db.exec("drop table response_cache");
  const source = upstream([{ value: 3, ok: true }]);
  const result = await readThrough(options(db, source.fetch));
  assert.deepEqual(result.payload, { value: 3, ok: true });
  assert.equal(result.store.error, "not-initialized");
});

test("skipStore prevents persisting placeholder payloads", async () => {
  const db = await newDb();
  const source = upstream([{ value: 0, ok: true }]);
  await readThrough({
    ...options(db, source.fetch),
    skipStore: (p) => p.value === 0,
  });
  assert.equal(await db.query("select count(*)::int as n from response_cache").then((r) => r.rows[0]?.n), 0);
});

test("snapshotPayload trims what lands in the snapshot log", async () => {
  const db = await newDb();
  const source = upstream([{ value: 9, ok: true }]);
  await readThrough({
    ...options(db, source.fetch),
    snapshotPayload: () => ({ trimmed: true }),
  });
  const row = await db.query(
    "select payload from source_snapshots where source = 'test'",
  );
  assert.deepEqual(row.rows[0]?.payload, { trimmed: true });
});

test("readThroughThrowing: fresh hit, stale-serve on throw, rethrow past cap", async () => {
  const db = await newDb();
  let mode: "ok" | "throw" = "ok";
  let calls = 0;
  const fetchUpstream = async () => {
    calls += 1;
    if (mode === "throw") throw new Error("board unavailable");
    return { status: "in-progress" };
  };
  const opts = {
    key: "fire-service-board",
    source: "fire-service-board",
    ttlSeconds: 300,
    staleMaxSeconds: 3600,
    fetchUpstream,
    snapshotSignature: (v: { status: string }) => v.status,
    db,
  };

  const first = await readThroughThrowing(opts);
  assert.equal(first.status, "in-progress");
  assert.equal(calls, 1);

  const second = await readThroughThrowing(opts);
  assert.equal(second.status, "in-progress");
  assert.equal(calls, 1);

  mode = "throw";
  await db.query(
    "update response_cache set stored_at = now() - interval '10 minutes'",
  );
  const third = await readThroughThrowing(opts);
  assert.equal(third.status, "in-progress");
  assert.equal(calls, 2);

  await db.query(
    "update response_cache set stored_at = now() - interval '2 hours'",
  );
  await assert.rejects(() => readThroughThrowing(opts), /board unavailable/);
});
