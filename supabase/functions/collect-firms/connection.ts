export const FIRMS_RUNTIME_ROLE = "firewatch_firms_collector_runtime";

export type ValidatedFirmsDatabaseUrl = Readonly<{
  value: string;
  projectRef: string;
}>;

/** Accept only the dedicated shared-Supavisor transaction-pooler login. */
export function validateFirmsDatabaseUrl(
  rawValue: string | undefined,
  supabaseUrlValue: string | undefined,
): ValidatedFirmsDatabaseUrl {
  if (rawValue === undefined || rawValue.trim() === "" || rawValue !== rawValue.trim()) {
    throw new Error("The FIRMS collector database connection is not configured.");
  }
  let url: URL;
  let supabaseUrl: URL;
  try {
    url = new URL(rawValue);
    supabaseUrl = new URL(supabaseUrlValue ?? "");
  } catch {
    throw new Error("The FIRMS collector database connection is invalid.");
  }
  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error("The FIRMS collector database connection is invalid.");
  }
  const separator = username.lastIndexOf(".");
  const role = separator < 0 ? username : username.slice(0, separator);
  const projectRef = separator < 0 ? "" : username.slice(separator + 1);
  const parameters = [...url.searchParams.entries()];
  const projectHost = /^([a-z0-9]{20})\.supabase\.co$/u.exec(
    supabaseUrl.hostname,
  );
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.password === "" ||
    role !== FIRMS_RUNTIME_ROLE ||
    !/^[a-z0-9]{20}$/u.test(projectRef) ||
    projectHost?.[1] !== projectRef ||
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
      "The FIRMS collector requires its dedicated transaction-pooler login.",
    );
  }
  return Object.freeze({ value: rawValue, projectRef });
}
