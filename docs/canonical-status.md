# Canonical Project Status

This document is the authoritative architectural summary of the current repository state.

**Last reconciled against `main` through commit d66c76b (Phase 6) on 2026-09-28. Phases 4, 5 and 6 landed as PRs #125, #126 and #127.**

For the concise phase ledger, see [`current-roadmap-status.md`](current-roadmap-status.md). For detailed candidate/onboarding acceptance criteria, see [`candidate-cold-start-onboarding-roadmap.md`](candidate-cold-start-onboarding-roadmap.md) and its normative [`candidate-roadmap-safety-amendments.md`](candidate-roadmap-safety-amendments.md).

## Mission and boundaries

Open Interest Clusters is a portable, privacy-preserving recommendation and semantic-interest substrate for ActivityPub, ATProto, ActivityPods/Solid, local-first applications, and provider-specific integrations.

The core remains protocol-neutral, runtime-neutral, deny-by-default, and infrastructure-neutral. Provider transports, credentials, HTTP signatures, OAuth, retry policy, persistence engines, ANN implementations, deployment frameworks, and application user interfaces stay dependency-injected or external.

The engine owns recommendation-domain policy and deterministic composition. Applications and deployments own authentication, user accounts, UI, provider actions, scheduling, and adapter lifecycle.

## Repository-wide recommendation privacy policy

Recommendation affinity is restricted at the shared normalized-signal boundary to:

- explicitly public provider evidence using a public visibility/access basis;
- ATProto public-repository evidence;
- explicit user-owned local evidence under the local-only processing boundary;
- narrowly authorized ActivityPods/Solid Pod evidence when the state and access path are demonstrably controlled by the user and satisfy the repository's storage-authority policy.

Generic consent does not permit provider-private records to become affinity evidence. Authenticated access is not, by itself, recommendation permission.

Blocks, mutes, domain blocks, keyword filters, safety preferences, and equivalent private moderation state are filtering constraints only. They may suppress, exclude, or explain candidates locally/user-owned, but must not become positive interest evidence.

Subject-level recommendation state is permitted by policy only in device-owned local-first storage or explicitly user-owned remote storage. Provider-owned subject-level personalization remains denied. Shared-operator storage is limited to policy-permitted non-subject or aggregate state. Public persistence entry points enforce this placement policy before I/O; the low-level in-memory profile store still has a documented aggregate-only enforcement gap when callers explicitly enable that boundary, so callers must not treat the store alone as a universal state-placement guard.

## Current maturity

| Area | Status |
| --- | --- |
| Dataset, schema, normalization, catalog | Implemented mature library capability |
| Consent, authorization, privacy, deletion | Implemented; deny-by-default and public/user-controlled affinity boundary enforced |
| Onboarding selection/profile bootstrap | Implemented |
| Interest signals and profile application | Implemented |
| Label semantics/effect policy | Implemented conservatively |
| Idempotency, replay, retractions, expiration | Implemented |
| Derived-state invalidation/recovery | Implemented |
| Embedding, ANN, graph/entity, scoring, reranking | Implemented primitives/adapters |
| Profile-to-results execution orchestration | Implemented; scoring-input construction intentionally injected |
| ActivityPub/Mastodon live integration | Implemented integration slices |
| ATProto live integration | Implemented repository/API normalization plus `queryLabels`/`subscribeLabels` slices |
| ActivityPods/Solid integration | Implemented public/live outbox path plus grant-bound user-controlled profile persistence |
| Local-first/user-owned state placement | Implemented and enforced at public persistence boundaries; low-level aggregate-only store caveat remains documented |
| Multi-kind recommendation candidate domain | **Implemented** |
| Candidate-source adapter boundary | **Implemented** |
| Cold-start candidate generation | **Implemented** |
| Candidate eligibility/policy composition | **Implemented** |
| Protocol/application profile capability hardening | **Implemented** |
| Runtime provider discovery/capability resolution | **Implemented; late-review authority/cache/freshness hardening applied in follow-up** |
| Cold-start scoring-input builder | **Implemented** (PR #125) |
| First-session recommendation orchestration | **Implemented** (PR #126); see [`recommendation-first-session-orchestrator.md`](recommendation-first-session-orchestrator.md) |
| Generalized recommendation action-plan contracts | **Implemented** (d66c76b); non-executable, gated on eligibility and verified provider capability. The onboarding hashtag-follow plan remains separate. See [`recommendation-candidate-action-plans.md`](recommendation-candidate-action-plans.md) |
| Onboarding lifecycle/refresh composition | **Implemented** (merged in PRs #128 to #140, released in 0.4.0); see [`phase7-onboarding-lifecycle.md`](phase7-onboarding-lifecycle.md) |
| Reference onboarding integration/UX examples | **Implemented on branch** `feat/phase8-reference-onboarding` (pending merge): runnable examples with in-memory stores and fake providers, plus tests. UX copy, accessibility and IndexedDB/SQLite shape are guidance only. Real provider adapters, real device persistence backends, ATProto spaces adapters, repo/MST proofs and HTTP signature verification are not done. See [`phase8-reference-onboarding.md`](phase8-reference-onboarding.md) |
| Turnkey operator service | Not implemented and not required for local-first use |

## Implemented pipeline

### User-understanding side

```text
explicit onboarding selections or allowed public/user-controlled evidence
  -> authorization / consent / public-signal policy
  -> normalized evidence
  -> semantic derivation
  -> idempotent/retractable signal ledger
  -> profile application
  -> local or user-owned profile state
```

### Candidate preparation side

```text
profile
  -> bounded candidate-source fan-out
  -> normalized multi-kind candidates
  -> deterministic profile/candidate matching
  -> identity resolution and verification
  -> candidate-type eligibility / provider policy / viewer safety
  -> eligible normalized candidate set
```

### Execution side

```text
prepared scoring inputs
  -> hybrid scoring
  -> optional diversity/novelty reranking
  -> optional candidate-bound explanations
  -> bounded candidate serving
```

The reusable scoring bridge is now implemented:

```text
profile + eligible normalized candidates
  -> cold-start scoring-input construction   [IMPLEMENTED]
  -> existing execution orchestrator
```

The end-to-end composition is implemented as the first-session orchestrator:

```text
profile + sources + injected eligibility
  -> first-session orchestrator   [IMPLEMENTED]
  -> candidate-bound recommendations
  -> generalized action plans, created by the application   [IMPLEMENTED]
```

PR #103 intentionally does not fetch candidates or infer provider semantics. That separation remains correct.

## Candidate architecture now implemented

### Phase 1 — candidate domain and source contracts

The normalized candidate domain supports:

- `account`
- `post`
- `feed`
- `list`
- `starter_pack`
- `labeler`
- `community`
- `hashtag`
- `topic`
- `instance`

Candidate identity is stable and bounded, with exact provider-native/protocol identity preserved. Provenance and verification state remain distinct from viewer endorsement. Candidate-source adapters are separate from generic evidence adapters and declare protocol bindings, candidate kinds, authority, privacy, transport, pagination, abort, and verification capabilities.

Remote candidate discovery receives a purpose-limited privacy-redacted request rather than raw profile/subject/moderation context.

### Phase 2 — cold-start candidate generation

The repository can now generate bounded candidate sets from an existing recommendation profile without behavioral history. It supports multi-source fan-out, deterministic duplicate collapse, local profile matching, partial source failures, cancellation, public metadata matching, and preservation of provenance/verification.

### Phase 3 — candidate eligibility and policy composition

Every supported candidate kind now passes an explicit eligibility boundary before expensive scoring/serving. The account path reuses current identity/moved-account resolution, 45-day activity policy, deactivated/suspended/deleted/unresolved rejection, discoverability/noindex/opt-out behavior, provider policy, and viewer safety.

Private moderation state remains filter-only and is not copied into affinity features or public explanations.

## Protocol/application capability architecture

The repository now separates protocol semantics from application/platform features.

- ActivityPub does not imply Mastodon.
- ATProto does not imply Bluesky.
- ActivityPods may expose ActivityPub plus Solid/ACL semantics without ATProto.
- A provider may expose multiple protocol bindings simultaneously.

Profile/application feature support uses `supported`, `unsupported`, or `unknown`; privacy-relevant unknown state fails closed where required.

Mastodon-compatible and Bluesky-compatible capability profiles are application-specific conveniences, not protocol defaults. Custom ATProto applications can supply adapter-normalized profile text without being parsed as `app.bsky.actor.profile`.

Compound/camel hashtag phrase expansion is conservative and matching-only. It does not rewrite canonical hashtag identity or perform dictionary segmentation of arbitrary lowercase compounds.

## Runtime provider discovery — completed in PR #122 and hardened after late review

`discoverRecommendationProviderCapabilities` is a thin layer above hardened adapters. It resolves current provider/application capability observations without performing arbitrary network fetching itself.

Key invariants:

- provider/server identity is distinct from application/client identity;
- protocol bindings are additive rather than flattened;
- application identity/profile claims carry their own explicit authority and do not inherit the maximum authority of unrelated protocol bindings;
- missing application-claim authority is treated as weak provider-probe evidence for backward compatibility;
- weak provider fingerprinting cannot become application identity/profile authority by itself;
- conflicting strong application identity evidence fails closed;
- same-authority capability conflicts resolve to `unknown`;
- missing capability evidence remains `unknown`;
- provider identity mismatches are rejected;
- cache entries are scoped by provider + application identity, validated before reuse, and never resurrected when stale;
- cached application profiles without a bound application identity are rejected and rediscovered;
- freshness is sampled again after asynchronous cache/probe work and before final descriptor return;
- malformed/stale cache entries trigger fresh discovery rather than stale fallback;
- cache failures do not override valid fresh discovery;
- only explicitly classified retryable probe failures use bounded exponential backoff;
- abort/cancellation is checked around cache/probe/retry boundaries;
- capability discovery never substitutes for consent, OAuth authorization, ActivityPods/Solid ACL/grant authorization, state-placement policy, or candidate-native identity verification.

See [`recommendation-provider-discovery.md`](recommendation-provider-discovery.md).

## Provider/protocol slices already available

### ActivityPub and Mastodon-compatible

- generic ActivityPub normalization and public actor/outbox traversal;
- collection/page traversal with identity, same-authority, cycle, pagination, and cursor hardening;
- Mastodon timeline adapter paths;
- curated account-set ingestion, legacy follow packs, public featured hashtags, and public trends;
- account activity/current-identity/opt-out/provider-policy/viewer-safety gates.

### ActivityPods/Solid

- ActivityPods actor/WebID and same-Pod binding;
- public outbox and live-notification composition;
- grant reauthorization and public-refetch requirements;
- user-controlled profile persistence with registration/grant/storage binding and conditional mutation;
- explicit user-owned storage placement at persistence boundaries.

ActivityPods is a user-controlled remote-storage exception, not a provider-owned personalization path.

### ATProto

- repository/provider record normalization;
- strict DID, handle, NSID, record-key, AT URI, cursor, and record validation;
- `queryLabels` and `subscribeLabels` live slices;
- labeler verification, tombstones, expiration, stale-state protection, semantic classification/effect policy;
- labeler discovery with explicit subscription kept separate;
- application-specific profile parsing/capability handling.

Third-party ATProto directories remain optional untrusted discovery hints and cannot create authority, consent, subscription, or positive interest merely through listing/popularity.

## Completed prerequisites that must not be reimplemented

The following are already satisfied and should not be renamed/rebuilt inside later onboarding phases:

- consent and source authorization;
- label semantic classification;
- signal-effect policy;
- idempotent signal ledger and retractions;
- profile application orchestration;
- normalized evidence ingestion;
- onboarding profile bootstrap;
- profile-to-results execution orchestration;
- live ActivityPub/Mastodon/ATProto/ActivityPods slices described above;
- account eligibility;
- derived-state invalidation and recovery;
- storage-authority and state-placement enforcement at public persistence boundaries, with the low-level aggregate-only store caveat remaining explicit;
- candidate domain/source contracts;
- cold-start candidate generation;
- candidate eligibility/policy composition;
- protocol/application profile capability hardening;
- runtime provider discovery/capability resolution;
- cold-start scoring-input builder (Phase 4);
- first-session recommendation orchestrator (Phase 5);
- generalized candidate action-plan contracts (Phase 6).

## Completed phase — Phase 4 cold-start scoring-input builder

The repository now understands:

1. the user's permitted interest profile;
2. what candidate entities exist and where they came from;
3. which candidates are currently eligible;
4. what protocols/application/provider capabilities are available; and
5. how to score/rerank/explain/serve already-prepared `HybridScoreInput` values.

The bridge now turns the current profile plus eligible normalized candidates into finite, bounded, candidate-bound scorer inputs without application-specific ad hoc feature assembly.

Phase 4 must:

- preserve exact candidate identity while mapping to scorer-facing IDs;
- compute deterministic cold-start features;
- reuse existing entity, graph, embedding and ANN infrastructure where available;
- support no behavioral history as a normal state;
- conservatively omit/neutralize missing bandit/context/session history;
- reject unknown candidate references, duplicate scorer identities, non-finite features, stale profile/match bindings, and mismatched feature maps;
- remain bounded and cancellation-aware;
- avoid exposing profile/subject/private moderation data to remote feature computation;
- bind every scored result back to exactly one normalized candidate.

See [`current-roadmap-status.md`](current-roadmap-status.md) for the phase ledger and required Phase 4 test matrix.

## Phases 5 and 6 — implemented

- **Phase 5, first-session orchestrator** (PR #126): `createRecommendationFirstSessionOrchestrator` reads the profile, generates candidates, evaluates eligibility through an injected callback, builds Phase 4 scoring input, and runs the existing execution orchestrator. It does not run onboarding bootstrap and has no per-kind caps. Details are in [`recommendation-first-session-orchestrator.md`](recommendation-first-session-orchestrator.md).
- **Phase 6, action plans** (d66c76b): `createRecommendationCandidateActionPlan` produces non-executable plans for account, feed, list, starter-pack, labeler, community, hashtag, and instance candidates. Post and topic candidates have no mutation plan. A plan requires an eligible result for the exact candidate snapshot and fresh provider capability evidence with a verified protocol binding. Every provider mutation stays application-executed, explicitly user-confirmed, and revalidated immediately before execution. The checklist is in [`phase6-review-checklist.md`](phase6-review-checklist.md).

## Remaining roadmap

1. **Phase 7 — Onboarding lifecycle and refresh** (merged, released in 0.4.0)
   - edit/retract/rerun/expire/refresh/resume using the existing ledger/invalidation/recovery machinery. See [`phase7-onboarding-lifecycle.md`](phase7-onboarding-lifecycle.md).
2. **Phase 8 — Reference onboarding integration and UX examples** (implemented on branch, pending merge)
   - `examples/` demonstrates the stable engine contracts with in-memory stores and fake providers, and `tests/phase8-reference-*.test.ts` runs it. UI/framework choices stay outside the core. See [`phase8-reference-onboarding.md`](phase8-reference-onboarding.md).

## Other remaining hardening/integration work

Outside the primary candidate/onboarding dependency chain:

- reference IndexedDB/SQLite or equivalent device-local persistence;
- broader generic Solid Pod reference composition beyond ActivityPods-specific support;
- verified cross-protocol equivalence where independently provable, without privacy laundering;
- privacy-safe health/freshness observability;
- property/fuzz/replay/concurrency/cancellation/reconnect tests where applicable;
- benchmarks and performance budgets;
- examples and compatibility guidance;
- release automation;
- optional operator HTTP/workers restricted to policy-permitted state and never provider-owned subject personalization.

Additional integrations should plug into the established provider capability, candidate, authorization, and privacy boundaries rather than accumulating special cases.

## Production-completeness boundary

The project should not be described as a complete turnkey recommendation product until it has at least:

- the Phase 4 scoring-input bridge (done);
- Phase 5 end-to-end first-session composition (done);
- generalized action contracts (done) and lifecycle/refresh contracts (Phase 7, done);
- at least one reference device-local persistence path;
- privacy-safe operational health behavior;
- appropriate replay/concurrency/cancellation/reconnect/crash-recovery coverage;
- accurate integrator examples and compatibility guidance.

A provider-owned durable server is not a production-completeness requirement for subject-level personalization and remains prohibited by current storage-authority policy.
