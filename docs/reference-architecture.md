# Reference Architecture

Open Interest Clusters is designed as a portable recommendation and semantic-interest substrate. The core package must remain protocol-neutral, storage-neutral, ANN-provider-neutral, stream-provider-neutral, and runtime-neutral.

The project should support two goals at the same time:

1. Anyone can use the core engine without adopting our infrastructure choices.
2. We can still define a clear, opinionated reference stack for our own production deployments.

## Core architecture principle

The core package defines contracts and pure runtime helpers. It should not require a broker, vector database, application framework, ActivityPods deployment, browser runtime, or server runtime.

The core package may expose interfaces and reference implementations, but concrete infrastructure should live behind adapters.

## Core layers

```text
Interest clusters and normalization
  -> protocol-neutral signals
  -> entity enrichment
  -> graph and co-occurrence intelligence
  -> embedding generation and refresh
  -> ANN/vector retrieval
  -> hybrid scoring
  -> local-first personalization
  -> candidate serving
  -> explanation projection
```

Each layer should remain replaceable through typed contracts.

## Public/shared intelligence

These signals can be shared across deployments when they are derived from public or explicitly indexable data:

- canonical interest clusters
- hashtag aliases and normalization rules
- public entity mappings
- public graph/co-occurrence structures
- public cluster embeddings
- ANN snapshots for public cluster vectors
- candidate-generation metadata

These are not user-private personalization records.

## Private/local intelligence

These should stay local-first by default:

- selected interests
- local feedback events
- seen/dismissed state
- local bandit state
- local preference profile
- local semantic profile vector
- local reranking decisions
- user-facing recommendation explanations

The core package should make private personalization possible without requiring centralized behavioral tracking.

## Recommended project posture

The repository should document three usage modes:

1. Embedded mode: no broker, no vector database, no server required.
2. Practical durable mode: Postgres plus pgvector as the first durable ANN reference path.
3. Advanced distributed mode: Redpanda/Kafka-compatible streams and specialized ANN providers such as Qdrant.

This keeps the default experience accessible while preserving a serious production path.

## Non-goals for the core package

The core package should not directly depend on:

- Postgres
- pgvector clients
- Qdrant clients
- Redpanda/Kafka clients
- ActivityPods
- IndexedDB
- SQLite
- Redis
- web frameworks
- mobile frameworks

Those integrations belong in adapters, examples, or separate packages.

## Reference stack for our own deployment

For our own architecture, the recommended stack is:

- canonical event source: ActivityPods canonical events
- durable practical ANN: Postgres plus pgvector first
- local personalization: device/local storage through generic serialization contracts
- streaming/event backbone for high scale: Redpanda or another Kafka-compatible stream
- specialized vector search for high scale: Qdrant or another ANN provider
- safety: URL sanitizer always on, Safe Browsing optional adapter
- entity intelligence: Wikidata and DBpedia-backed enrichment where appropriate

The core remains generic; our deployment profile becomes opinionated.