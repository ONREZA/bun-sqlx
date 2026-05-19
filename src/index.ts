import * as rt from "./runtime";

export interface KnownQueries {}

export type { BunSqlxConfig } from "./config";

export type Typed = {
  <Q extends keyof KnownQueries>(
    query: Q,
    ...params: KnownQueries[Q] extends { params: infer P extends readonly unknown[] } ? P : never[]
  ): Promise<KnownQueries[Q] extends { row: infer R } ? R[] : never>;
};

export const sql: Typed = rt.sql as unknown as Typed;
export const unsafe = rt.unsafe;
export const getClient = rt.getClient;
export const setClient = rt.setClient;
export const close = rt.close;
export const migrate = rt.migrate;
export type MigrateOptions = rt.MigrateOptions;
