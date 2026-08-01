# Risk-Ranked Hardening Plan

This document is the status-aware hardening roadmap for Open Interest Clusters. It distinguishes completed controls from remaining production risks. See [`canonical-status.md`](canonical-status.md) for the overall project roadmap.

## Principles

- Accuracy and privacy take priority over convenience.
- Ambiguous consent, authorization, semantic meaning, or trust state fails closed.
- Replayable or retryable input must be idempotent before it mutates durable state.
- Provider-specific logic stays behind adapters.
- Private personalization remains local-first by default.
- Errors, metrics, audit events, and explanations must not expose raw subject identifiers or sensitive payloads.
- Common validation and retry behavior should be centralized without erasing domain-specific error messages.

## Risk ranking

- **P0:** security, privacy, or correctness defect that can bypass policy, misclassify sensitive evidence, corrupt subject state, or recreate deleted data.
- **P1:** reliability or operational defect that can produce stale, degraded, unavailable, or unauditable recommendations.
- **P2:** maintainability, performance, documentation, or release risk that can grow into correctness or operational debt.

## Completed or substantially completed controls

### Shared bounded retry policy — substantially complete

Implemented through the shared retry utility and migrations in remote dataset loading, embedding orchestration, and Safe Browsing integration.

Existing controls include:

- bounded attempts;
- exponential backoff with jitter;
- cancellation support;
- retry classification;
- elapsed-time budgets;
- preservation of original thrown values;
- retry hooks.

Remaining work:

- verify every future network adapter uses the shared policy;
- add integration-level retry/replay tests when live provider clients are introduced;
- expose privacy-safe retry/fallback health counters.

### Control-character validation consolidation — substantially complete

The shared `hasUnsafeControlCharacter` helper is covered for C0, DEL, and C1 controls, and duplicate recommendation-layer implementations were removed.

Remaining work:

- consolidate other repeated bounded-string/identifier guards only where semantics truly match;
- add cross-module canonicalization conformance tests.

### Protocol identifier and provider-record hardening — strong baseline complete

Implemented controls include:

- strict source IDs, subjects, cursors, and timestamps;
- ActivityPub and ATProto visibility/access-basis validation;
- strict ATProto DID, handle, NSID, record-key, and AT URI validation;
- tuple-consistency checks;
- conservative provider-policy merging;
- malformed record rejection;
- bounded provider batches;
- separation of ATProto labels from repository records.

Remaining work:

- property/fuzz testing of malformed provider payloads;
- live adapter integration tests;
- privacy-safe rejection counters;
- replay and duplicate-delivery tests.

### Consent, profile, persistence, and embedding lifecycle — strong baseline complete

Implemented controls include:

- deny-by-default consent;
- privacy-safe audit reasons;
- local-only profile defaults;
- server-processing consent gates;
- aggregate-only subject-profile rejection;
- pseudonymous persistence keys;
- write verification and corrupted-write cleanup;
- profile deletion intents;
- embedding fingerprinting, staleness, expiration, invalidation, and consent-revocation reasons.

Remaining work:

- reusable redaction/property assertions across all serializers and errors;
- end-to-end deletion propagation tests;
- replay prevention after deletion/revocation;
- concrete encrypted local and durable persistence adapters.

## P0 remaining work

### P0.1 Label semantic classification before ranking effects

Risk:

Accepted labeler evidence currently lacks a complete semantic model. Labels may describe topics, moderation decisions, safety constraints, identity, communities, content formats, games, eligibility, or unknown provider-specific concepts.

Impact:

A moderation or safety label could be misinterpreted as a user interest, causing unsafe recommendations, sensitive inference, or incorrect labeler suggestions.

Required controls:

- introduce explicit semantic kinds;
- consume labeler-declared metadata, host-provided metadata, explicit mappings, local catalog matches, target type, and namespace where available;
- preserve unknown labels as audit-only evidence;
- prohibit automatic positive-interest effects for moderation, safety, eligibility, or unknown labels;
- keep classification contracts protocol-neutral and pluggable.

Required tests:

- topical label becomes eligible interest evidence;
- moderation/safety labels never become positive interest;
- unknown label stays audit-only;
- conflicting metadata fails closed or yields unknown;
- sensitive semantic categories require explicit policy;
- malformed label metadata cannot escape validation.

Definition of done:

No label-derived evidence can affect ranking or profile score without an explicit semantic classification and effect policy.

### P0.2 Idempotent signal identity, replay safety, and retractions

Risk:

The profile store is additive. Duplicate ActivityPub delivery, ATProto relay replay, retries, backfills, or repeated label batches can count the same evidence multiple times. Label negation/tombstones currently protect label state but do not retract a prior profile contribution.

Impact:

Profile corruption, score inflation, stale moderation/interest effects, non-deterministic recovery, and recreation of deleted state.

Required controls:

- stable signal IDs and source-event IDs;
- deduplication ledger;
- deterministic ordering/version rules;
- idempotent batch application;
- tombstone/retraction records;
- label-negation reversal;
- expiration cleanup;
- replay barriers after deletion or consent revocation;
- crash-safe commit semantics for persistence adapters.

Required tests:

- repeated identical event changes state once;
- reordered delivery converges deterministically;
- negation retracts the exact prior contribution;
- expired evidence no longer contributes;
- retry after partial failure does not double count;
- deletion followed by stale replay does not recreate state;
- concurrent ingest remains consistent.

Definition of done:

Replayable provider streams can be connected without caller-side deduplication and without corrupting subject state.

### P0.3 End-to-end authorization and deletion invariants

Risk:

Strong module-level controls exist, but there is no single engine workflow enforcing the complete order from provider authorization through deletion propagation.

Impact:

Integrators may compose valid primitives in an unsafe order, process restricted data before consent, or fail to invalidate downstream artifacts.

Required controls:

- orchestration contracts that require authorization and consent before derivation;
- typed stages that prevent bypassing semantic/effect policy;
- deletion propagation from profile to embeddings, feedback, and ledger state;
- privacy-safe stage outcomes;
- explicit rollback behavior for partial persistence failure.

Required tests:

- private source cannot reach derivation without matching authorization and consent;
- server processing cannot occur under local-only consent;
- profile deletion invalidates related embeddings and ledger state;
- partial failure does not leave mixed-generation state;
- errors never expose subject IDs or private payloads.

Definition of done:

The recommended orchestration API is fail-closed by construction rather than relying on integrators to reproduce the correct sequence manually.

## P1 remaining work

### P1.1 Unified freshness and stale-read policy

Risk:

Embedding lifecycle has staleness evaluation, and loaders/ANN modules have freshness-related behavior, but ranking does not use one central stale-artifact policy.

Required controls:

- common freshness metadata for dataset, graph, embedding, ANN snapshot, and profile generation;
- stale modes: deny, degrade, or allow with explicit metadata;
- bounded self-healing refresh;
- generation consistency checks across retrieval and scoring;
- stale/fallback state in privacy-safe response metadata.

Definition of done:

Every artifact used by an end-to-end recommendation request has explicit freshness evaluation and deterministic stale behavior.

### P1.2 Circuit-breaker, fallback, and recovery observability

Risk:

ANN orchestration includes fallback/circuit behavior, but operators lack a unified privacy-safe view of degraded mode and recovery.

Required controls:

- structured health snapshots;
- fallback activation/recovery counters;
- preferred-provider restoration events;
- no hidden fail-open transitions;
- SLO-oriented thresholds and alert guidance;
- downstream response metadata indicating degraded retrieval where appropriate.

Definition of done:

Operators can identify provider failure, fallback activation, stale mode, and recovery without inspecting user-private data.

### P1.3 Live provider adapter resilience

Risk:

The core currently has no live ActivityPub, ActivityPods/Solid, Bluesky/PDS, relay, `queryLabels`, or `subscribeLabels` clients.

Required controls for each adapter:

- SSRF-safe URL handling where applicable;
- OAuth/scope/ACL enforcement;
- bounded response bodies and batches;
- shared retry/backoff and cancellation;
- cursor/checkpoint persistence;
- replay/idempotency integration;
- rate-limit handling;
- stale cache policy;
- sanitized errors and telemetry;
- block, mute, label, and provider-policy enforcement.

Definition of done:

Each live adapter has adversarial, timeout, retry, cursor, replay, authorization, and partial-failure tests before being considered production-ready.

### P1.4 Privacy-safe labeler discovery

Risk:

Labeler recommendation can expose user moderation choices, sensitive interests, or centralized co-subscription graphs.

Required controls:

- local-first discovery mode;
- explicit opt-in before aggregate co-subscription use;
- minimum cohort/privacy thresholds for aggregates;
- no raw subscription lists in telemetry;
- diversity and anti-feedback-loop controls;
- blocks, mutes, availability, and trust-boundary filters;
- user-facing explanations that do not expose third-party private behavior.

Definition of done:

Labeler suggestions work without mandatory centralized tracking and can explain their basis safely.

## P2 remaining work

### P2.1 Cross-module normalization policy

- define canonical policies by input class rather than one universal normalizer;
- add equivalence tests for hashtags, URLs, domains, DIDs, AT URIs, timestamps, subject keys, and cluster IDs;
- preserve domain-specific error messages;
- prevent Unicode/control-character drift.

### P2.2 Performance and memory budgets

Add versioned benchmarks for:

- dataset validation and indexing;
- provider record normalization;
- label-state merge;
- signal ledger application;
- profile ingestion and pruning;
- embedding fingerprinting;
- ANN orchestration overhead;
- graph replay;
- hybrid scoring;
- candidate serving.

CI should fail only for meaningful, stable regressions and should keep benchmark noise separate from correctness checks.

### P2.3 Documentation, compatibility, and release discipline

Required controls:

- canonical status kept current;
- public API documentation and examples;
- pre-1.0 compatibility policy;
- migration notes for schema/record versions;
- changelog and release automation;
- package smoke tests on supported Node versions;
- dependency and static security scanning;
- branch cleanup and stale-document review.

## Required CI checks

Current baseline:

- `pnpm install --frozen-lockfile`;
- `pnpm lint:types`;
- `pnpm build`;
- `pnpm verify:package-entrypoints:metadata`;
- `pnpm verify:package-entrypoints`;
- `pnpm validate:dataset`;
- `pnpm test`;
- package dry-run/smoke verification where configured.

Recommended additions:

- dependency and static security scan;
- property/fuzz test job;
- replay/concurrency/recovery integration job;
- benchmark smoke job;
- supported-Node-version matrix;
- adapter-specific integration jobs when live clients are added.

## Execution order

1. Label semantic classification.
2. Signal-effect policy.
3. Idempotent signal ledger, replay handling, and retractions.
4. Profile application orchestration.
5. End-to-end authorization/deletion orchestration.
6. Freshness and fallback health model.
7. Privacy-safe labeler discovery.
8. Live protocol adapters.
9. Reference local and durable persistence adapters.
10. Performance, compatibility, and release hardening.

## Review cadence

- Review P0 items for every change touching labels, consent, source ingestion, profile state, persistence, or deletion.
- Review P1 operational risks before adding each live adapter or durable deployment profile.
- Reconcile this plan and `canonical-status.md` after every major phase.
- Refresh protocol and privacy threat models at least quarterly or when upstream protocol semantics change.
