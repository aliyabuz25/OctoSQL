/**
 * OctoSQL Database Engine & Node.js Driver
 */

export interface ConnectionOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  token?: string;
  connectionLimit?: number;
}

export interface QueryField {
  name: string;
  table: string;
}

export interface QueryResult<T = any> extends Array<T> {
  command?: string;
  affectedRows?: number;
  insertId?: string | number | null;
  rowCount?: number;
  executionTimeMs?: number;
  dialect?: 'ansi-sql' | 'octosqlx';
  fromCache?: boolean;
}

export type QueryTuple<T = any> = [QueryResult<T>, QueryField[]];

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  status: any;
}

export class OctoConnection {
  constructor(config?: ConnectionOptions | string);
  connect(callback?: (err: Error | null, conn: OctoConnection) => void): Promise<OctoConnection>;
  ping(callback?: (err: Error | null, res: PingResult) => void): Promise<PingResult>;
  query<T = any>(sql: string, values?: any[] | any, callback?: (err: Error | null, rows: QueryResult<T>, fields: QueryField[]) => void): Promise<QueryTuple<T>>;
  execute<T = any>(sql: string, values?: any[] | any, callback?: (err: Error | null, rows: QueryResult<T>, fields: QueryField[]) => void): Promise<QueryTuple<T>>;
  octo<T = any>(sqlx: string, values?: any[] | any, callback?: (err: Error | null, rows: QueryResult<T>, fields: QueryField[]) => void): Promise<QueryTuple<T>>;
  beginTransaction(callback?: (err: Error | null) => void): Promise<QueryTuple>;
  commit(callback?: (err: Error | null) => void): Promise<QueryTuple>;
  rollback(callback?: (err: Error | null) => void): Promise<QueryTuple>;
  release(): void;
  end(callback?: (err: Error | null) => void): Promise<void>;
  close(callback?: (err: Error | null) => void): Promise<void>;
}

export class OctoPool {
  constructor(config?: ConnectionOptions | string);
  getConnection(callback?: (err: Error | null, conn: OctoConnection) => void): Promise<OctoConnection>;
  query<T = any>(sql: string, values?: any[] | any, callback?: (err: Error | null, rows: QueryResult<T>, fields: QueryField[]) => void): Promise<QueryTuple<T>>;
  execute<T = any>(sql: string, values?: any[] | any, callback?: (err: Error | null, rows: QueryResult<T>, fields: QueryField[]) => void): Promise<QueryTuple<T>>;
  octo<T = any>(sqlx: string, values?: any[] | any, callback?: (err: Error | null, rows: QueryResult<T>, fields: QueryField[]) => void): Promise<QueryTuple<T>>;
  end(callback?: (err: Error | null) => void): Promise<void>;
}

export function createConnection(config?: ConnectionOptions | string): OctoConnection;
export function createPool(config?: ConnectionOptions | string): OctoPool;
export function parseConnectionUri(uri: string): ConnectionOptions;

export function encrypt(data: any): string;
export function decrypt(payload: string, asJson?: boolean): any;
export function checksum(content: any): string;
export function sanitizeXss(str: string): string;
export function uuid(): string;
