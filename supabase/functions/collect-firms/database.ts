export type DatabaseRow = Readonly<Record<string, unknown>>;

export interface DatabaseSession {
  query<Row extends DatabaseRow = DatabaseRow>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<readonly Row[]>;
}

export interface CollectorDatabase extends DatabaseSession {
  transaction<Result>(
    operation: (session: DatabaseSession) => Promise<Result>,
  ): Promise<Result>;
  close(): Promise<void>;
}

export function requireSingleRow<Row extends DatabaseRow>(
  rows: readonly Row[],
  message: string,
) {
  if (rows.length !== 1 || rows[0] === undefined) throw new Error(message);
  return rows[0];
}
