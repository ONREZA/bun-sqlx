import * as rt from "./runtime";

export interface KnownQueries {}
export interface KnownFileQueries {}

export type { BunSqlxConfig } from "./config";

type ParamsOf<T> = T extends { params: infer P extends readonly unknown[] } ? P : never[];
type RowOf<T> = T extends { row: infer R } ? R : never;

export type TypedSql = {
  <Q extends keyof KnownQueries>(query: Q, ...params: ParamsOf<KnownQueries[Q]>): Promise<RowOf<KnownQueries[Q]>[]>;
  file: <P extends keyof KnownFileQueries>(
    path: P,
    ...params: ParamsOf<KnownFileQueries[P]>
  ) => Promise<RowOf<KnownFileQueries[P]>[]>;
};

export type Typed = TypedSql & {
  transaction: <R>(fn: (tx: TypedSql) => Promise<R>) => Promise<R>;
};

export const sql: Typed = rt.sql as unknown as Typed;
export const unsafe = rt.unsafe;
export const getClient = rt.getClient;
export const setClient = rt.setClient;
export const close = rt.close;
export const migrate = rt.migrate;
export const clearSqlFileCache = rt.clearSqlFileCache;
export type MigrateOptions = rt.MigrateOptions;
