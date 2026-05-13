# PGlite Local-First Reference Guide

## Purpose

PGlite is an optional embedded PostgreSQL-compatible runtime for local-first recommendation storage.

This project does not require PGlite.

## Appropriate use cases

Good fit:

- browser-local recommendation state
- IndexedDB-backed persistence
- offline-first preference storage
- embedded experimentation
- local ANN durability with pgvector-compatible flows

Not appropriate:

- secret storage
- credential vaults
- signing key persistence
- authoritative multi-user server storage

## Security guidance

Treat local embedded storage as user-controlled cache.

Threats:

- browser eviction
- quota exhaustion
- local corruption
- user profile clearing
- device compromise

Assume recoverability is required.

## Recovery model

Recommended:

1. maintain rebuildable snapshots
2. validate dimensions before restore
3. enforce minimum viable snapshot sizes
4. health-check before serving
5. rebuild if unhealthy

Helpers:

- createPGliteExecutor()
- checkPGliteAnnHealth()
- rebuildPGliteFromSnapshot()

## Query adapter model

The adapter intentionally uses structural query compatibility.

This avoids hard dependency coupling.

## Persistence guidance

Use IndexedDB-backed persistence where appropriate.

Design for:

- quota failures
- startup recovery
- rebuild paths
- snapshot refresh workflows

## Sync caution

Do not assume experimental sync layers are production conflict-resolution infrastructure.

Use explicit server reconciliation strategies.

## Privacy guidance

Suitable local data:

- embeddings
- preference vectors
- recommendation profiles
- local feedback signals

Avoid storing:

- raw secrets
- signing credentials
- privileged tokens
