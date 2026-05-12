export type PgVectorDistanceMetric = "cosine" | "inner_product" | "l2";

export interface PgVectorAnnConfig {
  tableName: string;
  idColumn: string;
  vectorColumn: string;
  dimensions: number;
  distanceMetric: PgVectorDistanceMetric;
  schemaName?: string;
}

export interface PgVectorMigrationPlan {
  extensionSql: string;
  tableSql: string;
  indexSql: string;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MIN_DIMENSIONS = 1;
const MAX_DIMENSIONS = 16_384;
const MAX_IDENTIFIER_LENGTH = 63;
const RESERVED_IDENTIFIERS = new Set([
  "select",
  "insert",
  "update",
  "delete",
  "drop",
  "table",
  "index",
  "where",
  "from",
  "join",
  "public"
]);

export function assertPgVectorIdentifier(value: string, label: string): void {
  const normalized = value.trim();

  if (
    normalized !== value ||
    normalized.length === 0 ||
    normalized.length > MAX_IDENTIFIER_LENGTH ||
    RESERVED_IDENTIFIERS.has(normalized.toLowerCase()) ||
    !IDENTIFIER_PATTERN.test(normalized)
  ) {
    throw new Error(`Invalid pgvector ${label} identifier`);
  }
}

export function normalizePgVectorConfig(config: PgVectorAnnConfig): Required<PgVectorAnnConfig> {
  assertPgVectorIdentifier(config.tableName, "table");
  assertPgVectorIdentifier(config.idColumn, "id column");
  assertPgVectorIdentifier(config.vectorColumn, "vector column");

  const schemaName = config.schemaName ?? "public";
  if (schemaName !== "public") {
    assertPgVectorIdentifier(schemaName, "schema");
  }

  if (!Number.isInteger(config.dimensions) || config.dimensions < MIN_DIMENSIONS || config.dimensions > MAX_DIMENSIONS) {
    throw new Error("Invalid pgvector dimensions");
  }

  return {
    ...config,
    schemaName
  };
}

function qualifiedTableName(config: Required<PgVectorAnnConfig>): string {
  return `"${config.schemaName}"."${config.tableName}"`;
}

function vectorOperatorClass(metric: PgVectorDistanceMetric): string {
  switch (metric) {
    case "cosine":
      return "vector_cosine_ops";
    case "inner_product":
      return "vector_ip_ops";
    case "l2":
      return "vector_l2_ops";
  }
}

export function createPgVectorMigrationPlan(config: PgVectorAnnConfig): PgVectorMigrationPlan {
  const normalized = normalizePgVectorConfig(config);
  const table = qualifiedTableName(normalized);
  const indexName = `${normalized.tableName}_${normalized.vectorColumn}_hnsw_idx`;

  assertPgVectorIdentifier(indexName, "index");

  return {
    extensionSql: "CREATE EXTENSION IF NOT EXISTS vector;",
    tableSql: [
      `CREATE TABLE IF NOT EXISTS ${table} (`,
      `  "${normalized.idColumn}" text PRIMARY KEY,`,
      `  "${normalized.vectorColumn}" vector(${normalized.dimensions}) NOT NULL,`,
      "  updated_at timestamptz NOT NULL DEFAULT now()",
      ");"
    ].join("\n"),
    indexSql: `CREATE INDEX IF NOT EXISTS "${indexName}" ON ${table} USING hnsw ("${normalized.vectorColumn}" ${vectorOperatorClass(normalized.distanceMetric)});`
  };
}
