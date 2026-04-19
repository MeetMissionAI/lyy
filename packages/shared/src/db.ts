import postgres from "postgres";

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

export type Db = ReturnType<typeof createDb>;
