# Risk-Ranked Hardening Plan

This document defines a practical, risk-ranked hardening roadmap for Open Interest Clusters. It is tied to the current architecture and implementation style in the repository.

## Scope and principles

- Accuracy over speed: reject invalid states at boundaries.
- Fail closed by default for consent, privacy, and trust-boundary checks.
- No duplicate logic: centralize guards and retry policies where possible.
- Deterministic behavior and reproducibility for all ranking-critical paths.
- Privacy-safe observability: no subject identifiers or sensitive payloads in logs/metrics.

## Risk ranking model

- P0: security, privacy, or correctness defect that can cause policy bypass, unsafe output, or data corruption.
- P1: reliability and availability risk that can break production behavior under normal failures.
- P2: maintainability or performance risk that can become correctness or velocity debt.

## P0 hardening items

### 1. Unified retry and backoff policy surface

Risk:
- Retry behavior currently exists in multiple modules (remote loading, embedding, safe browsing, ANN orchestration) with similar but not identical semantics.

Impact:
- Inconsistent retryability decisions and backoff settings can cause request storms, stale state, or uneven recovery behavior.

Controls:
- Introduce one shared internal retry policy contract (attempt limits, jitter strategy, retryable classification, cancellation semantics).
- Keep module-specific defaults, but map through one policy engine.
- Include hard ceilings for max delay, total elapsed time, and attempts.

Tests:
- Deterministic retry tests with seeded random source.
- Cancellation and timeout propagation tests.
- Retry classification tests for transient and permanent failures.

Definition of done:
- All retrying modules use the shared retry policy helper.
- No unbounded retry loops.
- Existing behavior remains backward compatible where intended.

### 2. Consent and privacy redaction invariants as reusable assertions

Risk:
- Consent safety is strong, but redaction invariants are mostly validated through specific test paths rather than a reusable invariant helper.

Impact:
- Future features can accidentally leak subject identifiers into errors, audit payloads, or telemetry.

Controls:
- Add reusable privacy-safe error/audit assertion utilities.
- Require all consent and deletion errors to pass redaction checks in tests.
- Add static lint rule or test helper for forbidden fields in audit payloads.

Tests:
- Redaction property tests across error and audit object serializers.
- Snapshot tests for privacy-safe event envelopes.

Definition of done:
- New and existing consent enforcement tests use shared redaction assertions.
- No plaintext subject identifiers in audit event serialization.

### 3. Protocol ingestion trust-boundary hardening

Risk:
- Protocol source mapper behavior is strict, but evolving provider formats can introduce edge-case bypasses.

Impact:
- Invalid provider records can enter normalization and degrade recommendation quality or policy safety.

Controls:
- Add strict allowlist parsing for provider record fields used in canonical projection.
- Explicitly reject unknown or mixed trust-boundary states when policy cannot be determined.
- Record normalization rejection reason counters (privacy-safe only).

Tests:
- Fuzz-inspired tests for malformed ActivityPub and ATProto payloads.
- Regression tests for known invalid combinations (visibility vs access basis mismatches).

Definition of done:
- Protocol normalizers reject malformed inputs deterministically.
- Rejection reasons are observable through sanitized counters.

## P1 hardening items

### 4. Self-healing freshness and staleness controls

Risk:
- Fetch and indexing paths are resilient, but stale data windows are not centrally governed.

Impact:
- Recommendation quality can drift with stale embeddings, stale ANN snapshots, or stale remote datasets.

Controls:
- Add freshness metadata contract for key artifacts (dataset, embeddings, ANN index snapshot).
- Add stale-read policy modes: allow, degrade, deny.
- Add automatic recovery workflows (background refresh with capped retries and backoff).

Tests:
- Freshness threshold tests.
- Stale-mode behavior tests for allow/degrade/deny.
- Recovery retry cadence tests.

Definition of done:
- Every artifact used in ranking has explicit freshness metadata.
- Behavior under stale inputs is deterministic and test-covered.

### 5. Circuit-breaker and fallback observability

Risk:
- ANN orchestration has robust circuit behavior, but operational diagnosis can still be expensive under cascading failure.

Impact:
- Slow incident response and possible silent quality degradation.

Controls:
- Add structured, privacy-safe event counters and health snapshots.
- Define SLO-aligned alerts around repeated fallback activation.
- Ensure fallback mode marks response metadata clearly for downstream analytics.

Tests:
- Simulated provider outage tests with event expectations.
- Recovery tests confirming circuit closure and return to preferred provider.

Definition of done:
- Fallback and recovery are visible in one operational view.
- No hidden fail-open transitions.

### 6. Input sanitation and canonical normalization alignment

Risk:
- Hashtag, URL, and protocol field sanitation are strong but distributed.

Impact:
- Inconsistent canonicalization can cause duplicate entities, lookup misses, or skewed scores.

Controls:
- Define one canonical string/identifier normalization policy by input class.
- Add normalization conformance tests across modules.

Tests:
- Cross-module normalization equivalence tests for hashtags, URLs, and identifiers.
- Unicode edge-case tests.

Definition of done:
- Canonicalization behavior is consistent across ingestion and ranking paths.

## P2 hardening items

### 7. Shared guard and validator utilities

Risk:
- Similar bounded-string and control-character guards appear across modules.

Impact:
- Duplication increases drift risk and maintenance cost.

Controls:
- Consolidate common guards in an internal utility module.
- Keep module-local wrappers for domain-specific error messages.

Tests:
- Utility-level guard tests.
- Existing module tests updated to preserve semantics.

Definition of done:
- No duplicated generic guard logic in core recommendation modules.

### 8. Performance and memory baselines

Risk:
- Current implementation is clean, but no formal regression budget is defined.

Impact:
- Future changes can add latent cost and degrade throughput.

Controls:
- Add lightweight benchmark suite for normalization, scoring, ANN orchestration overhead, and candidate serving.
- Set budget thresholds and fail CI for material regressions.

Tests:
- Benchmark smoke tests in CI profile.

Definition of done:
- Baseline and budget checks are versioned and enforced.

## CI and branch protections

Minimum recommended branch rules:
- Require passing checks on build, lint:types, and tests.
- Require review approval for changes touching recommendation, consent, security, or protocol normalization modules.
- Disallow force-push on protected branches.
- Require linear history for release branches.

Recommended required checks:
- npm run lint:types
- npm run build
- npm test
- Security scan (dependency and static analysis)

## Secure coding guardrails for contributors

- Reject unknown input shapes at boundaries.
- Sanitize all external identifiers and URLs.
- Use bounded retries with jitter and cancellation support.
- Avoid logging raw external payloads or subject-level identifiers.
- Keep policy evaluation explicit and fail closed when ambiguous.

## Execution order

1. P0 unified retry policy.
2. P0 privacy-redaction invariant helpers.
3. P0 protocol ingestion hardening and malformed-payload tests.
4. P1 freshness and staleness policy rollout.
5. P1 ANN observability and fallback transparency.
6. P2 consolidation and performance budgeting.

## Review cadence

- Weekly hardening review for open P0/P1 items.
- Monthly verification of staleness and retry metrics.
- Quarterly threat-model refresh for protocol adapters and consent boundaries.
