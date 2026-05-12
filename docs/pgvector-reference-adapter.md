# pgvector Reference Adapter

pgvector is the first recommended durable ANN reference path for Open Interest Clusters.

This is a reference deployment recommendation, not a core dependency requirement.

## Why pgvector first

- lower operational complexity than distributed vector infrastructure
- integrates with existing Postgres deployments
- suitable for practical production deployments
- preserves simpler adoption
- compatible with future scaling

## Architectural rules

The core package must not directly depend on Postgres runtime libraries.

The adapter boundary keeps the core dependency-light.

## Future adapter responsibilities

A runtime pgvector adapter should provide:

- AnnProvider implementation
- deterministic upsert behavior
- bounded query semantics
- stale vector cleanup
- ANN snapshot restore compatibility
- deterministic ordering guarantees
- safe retry handling for transient failures

## Portability rule

Generic ANN contracts remain provider-neutral.

## Recommended profile

Practical durable deployment:

- Postgres
- pgvector
- scheduled semantic refresh worker
- ANN snapshots
- local-first personalization
