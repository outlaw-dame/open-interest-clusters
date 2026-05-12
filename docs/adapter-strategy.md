# Adapter Strategy

The project uses a contract-first adapter architecture.

The purpose of adapters is to preserve portability while still allowing opinionated production deployments.

## Architectural rule

Infrastructure dependencies should not leak into the core package.

The core package defines interfaces.
Adapters implement infrastructure-specific behavior.

## ANN provider adapters

The ANN abstraction layer exists so deployments can choose retrieval infrastructure without rewriting recommendation logic.

Examples:

- in-memory ANN
- pgvector
- Qdrant
- HNSW-based local indexes
- SQLite vector extensions
- browser/device-local indexes

The recommendation engine should consume the ANN contract, not a specific database.

## Stream adapters

The project supports both pull-based and stream-based execution.

Examples:

- in-process scheduled worker
- cron/scheduled refresh
- local event loop
- Redis Streams
- Kafka-compatible streams
- Redpanda
- browser synchronization events

The semantic refresh system should not require a broker.

## Persistence adapters

Persistence should remain replaceable.

Examples:

- memory-only snapshots
- local JSON snapshots
- object storage
- IndexedDB
- SQLite
- Postgres
- cloud object stores

## Local-first personalization adapters

User personalization should support local-first execution.

Examples:

- IndexedDB
- SQLite
- ObjectBox
- local filesystem persistence
- encrypted mobile storage
- browser local storage wrappers

The engine should not assume centralized user profiling.

## Safety adapters

Safety systems should be layered and optional.

Examples:

- URL sanitization
- Safe Browsing providers
- content safety classifiers
- abuse heuristics
- domain reputation providers

Safety-sensitive boundaries should fail closed where possible.

## Embedding provider adapters

Embedding generation should remain provider-neutral.

Examples:

- local models
- ONNX runtime
- Transformers.js
- server-side embedding APIs
- edge inference
- GPU-backed providers

The embedding refresh pipeline should consume contracts rather than provider-specific SDK logic.

## Reference deployment guidance

Recommended default durable deployment:

- Postgres
- pgvector
- scheduled semantic refresh worker
- local-first personalization

Recommended advanced deployment:

- Redpanda/Kafka-compatible streams
- distributed refresh workers
- Qdrant or another specialized ANN provider
- object-backed snapshots

## Anti-drift rule

New adapters should:

- reuse canonical contracts
- reuse canonical fixtures
- avoid widening types
- avoid provider-specific assumptions in the core
- preserve deterministic behavior
- preserve portability boundaries

Infrastructure-specific optimizations belong inside adapters, not in the shared engine contracts.