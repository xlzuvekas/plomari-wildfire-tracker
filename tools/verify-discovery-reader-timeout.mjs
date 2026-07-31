import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";

import postgres from "postgres";

const PROBE_NAME = "firewatch_discovery_timeout_probe";
const EXPECTED_TIMEOUT_MS = 4_000;
const MINIMUM_EXPECTED_ELAPSED_MS = 3_000;
const MAXIMUM_EXPECTED_ELAPSED_MS = 6_500;

function fail(message) {
  throw new Error(`Discovery-reader timeout verification failed: ${message}`);
}

function localStatus() {
  const raw = execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const status = JSON.parse(raw);
  for (const key of ["API_URL", "DB_URL", "ANON_KEY", "JWT_SECRET"]) {
    if (typeof status[key] !== "string" || status[key].length === 0) {
      fail(`local Supabase status omitted ${key}`);
    }
  }
  return status;
}

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function roleToken(secret) {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      role: "firewatch_discovery_reader",
      iss: "supabase-demo",
      iat: nowSeconds - 5,
      exp: nowSeconds + 300,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(unsigned, "ascii")
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const status = localStatus();
  const sql = postgres(status.DB_URL, {
    max: 1,
    prepare: false,
    idle_timeout: 2,
    connect_timeout: 5,
  });

  try {
    const [role] = await sql`
      select rolconfig
      from pg_catalog.pg_roles
      where rolname = 'firewatch_discovery_reader'
    `;
    if (
      !Array.isArray(role?.rolconfig) ||
      !role.rolconfig.includes("statement_timeout=4s")
    ) {
      fail("firewatch_discovery_reader does not have statement_timeout=4s");
    }

    await sql.unsafe(`
      create or replace function api.${PROBE_NAME}()
      returns boolean
      language plpgsql
      volatile
      security invoker
      set search_path = ''
      as $probe$
      begin
        perform pg_catalog.pg_sleep(8);
        return true;
      end;
      $probe$;

      revoke execute on function api.${PROBE_NAME}()
      from public, anon, authenticated, service_role;
      grant execute on function api.${PROBE_NAME}()
      to firewatch_discovery_reader;
      notify pgrst, 'reload schema';
    `);

    const endpoint = new URL(
      `/rest/v1/rpc/${PROBE_NAME}`,
      status.API_URL,
    );
    const token = roleToken(status.JWT_SECRET);
    let response;
    let body;
    let elapsedMs;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const startedAt = performance.now();
      response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          apikey: status.ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(7_000),
      });
      elapsedMs = performance.now() - startedAt;
      body = await response.json();
      if (body?.code !== "PGRST202") break;
      await wait(250);
    }

    if (body?.code !== "57014") {
      fail(`expected SQLSTATE 57014, received ${String(body?.code)}`);
    }
    if (response?.ok) fail("over-budget probe returned a success response");
    if (
      elapsedMs < MINIMUM_EXPECTED_ELAPSED_MS ||
      elapsedMs > MAXIMUM_EXPECTED_ELAPSED_MS
    ) {
      fail(`cancellation arrived outside budget (${Math.round(elapsedMs)}ms)`);
    }

    await wait(250);
    const [activity] = await sql`
      select count(*)::integer as active_count
      from pg_catalog.pg_stat_activity
      where pid <> pg_catalog.pg_backend_pid()
        and state = 'active'
        and query like ${`%${PROBE_NAME}%`}
    `;
    if (activity?.active_count !== 0) {
      fail("timed-out PostgREST work remained active in PostgreSQL");
    }

    process.stdout.write(
      `Verified PostgREST role timeout: SQLSTATE 57014 in ${Math.round(elapsedMs)}ms; no active probe remained.\n`,
    );
  } finally {
    try {
      await sql.unsafe(`
        drop function if exists api.${PROBE_NAME}();
        notify pgrst, 'reload schema';
      `);
    } finally {
      await sql.end({ timeout: 2 });
    }
  }
}

await main();

export { EXPECTED_TIMEOUT_MS };
