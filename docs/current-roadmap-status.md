# Current recommendation roadmap status

This document is the concise execution-status ledger for the recommendation-engine roadmap. It is reconciled against `main` through merged PR #123 on 2026-08-10, with late-review hardening from PRs #122/#123 tracked in the immediate follow-up.

It complements the detailed architecture and acceptance criteria in:

- `canonical-status.md`
- `candidate-cold-start-onboarding-roadmap.md`
- `candidate-roadmap-safety-amendments.md`
- `recommendation-candidate-domain.md`
- `recommendation-protocol-platform-capabilities.md`
- `recommendation-provider-discovery.md`

When older branch documents or historical phase labels disagree with this file and current `main`, current `main` wins.

## Non-negotiable project boundaries

The engine remains privacy-preserving, consent-respecting, opt-in, protocol-neutral, and local-first by default.

- Positive recommendation affinity may use explicitly public provider evidence, ATProto public-repository evidence, explicit user-owned local evidence, or narrowly authorized user-controlled ActivityPods/Solid Pod evidence permitted by repository policy.
- Provider-private activity and private moderation/settings must not become positive affinity.
- Blocks, mutes, domain blocks, keyword filters, safety settings, and equivalent private state are filtering constraints only.
- Subject-level personalization state may live by policy only in device-owned storage or explicitly user-owned remote storage. Provider-owned subject-level personalization remains denied. Public persistence boundaries enforce that placement policy before I/O; the low-level in-memory profile store still has a documented aggregate-only enforcement gap when callers explicitly enable that boundary.
- ActivityPods providers may support ActivityPub plus Solid/ACL semantics without ATProto; other providers may expose multiple protocol bindings simultaneously.
- Protocol identity must not be collapsed into application identity: ActivityPub does not imply Mastodon and ATProto does not imply Bluesky.
- Curated sets, starter packs, follow packs, directories, labeler directories, and similar sources are discovery provenance, not viewer endorsement.
- Third-party directory results remain untrusted hints until protocol/provider authority verifies the native identity.
- The engine does not auto-follow, auto-subscribe, auto-join, auto-register, or auto-subscribe labelers. Those remain explicit application/user actions.

## Candidate/onboarding roadmap status

| Phase | Status | Primary landed work |
| --- | --- | --- |
| Phase 1 — Candidate domain and candidate-source contracts | **Complete** | PR #114 plus PR #115 hardening |
| Phase 2 — Cold-start candidate generation | **Complete** | PR #116 |
| Phase 3 — Candidate eligibility and policy composition | **Complete** | PR #117; superseded review work from #118/#119 folded into final implementation |
| Phase 3.5 — Protocol/application capability hardening | **Complete** | PR #120 and PR #121 |
| Phase 3.6 — Runtime provider discovery/capability resolution | **Complete; late-review hardening applied** | PR #122 plus follow-up authority/cache/freshness fixes |
| Phase 4 — Cold-start scoring-input builder | **Next** | Not yet implemented as the reusable candidate/profile → scorer-input bridge |
| Phase 5 — First-session recommendation orchestrator | Pending | Depends on Phase 4 |
| Phase 6 — Generalized recommendation action-plan contracts | Pending | Existing hashtag-follow action-plan prerequisite is implemented; generalized candidate-bound plans remain |
| Phase 7 — Onboarding lifecycle and refresh | Pending | Reuses existing retraction/invalidation/recovery architecture |
| Phase 8 — Reference onboarding integration and UX examples | Pending | Depends on stable engine contracts |

The idempotent signal ledger and retraction architecture is **not** Phase 4. It was implemented earlier and is a prerequisite already satisfied by the current repository.

## What is already implemented before Phase 4

### User understanding and state

- explicit onboarding selection and profile bootstrap;
- deny-by-default consent and authorization;
- normalized public/user-controlled evidence ingestion;
- label semantics and signal-effect policy;
- idempotent signal ledger, replay protection, retractions, tombstones, and expiration behavior;
- profile application orchestration;
- privacy-preserving profile persistence and storage-authority enforcement at public persistence boundaries;
- documented low-level aggregate-only store caveat rather than an assumed universal store-level placement guarantee;
- derived-state invalidation, repair, deletion propagation, and crash-recovery barriers;
- embeddings, graph/entity infrastructure, ANN backends, hybrid scoring, bandits, reranking, explanations, and bounded serving.

### Candidate architecture

- first-class candidate kinds: account, post, feed, list, starter pack, labeler, community, hashtag, topic, and instance;
- stable candidate identity and provider-native canonicalization boundaries;
- bounded provenance, verification, availability, and public metadata;
- candidate-source adapters distinct from evidence adapters;
- remote-discovery privacy redaction and provider-policy gates;
- bounded cold-start source fan-out and deterministic duplicate collapse;
- local profile-to-candidate matching;
- candidate eligibility and viewer-safety composition;
- account moved-identity resolution, 45-day activity default, provider policy, opt-out/noindex handling, and fail-closed required state.

### Protocol/application capability architecture

- platform/profile capability states are supported, unsupported, or unknown;
- Mastodon-compatible and Bluesky-compatible profiles are application-specific convenience profiles rather than protocol defaults;
- custom ATProto applications can provide adapter-normalized profile text without being treated as Bluesky;
- compound/camel hashtag matching is conservative and matching-only, without rewriting canonical hashtag identity;
- runtime provider discovery keeps provider/server identity separate from application/client identity;
- multi-protocol bindings are additive;
- application identity/profile claims carry their own authority rather than inheriting unrelated protocol-binding authority;
- missing application-claim authority remains weak provider-probe evidence;
- weak provider fingerprinting cannot establish application identity/profile authority by itself;
- conflicting strong identity evidence fails closed;
- same-authority capability conflicts resolve to unknown;
- cache entries are validated, identity-scoped, freshness-bounded, and re-probed when stale/malformed;
- provider-only cached application profiles are rejected;
- freshness is rechecked after asynchronous cache/probe work and before final descriptor return;
- cache failures do not override otherwise valid fresh discovery;
- only explicitly classified transient probe failures are retried with bounded exponential backoff;
- capability discovery never substitutes for consent, OAuth scope authorization, ActivityPods/Solid ACL/grant validation, or storage-placement policy.

### Existing action-plan prerequisite

The repository already exports the versioned `RecommendationHashtagFollowPlan` and `createRecommendationHashtagFollowPlan`, and onboarding bootstrap can return that plan. Phase 6 therefore extends an existing safe action-plan primitive; it does not start action planning from zero.

## Phase 4 — Cold-start scoring-input builder

Phase 4 is now the highest-priority architectural gap.

### Purpose

Transform a bounded set of already-eligible normalized candidates plus the current local/user-owned recommendation profile into the `HybridScoreInput` structures consumed by the existing execution orchestrator and scorer.

### Required behavior

The builder must:

1. accept a profile/execution context and bounded eligible candidate set;
2. bind every scoring identity losslessly back to exactly one normalized candidate;
3. compute deterministic cold-start features from current profile/candidate evidence;
4. reuse existing entity infrastructure for entity overlap;
5. optionally reuse existing graph infrastructure;
6. optionally reuse compatible embedding/ANN infrastructure;
7. treat no behavioral history as a normal supported condition;
8. omit or conservatively neutralize bandit/context/session features when no history exists;
9. reject non-finite values, duplicate scoring identities, unknown feature IDs, candidate/feature mismatches, and stale feature bindings;
10. keep profile contents, subject identity, and private moderation/filter state out of remote feature computation;
11. remain bounded and cancellation-aware for optional expensive feature resolvers.

### Staleness requirement

Cold-start candidate generation currently includes profile-derived match data. Phase 4 must not blindly trust old match weights after the underlying profile changes. It should recompute profile-dependent weights or bind them to a deterministic profile fingerprint/version and fail closed on stale bindings.

### Candidate/scorer binding

Using `candidateId` as the scorer-facing `clusterId` is acceptable if it is explicit and reversible through a bounded binding map. The generic engine must not pretend provider-native candidate identities are taxonomy cluster identities.

### Required tests

At minimum:

- zero candidates;
- no-history profile;
- optional entity/graph/embedding subsystem absent;
- valid entity/graph/embedding enrichment;
- unknown feature/candidate IDs;
- duplicate scoring identities;
- non-finite scores/features;
- stale profile/match binding;
- ineligible candidate rejection or precondition enforcement;
- cancellation of optional expensive work;
- bounded feature fan-out;
- deterministic result construction independent of asynchronous resolver completion order.

## Remaining roadmap after Phase 4

### Phase 5 — First-session recommendation orchestrator

Compose existing pieces rather than create another engine:

```text
explicit onboarding choices
  -> onboarding bootstrap
  -> local/user-owned profile
  -> cold-start candidate discovery
  -> runtime capability-aware source selection
  -> normalized candidate identity/provenance
  -> eligibility and viewer safety
  -> Phase 4 scoring-input builder
  -> existing execution orchestrator
  -> hybrid scoring/reranking/explanations
  -> bounded first-session recommendations
```

### Phase 6 — Generalized recommendation action-plan contracts

Extend the existing hashtag-follow plan into protocol-neutral, non-executable, candidate-bound plans for actions such as follow account, follow hashtag, subscribe feed/list/labeler, join/follow community, bounded starter-pack expansion, or open eligible instance signup. Every mutation remains application-executed and explicitly user-confirmed, with current identity/eligibility revalidation immediately before provider mutation.

### Phase 7 — Onboarding lifecycle and refresh

Support editing/removing selections, deterministic reruns, retraction propagation, source disappearance, moved/deleted identities, verification loss, candidate/explanation cache invalidation, consent revocation, deletion, and persistence-location transitions by reusing the existing ledger/invalidation/recovery architecture.

### Phase 8 — Reference onboarding integration and UX examples

Demonstrate the stable contracts without making a specific UI framework part of the engine. Local/device-owned persistence should remain the default; user-controlled ActivityPods/Solid persistence is the remote exception.

## Other important work not to confuse with the candidate/onboarding dependency chain

These remain valuable after or alongside the primary roadmap when dependency-safe:

- reference IndexedDB/SQLite device-local persistence;
- broader generic Solid Pod reference composition beyond ActivityPods-specific integration;
- cross-protocol object/account equivalence only with independently verified bindings;
- additional provider/client adapters that plug into the capability and candidate contracts;
- privacy-safe health/freshness observability;
- property/fuzz/replay/concurrency/reconnect testing;
- benchmarks and performance budgets;
- examples and compatibility matrices;
- release automation;
- optional operator infrastructure restricted to policy-permitted non-subject or aggregate state.

## Branch/document reconciliation note

The repository contains many historical implementation and documentation branches. Squash merges mean an already-landed feature branch can appear `diverged` from `main` even when its effective changes are present on `main`; branch ahead/behind counts alone are therefore not evidence that a branch contains newer authoritative work.

The old `docs/canonical-project-status*`, `docs/reconcile-post-pr94-status`, and candidate-roadmap branches predate the current `main` state. Requirements retained in current main documents remain authoritative. A branch-only ATProto third-party-directory policy was recovered during the PR #122 documentation reconciliation because its untrusted-hint boundary remains applicable to the current candidate architecture.
