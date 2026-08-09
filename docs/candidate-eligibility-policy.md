# Candidate eligibility and policy composition

This document describes Phase 3 of `candidate-cold-start-onboarding-roadmap.md`.

## Purpose

Candidate generation answers “what public things might match this profile?” Eligibility answers “is this particular candidate safe and valid to score for this viewer right now?”

The boundary is deliberately ordered before expensive scoring:

```text
normalized candidate
  -> identity / verification
  -> type-specific availability
  -> provider policy
  -> viewer-private safety constraints
  -> eligible candidate
```

Eligibility does not create positive affinity features and does not execute protocol actions.

## Account policy reuse

Accounts are not reimplemented in the generic candidate layer. `evaluateRecommendationCandidateEligibility` delegates account freshness, deletion/deactivation/suspension, unresolved activity, moved-account traversal, move-loop protection, and the default 45-day activity rule to the existing `evaluateRecommendationAccountEligibility` API.

The resolved current account identity is returned as a bounded `resolvedAccount` binding. If viewer-safety evaluation is configured, the same binding is supplied to that evaluator so a moved account is checked using its current identity rather than only the stale discovery identity.

## Explicit policies by candidate kind

- **account** — existing account eligibility gate; explicit provider policy; optional viewer safety.
- **post** — available, explicitly public, identity-bound, and at least source asserted.
- **feed/list** — available, resolvable, and authority verified or canonical.
- **starter pack** — available, resolvable, current, bounded membership, and authority verified or canonical.
- **labeler** — available plus verified DID/identity and strong candidate verification. Eligible labelers always retain `requiresExplicitSubscription=true`.
- **community** — available, confirmed to exist, and at least source asserted.
- **hashtag** — explicitly public, normalized, and at least source asserted.
- **topic** — canonical catalog identity, canonical candidate verification, and policy-safe metadata.
- **instance** — current and healthy; signup recommendations additionally require open registration; candidate must be at least source asserted.

Unknown availability fails closed where availability is a required property. Provider-policy denial happens before viewer-private evaluation.

## Viewer-private safety boundary

Blocks, mutes, domain blocks, keyword filters, label preferences, and equivalent viewer settings remain filter-only state. The generic candidate eligibility API receives only an evaluator, not the underlying private lists.

The evaluator declares storage authority and processing boundary. Subject-level viewer safety is allowed only when the existing storage-authority policy allows it:

- device-owned + local-only processing;
- user-owned + server-allowed processing, including user-controlled ActivityPods/Solid-style storage.

Provider-owned or shared-operator subject-level viewer state is rejected before the evaluator is called.

The public eligibility result exposes only privacy-safe generic outcomes such as `viewer_safety_denied` or `viewer_safety_incomplete`. It never copies the matched block, mute, domain, keyword, or label into affinity features or explanation text.

An empty but complete moderation snapshot is a valid state and allows the candidate. Incomplete required safety evidence fails closed.

## Batch filtering

`filterRecommendationEligibleColdStartCandidates` consumes Phase 2 `{ candidate, match }` records and preserves `match` unchanged. Candidate facts are resolved separately from viewer-private safety state. Bounded concurrency, duplicate-identity rejection, cancellation, and privacy-safe partial failure reporting prevent one broken evidence provider from dropping healthy candidates or exposing provider diagnostics.

## Phase boundary

Phase 3 outputs only eligible candidates plus their unchanged Phase 2 match features and privacy-safe eligibility result. The next dependency-ordered phase is **Phase 4 — cold-start scoring-input builder**, which converts these eligible candidates into the deterministic/entity/graph/embedding inputs expected by the existing execution orchestrator.