# Canonical Project Status

This document is the authoritative architectural summary of the current repository state.

**Last reconciled against `main` through merged PR #122 on 2026-08-10.**

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

Subject-level recommendation state is permitted only in device-owned local-first storage or explicitly user-owned remote storage. Provider-owned subject-level personalization remains denied. Shared-operator storage is limited to policy-permitted non-subject or aggregate state.

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
| Local-first/user-owned state placement | Implemented and enforced |
| Multi-kind recommendation candidate domain | **Implemented** |
| Candidate-source adapter boundary | **Implemented** |
| Cold-start candidate generation | **Implemented** |
| Candidate eligibility/policy composition | **Implemented** |
| Protocol/application profile capability hardening | **Implemented** |
| Runtime provider discovery/capability resolution | **Implemented** |
| Cold-start scoring-input builder | **Not yet implemented — next phase** |
| First-session recommendation orchestration | Not yet implemented; depends on scoring-input builder |
| Recommendation action-plan contracts | Not yet implemented |
| Onboarding lifecycle/refresh composition | Not yet implemented as the higher-level candidate/onboarding lifecycle |
| Reference onboarding integration/UX examples | Not yet implemented |
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

The remaining reusable bridge is therefore now:

```text
profile + eligible normalized candidates
  -> cold-start scoring-input construction   [NEXT]
  -> existing execution orchestrator
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

## Runtime provider discovery — completed in PR #122

`discoverRecommendationProviderCapabilities` is a thin layer above hardened adapters. It resolves current provider/application capability observations without performing arbitrary network fetching itself.

Key invariants:

- provider/server identity is distinct from application/client identity;
- protocol bindings are additive rather than flattened;
- weak provider fingerprinting cannot become application identity/profile authority by itself;
- conflicting strong application identity evidence fails closed;
- same-authority capability conflicts resolve to `unknown`;
- missing capability evidence remains `unknown`;
- provider identity mismatches are rejected;
- cache entries are scoped by provider + application identity, validated before reuse, and never resurrected when stale;
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
- explicit user-owned storage placement.

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
- storage-authority and state-placement enforcement;
- candidate domain/source contracts;
- cold-start candidate generation;
- candidate eligibility/policy composition;
- protocol/application profile capability hardening;
- runtime provider discovery/capability resolution.

## Immediate next phase — Phase 4 cold-start scoring-input builder

The repository now understands:

1. the user's permitted interest profile;
2. what candidate entities exist and where they came from;
3. which candidates are currently eligible;
4. what protocols/application/provider capabilities are available; and
5. how to score/rerank/explain/serve already-prepared `HybridScoreInput` values.

The missing bridge is to turn the current profile plus eligible normalized candidates into finite, bounded, candidate-bound scorer inputs without application-specific ad hoc feature assembly.

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

## Remaining roadmap after Phase 4

1. **Phase 5 — First-session recommendation orchestrator**
   - onboarding bootstrap -> candidate discovery -> capability-aware source use -> eligibility -> Phase 4 scoring inputs -> existing execution -> bounded recommendations.
2. **Phase 6 — Recommendation action-plan contracts**
   - non-executable protocol-neutral plans; every provider mutation remains explicit and user-confirmed.
3. **Phase 7 — Onboarding lifecycle and refresh**
   - edit/retract/rerun/expire/refresh/resume using existing ledger/invalidation/recovery machinery.
4. **Phase 8 — Reference onboarding integration and UX examples**
   - demonstrate stable engine contracts while keeping UI/framework choices outside the core.

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

- the Phase 4 scoring-input bridge;
- Phase 5 end-to-end first-session composition;
- correct action/lifecycle contracts for the intended integrations;
- at least one reference device-local persistence path;
- privacy-safe operational health behavior;
- appropriate replay/concurrency/cancellation/reconnect/crash-recovery coverage;
- accurate integrator examples and compatibility guidance.

A provider-owned durable server is not a production-completeness requirement for subject-level personalization and remains prohibited by current storage-authority policy.
