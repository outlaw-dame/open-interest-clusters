# Canonical Project Status

This document is the authoritative summary of the current repository state. It distinguishes implemented library capabilities from contract-only integrations and from work still required for a complete production recommendation system.

Last reconciled against `main` after PR #63.

## Project mission

Open Interest Clusters is a portable, privacy-preserving recommendation and semantic-interest substrate. It is designed to be embedded by applications and servers across ActivityPub, ATProto, ActivityPods/Solid, and local-first environments without requiring one protocol, database, vector provider, stream provider, runtime, or application framework.

The core package must remain:

- protocol-neutral;
- runtime-neutral;
- storage-neutral;
- ANN-provider-neutral;
- stream-provider-neutral;
- privacy-respecting and deny-by-default for sensitive processing.

ActivityPods is the preferred canonical-event architecture for our deployments, but adopting ActivityPods or supporting every protocol is not a requirement for using the core package.

## Current maturity

The repository is a substantial recommendation-engine library, not an early schema-only project. Most major primitives exist, but they are not yet composed into a turnkey production service.

Approximate maturity by area:

| Area | Status |
| --- | --- |
| Dataset, schema, normalization, catalog | Mature library capability |
| Consent, privacy, deletion contracts | Mature library capability |
| ActivityPub and ATProto normalization | Strong contract-level capability |
| Provider record mapping and authorization | Strong contract-level capability |
| ATProto label ingestion and state merge | Implemented |
| Labeler subscription evidence policy | Implemented |
| Interest signal model and generic derivation | Implemented |
| Label-to-interest evidence bridge | Implemented, semantically limited |
| Profile store and hardened persistence | Implemented |
| Embedding lifecycle and invalidation | Implemented |
| Entity, graph, ANN, scoring, bandit, serving | Implemented primitives |
| End-to-end engine orchestration | Incomplete |
| Live protocol/provider clients | Not implemented in core |
| Label semantic classification | Incomplete |
| Idempotent signal ledger and retractions | Incomplete |
| Deployable operator service | Not implemented |

## Implemented capabilities

### Dataset and catalog

- Strict interest-cluster JSON Schema and starter global dataset.
- Unicode and hashtag normalization.
- Immutable local and remote dataset loading.
- ETag-aware remote loading with bounded retry policy.
- Catalog indexes for topics, tags, tokens, and entities.
- Local entity resolution and sensitive-topic boundaries.
- Onboarding selection, profile seeding, and optional follow-plan generation.

### Consent, privacy, and deletion

- Deny-by-default consent decisions.
- Explicit data-use categories.
- Private-data, third-party-data, and server-side-processing controls.
- Privacy-safe consent audit events.
- Consent revocation and derived-data deletion intents.
- Local-only profile behavior by default.
- Hardened persistence boundaries and privacy-safe persistence errors.
- Profile deletion and embedding invalidation paths.

### Protocol source boundaries

- Generic recommendation source adapter contracts.
- Strict source identifiers, cursors, timestamps, and batch bounds.
- ActivityPub and ATProto source normalization.
- Provider-facing authorization evidence for ActivityPub, ActivityPods/Solid ACL evidence, and ATProto public repositories.
- Mastodon-shaped, generic ActivityPub, and ATProto provider-record mappers.
- Conservative provider-policy merging and source eligibility checks.
- Strict ATProto DID, handle, NSID, record-key, and AT URI validation.

These are contract-level and pure mapping capabilities. The package does not bundle live Mastodon, GoToSocial, ActivityPods, Bluesky AppView, PDS, relay, or firehose clients.

### ATProto labels and labeler evidence

- Dedicated label normalization outside repository-record mapping.
- Labeler DID, target URI/CID, value, negation, timestamps, expiration, signature, version, and provenance preservation.
- Tombstone-safe state merging and out-of-order resurrection protection.
- User-scoped labeler subscription evidence.
- Consent, subscription, target, expiration, and negation policy checks.
- Conservative conversion of accepted label evidence into neutral, local-only interest evidence.

Important limitation: accepted labels are not yet semantically classified. A label may represent a topic, moderation decision, safety constraint, identity, community, content format, game, or unknown provider-specific meaning. Unknown labels must not automatically become positive interests.

### Interest profiles and persistence

- Normalized interest signals with target, action, polarity, strength, confidence, data use, privacy boundary, evidence, consent, and expiration.
- In-memory profile aggregation with score, confidence, signal counts, provenance summaries, expiration pruning, entry bounds, and deletion.
- Pseudonymous subject-key generation.
- Hardened profile record parsing, persistence, verification, cleanup, and deletion adapters.

Important limitation: profile ingestion is additive and does not yet provide a general idempotent event ledger. Replayed or duplicated source events can be counted more than once unless the caller deduplicates them.

### Embeddings, retrieval, ranking, and serving

- Embedding provider and lifecycle contracts.
- Model manifests, dimensions, metrics, artifact integrity, profile fingerprints, expiration, invalidation, and staleness evaluation.
- In-memory ANN and capability-aware ANN orchestration.
- pgvector and PGlite-oriented adapters and resilience helpers.
- Entity extraction and mapping.
- Co-occurrence graph, Louvain/community mapping, pruning, serialization, and replay.
- Deterministic, entity, graph, embedding, and bandit score components.
- Local preference, semantic profile, decay, feedback, and explanation helpers.
- Bounded, deduplicated candidate serving with exclusions and optional explanations.

Important limitation: there is no single public engine operation that composes all of these layers into a complete request workflow.

## Contract-only or external responsibilities

The following responsibilities intentionally remain outside the core or behind adapters:

- OAuth and provider authentication;
- live ActivityPub/Mastodon/GoToSocial fetching;
- ActivityPods/Solid Pod reads, ACL resolution, and storage;
- Bluesky AppView and PDS API clients;
- ATProto repository subscription, relay/firehose ingestion, `queryLabels`, and `subscribeLabels` clients;
- IndexedDB, SQLite, encrypted mobile storage, and production Postgres persistence implementations;
- production embedding model runtimes;
- Kafka/Redpanda workers;
- operator HTTP APIs, dashboards, health endpoints, and deployment charts.

## Critical semantic gap

The next feature work must address label semantics before automatically applying label-derived evidence to user profiles.

Required semantic categories should include at least:

- topic interest;
- moderation;
- safety;
- identity;
- community;
- content format;
- game or playful classification;
- eligibility/filtering;
- unknown.

Default behavior must be conservative:

- unknown label: retain as auditable evidence, no automatic ranking effect;
- moderation label: moderation/filter evidence, not positive interest;
- safety label: policy or eligibility evidence;
- topic label: eligible for positive-interest derivation;
- identity/community/game labels: optional, low-weight, explicitly governed affinity evidence.

## Correct execution order

### Phase 1 — Repository reconciliation and canonical documentation

- Maintain this document as the source of truth.
- Update README, privacy model, dependency map, and hardening plan.
- Remove stale claims and completed roadmap items.
- Track remaining work in issues or an authoritative roadmap.

### Phase 2 — Label semantic classification

- Add semantic-kind contracts and metadata inputs.
- Preserve unknown labels without assigning interest meaning.
- Support labeler-declared metadata, host-provided metadata, local catalog matches, and explicit mappings.

### Phase 3 — Signal-effect policy

- Map semantic kinds to positive interest, negative interest, moderation, safety, eligibility, presentation preference, or audit-only effects.
- Keep policy pluggable and privacy-safe.

### Phase 4 — Idempotent signal ledger and retractions

- Stable signal IDs and source event IDs.
- Deduplication and replay safety.
- Ordering, tombstones, expiration, and label-negation retractions.
- Deterministic retry and crash-recovery behavior.

### Phase 5 — Profile application orchestration

- Compose label policy, semantic classification, effect policy, idempotent application, retraction, expiration, and profile updates.

### Phase 6 — Labeler discovery and recommendation

- Labeler metadata profiles and semantic compatibility.
- Local-first labeler suggestions.
- Optional privacy-safe aggregate co-subscription evidence.
- Diversity, blocks, mutes, availability, and explanations.

### Phase 7 — End-to-end engine orchestration

Compose source authorization, normalization, consent, eligibility, signal derivation, profile state, embedding freshness, retrieval, scoring, local reranking, explanations, and serving through dependency-injected contracts.

### Phase 8 — Live protocol integration slices

Implement independent ActivityPub, ActivityPods/Solid, ATProto repository/API, `queryLabels`, and `subscribeLabels` adapters without bypassing the core contracts.

### Phase 9 — Reference persistence and runtime adapters

Provide tested examples for IndexedDB, SQLite, Solid storage, Postgres, pgvector, local filesystem snapshots, and optional Kafka-compatible processing.

### Phase 10 — Operational hardening and release

- Privacy-safe observability and health snapshots.
- Freshness policy and fallback reporting.
- Property, fuzz, replay, concurrency, and crash-recovery testing.
- Performance budgets and security scanning.
- Stable package documentation, versioning, examples, and release automation.

## Definition of production completeness

The project should not be described as a complete production recommendation system until it has:

- semantic label handling;
- idempotent and retractable signal application;
- end-to-end orchestration;
- at least one live ActivityPub or ATProto integration slice;
- at least one local-first persistence path;
- at least one durable server deployment path;
- privacy-safe observability and health behavior;
- integration, replay, concurrency, and recovery tests;
- accurate operator and integrator documentation.

Until then, it should be described as a strong, reusable recommendation-engine substrate with mature primitives and incomplete production composition.
