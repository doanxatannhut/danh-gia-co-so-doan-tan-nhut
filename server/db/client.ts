import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

let dbInstance: DbClient | null = null;

export async function getDb(): Promise<DbClient> {
  if (dbInstance) return dbInstance;

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    dbInstance = {
      async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
        const res = await pool.query(sql, params);
        return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
      },
      async exec(sql: string) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
        dbInstance = null;
      },
    };
    return dbInstance;
  }

  const dataDir = process.env.PGLITE_DATA_DIR || path.resolve(process.cwd(), 'data', 'pgdata');
  fs.mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);
  await pglite.waitReady;

  dbInstance = {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const res = await pglite.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
    async exec(sql: string) {
      await pglite.exec(sql);
    },
    async close() {
      await pglite.close();
      dbInstance = null;
    },
  };
  return dbInstance;
}
