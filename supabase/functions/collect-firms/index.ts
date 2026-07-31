import { withSupabase } from "@supabase/server";
import postgres, { type Sql } from "postgres";
import type {
  CollectorDatabase,
  DatabaseRow,
  DatabaseSession,
} from "./database.ts";
import { validateFirmsDatabaseUrl } from "./connection.ts";
import { createFirmsEdgeHandler } from "./runtime.ts";

type RuntimeGlobal = typeof globalThis & {
  Deno?: { env?: { get(name: string): string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function environment(name: string) {
  const runtime = globalThis as RuntimeGlobal;
  return runtime.Deno?.env?.get(name) ?? runtime.process?.env?.[name];
}

function sessionFor(sql: Sql): DatabaseSession {
  return Object.freeze({
    async query<Row extends DatabaseRow = DatabaseRow>(
      statement: string,
      parameters: readonly unknown[] = [],
    ) {
      return await sql.unsafe(
        statement,
        [...parameters] as never[],
      ) as unknown as readonly Row[];
    },
  });
}

function collectorDatabase(sql: Sql): CollectorDatabase {
  const session = sessionFor(sql);
  return Object.freeze({
    query: session.query,
    async transaction<Result>(
      operation: (transaction: DatabaseSession) => Promise<Result>,
    ) {
      return await sql.begin(async (transaction) =>
        operation(sessionFor(transaction as unknown as Sql))
      ) as Result;
    },
    async close() {
      await sql.end({ timeout: 2 });
    },
  });
}

async function openDatabase() {
  const connection = validateFirmsDatabaseUrl(
    environment("FIRMS_COLLECTOR_DATABASE_URL"),
    environment("SUPABASE_URL"),
  );
  const sql = postgres(connection.value, {
    max: 1,
    prepare: false,
    ssl: "require",
    connect_timeout: 5,
    idle_timeout: 5,
    max_lifetime: 60,
    fetch_types: false,
  });
  return collectorDatabase(sql);
}

const collectFirms = createFirmsEdgeHandler({
  openDatabase,
  mapKey: () => environment("FIRMS_MAP_KEY"),
});

const handler = {
  fetch: withSupabase(
    { auth: "secret:firms_shadow" },
    async (request) => collectFirms(request),
  ),
};

export default handler;
