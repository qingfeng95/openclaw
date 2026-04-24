import postgres from "postgres";

export type DbClient = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(run: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type DbClientOptions = {
  databaseUrl: string;
};

function wrapSqlClient(sql: any): DbClient {
  return {
    async query<T = Record<string, unknown>>(queryText: string, params: unknown[] = []) {
      const result = await sql.unsafe(queryText, params);
      const rows = Array.isArray(result) ? (result as T[]) : [];
      return { rows };
    },
    async transaction<T>(run: (tx: DbClient) => Promise<T>): Promise<T> {
      return await sql.begin(async (innerSql: any) => {
        const tx = wrapSqlClient(innerSql);
        return await run(tx);
      });
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}

export function createDbClient(options: DbClientOptions): DbClient {
  const sql = postgres(options.databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return wrapSqlClient(sql);
}
