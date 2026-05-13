# pgvector Reference Deployment Guide

This project supports pgvector as the first durable ANN reference adapter.

## When pgvector is the right fit

Use pgvector when you want:

- operational simplicity
- a single PostgreSQL deployment
- moderate ANN workloads
- transactional durability
- straightforward backups and migrations

Good fit:

- prototypes
- small to medium production systems
- recommendation systems already centered on PostgreSQL

Less ideal:

- very high write ingestion
- extremely large ANN indexes
- embeddings beyond pgvector `vector` dimensional limits
- ultra-low latency dedicated ANN workloads

In those cases, prefer dedicated ANN systems.

## Supported dimensions

This adapter targets pgvector's `vector(N)` type.

Reference limit:

- maximum 2000 dimensions

If your embedding model exceeds this:

- use halfvec-based custom infrastructure
- use a dedicated ANN backend like Qdrant

The reference adapter intentionally rejects invalid vector dimensions.

## Distance metrics

Supported:

- cosine
- inner product
- l2

Operator mapping:

- cosine → `vector_cosine_ops`
- inner product → `vector_ip_ops`
- l2 → `vector_l2_ops`

## Index strategy

Default migration helper emits HNSW.

Why:

- better recall/latency tradeoff for most serving workloads
- no training phase unlike IVFFlat
- simpler operational reference path

Tradeoffs:

- slower index builds
- higher memory consumption

For extremely large datasets, IVFFlat may be more appropriate.

## Reference schema

Generated migration includes:

- extension install
- table creation
- HNSW index

Shape:

- cluster id text primary key
- vector column
- updated_at timestamptz

## Operational recommendations

### Bulk restore

Preferred sequence:

1. create extension
2. create table
3. bulk restore vectors
4. create ANN index

This avoids repeated index maintenance cost during mass ingest.

### Query tuning

HNSW tuning commonly includes:

- `hnsw.ef_search`

Tune per workload.

Higher values:

- better recall
- slower queries

Lower values:

- faster queries
- lower recall

The reference adapter intentionally does not hardcode session tuning.

### Maintenance

Monitor:

- index size
- shared buffer pressure
- vacuum health
- checkpoint pressure
- query latency percentiles

### Connection management

Use pooled connections.

The reference bridge accepts pool-like query interfaces.

## Migration path from in-memory ANN

Use:

- `snapshotToPgVectorRecords()`
- `restorePgVectorSnapshot()`

Recommended migration:

1. serialize in-memory ANN snapshot
2. create pgvector schema
3. restore snapshot
4. build ANN index
5. switch serving path

## Security notes

This adapter:

- validates SQL identifiers
- parameterizes query values
- rejects invalid dimensions
- rejects malformed vectors

It does not:

- provision databases
- manage credentials
- tune Postgres globally
