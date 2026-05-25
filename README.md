# Open Interest Clusters

Portable schema, starter dataset, validation, normalization, semantic-interest tooling, and recommendation infrastructure helpers for canonical interest clusters.

## What this repo contains

- A strict JSON Schema for interest-cluster datasets
- A starter global dataset
- TypeScript runtime helpers for:
  - strict dataset validation
  - Unicode + hashtag normalization
  - immutable dataset loading
  - remote dataset fetch with ETag support and bounded exponential backoff
- Semantic refresh and embedding infrastructure
- ANN abstraction contracts and providers
- Candidate-generation and recommendation helpers
- Local-first personalization primitives
- Minimal scripts for validation and normalization
- Tests for normalization, validation, loader behavior, and semantic infrastructure

## Architecture documentation

- `docs/reference-architecture.md`
- `docs/adapter-strategy.md`
- `docs/deployment-profiles.md`
- `docs/subsystem-dependency-map.md`
- `docs/risk-ranked-hardening-plan.md`
- `docs/adapter-contributor-guide.md`

## Design goals

The core package is intentionally:

- protocol-neutral
- runtime-neutral
- ANN-provider-neutral
- stream-provider-neutral
- storage-neutral

The project supports lightweight embedded deployments as well as advanced distributed deployments.

## Recommended deployment path

Recommended practical durable deployment:

- Postgres
- pgvector
- scheduled semantic refresh worker
- local-first personalization

Advanced distributed deployments may use:

- Redpanda/Kafka-compatible streams
- distributed refresh workers
- Qdrant or other specialized ANN providers

These advanced components are optional and should not be required by the core package.

## Install

```bash
npm install
```

## Validate the starter dataset

```bash
npm run validate:dataset
```

## Build

```bash
npm run build
```
