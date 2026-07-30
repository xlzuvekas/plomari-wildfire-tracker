export const CMR_RUNTIME_ROLE = "firewatch_cmr_collector_runtime";

export type ValidatedCollectorDatabaseUrl = Readonly<{
  value: string;
  projectRef: string;
}>;

/**
 * Fail closed unless the secret is a shared-Supavisor transaction-pooler URL
 * for the one dedicated collector login. The returned value must never be
 * logged or included in an HTTP response.
 */
export function validateCollectorDatabaseUrl(
  rawValue: string | undefined,
  supabaseUrlValue: string | undefined,
): ValidatedCollectorDatabaseUrl {
  if (rawValue === undefined || rawValue.trim() === "") {
    throw new Error("The collector database connection is not configured.");
  }
  if (rawValue !== rawValue.trim()) {
    throw new Error("The collector database connection is invalid.");
  }

  let url: URL;
  let supabaseUrl: URL;
  try {
    url = new URL(rawValue);
    supabaseUrl = new URL(supabaseUrlValue ?? "");
  } catch {
    throw new Error("The collector database connection is invalid.");
  }
  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error("The collector database connection is invalid.");
  }
  const separator = username.lastIndexOf(".");
  const role = separator < 0 ? username : username.slice(0, separator);
  const projectRef = separator < 0 ? "" : username.slice(separator + 1);
  const parameters = [...url.searchParams.entries()];
  const projectHost = /^([a-z0-9]{20})\.supabase\.co$/u.exec(
    supabaseUrl.hostname,
  );
  const expectedProjectRef = projectHost?.[1] ?? "";

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.password === "" ||
    role !== CMR_RUNTIME_ROLE ||
    !/^[a-z0-9]{20}$/u.test(projectRef) ||
    expectedProjectRef !== projectRef ||
    supabaseUrl.protocol !== "https:" ||
    supabaseUrl.username !== "" ||
    supabaseUrl.password !== "" ||
    supabaseUrl.port !== "" ||
    (supabaseUrl.pathname !== "" && supabaseUrl.pathname !== "/") ||
    supabaseUrl.search !== "" ||
    supabaseUrl.hash !== "" ||
    url.port !== "6543" ||
    !/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(url.hostname) ||
    (url.pathname !== "/postgres" && url.pathname !== "/postgres/") ||
    url.hash !== "" ||
    parameters.length !== 1 ||
    parameters[0]?.[0] !== "sslmode" ||
    parameters[0]?.[1] !== "require"
  ) {
    throw new Error(
      "The collector requires its dedicated Supavisor transaction-pooler login.",
    );
  }

  return Object.freeze({ value: rawValue, projectRef });
}
