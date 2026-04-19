import postgres, { type Sql, type TransactionSql } from "postgres";

/**
 * Create a postgres client.
 *
 * Pass the DATABASE_URL (Supabase Pooler in transaction mode for runtime,
 * or DIRECT_URL for migrations / DDL). prepare:false is required for
 * Supabase's transaction-mode pooler.
 */
export function createDb(connectionString: string) {
  return postgres(connectionString, { prepare: false });
}

/** Top-level client (has .begin / .end / .listen / etc). */
export type Db = ReturnType<typeof createDb>;

/**
 * Anything you can run a parameterised query against — top-level client
 * OR an in-transaction handle. Repo functions accept this so they can
 * be called from either context.
 */
export type Queryable = Sql<Record<string, never>> | TransactionSql<Record<string, never>>;
