import { createPgVectorQueryExecutor, type PgVectorPoolLike } from "../pgvector/executor.js";

export interface PGliteLike extends PgVectorPoolLike {}

export function createPGliteExecutor(client: PGliteLike) {
  return createPgVectorQueryExecutor(client);
}
