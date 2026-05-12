# Deployment Profiles

Open Interest Clusters supports multiple deployment profiles.

The goal is to support:

- embedded/local-first applications
- lightweight servers
- practical production deployments
- high-scale distributed systems

without forcing unnecessary infrastructure requirements.

## Tier 0: Embedded profile

Recommended for:

- PWAs
- local-first applications
- prototypes
- demos
- small communities
- device-first personalization

Characteristics:

- no broker required
- no server required
- no vector database required
- in-memory ANN
- local snapshots
- local preference persistence
- scheduled or in-process refresh

Example stack:

- in-memory ANN provider
- IndexedDB or SQLite
- local embedding cache
- local semantic refresh worker

## Tier 1: Practical durable profile

Recommended default durable deployment.

Characteristics:

- single-node friendly
- operationally lightweight
- durable vector persistence
- production-capable without distributed infrastructure

Recommended stack:

- Postgres
- pgvector
- scheduled semantic refresh worker
- local snapshot persistence
- local-first personalization

This should be the primary documented durable deployment path.

## Tier 2: Advanced distributed profile

Recommended for:

- large deployments
- federated event ingestion
- distributed semantic refresh
- replayable event processing
- multi-consumer pipelines

Recommended stack:

- Redpanda or another Kafka-compatible stream
- distributed refresh workers
- object-backed snapshots
- pgvector or Qdrant
- distributed embedding refresh

Redpanda is an advanced deployment profile, not a requirement for the project.

## Tier 3: Canonical/event-backbone profile

This profile aligns with our ActivityPods architecture.

Characteristics:

- protocol-neutral canonical events
- replayable ingestion
- cross-protocol normalization
- durable semantic fanout
- distributed recommendation infrastructure

Recommended stack:

- canonical normalized events
- Redpanda/Kafka-compatible streams
- pgvector or Qdrant
- local-first personalization
- protocol bridges
- semantic refresh workers

## Important architectural rule

The deployment profiles are examples.

The core engine must remain:

- runtime-neutral
- transport-neutral
- ANN-provider-neutral
- storage-neutral
- protocol-neutral

The deployment profiles should guide users without locking them into a specific infrastructure stack.