# Canonical Project Status

This document is the authoritative summary of the current repository state.

Last reconciled against `main` through merged PR #111 on 2026-08-07.

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

## State authority and placement

Subject-level recommendation state is permitted only in:

1. `device_owned` local-first storage using the `local_only` processing boundary; or
2. `user_owned` remote storage using the `server_allowed` processing boundary, such as an authorized ActivityPod/Solid Pod or equivalent user-controlled remote store.

`provider_owned` application, instance, AppView, and service storage is denied for subject-level recommendation personalization. Generic server consent cannot override that authority boundary.

`shared_operator` storage is limited to non-subject aggregate statistics under the aggregate-only boundary.

Public profile-persistence entry points require an explicit storage manifest before read, write, or delete I/O. Onboarding and ActivityPods profile persistence inherit the same enforcement.

## Current maturity

| Area | Status |
| --- | --- |
| Dataset, schema, normalization, catalog | Mature library capability |
| Consent, privacy, deletion contracts | Implemented and repository-wide public/user-controlled affinity policy enforced |
| Onboarding selection/profile bootstrap | Implemented; explicit selections seed consented profile state and optional user-controlled persistence |
| Interest signals and profile application | Implemented |
| Label semantic classification/effect policy | Implemented conservatively |
| Idempotency, replay, retractions | Implemented core ledger and profile application semantics |
| Derived-state invalidation/recovery | Implemented for embeddings, candidate caches, explanation caches, expiration, retractions, and deletion recovery |
| Embedding, ANN, graph, scoring, reranking | Implemented primitives and adapters |
| Profile-to-results execution orchestration | Implemented; candidate/scoring-input construction intentionally remains injected |
| ActivityPub live integration | Generic public actor/outbox, Mastodon timelines, curated sets, follow packs, featured hashtags, and public trends implemented |
| ATProto live integration | Repository/API normalization plus `queryLabels` and `subscribeLabels` slices implemented |
| ActivityPods/Solid integration | Public outbox/live notifications plus grant-bound user-controlled profile persistence implemented |
| Local-first recommendation state placement | Implemented and enforced at profile persistence boundaries |
| Multi-kind recommendation candidate domain | Not yet implemented as a first-class normalized layer |
| Cold-start candidate generation | Not yet implemented as reusable engine composition |
| First-session recommendation orchestration | Not yet implemented; depends on candidate and scoring-input layers |
| Deployable operator service | Not implemented and not required for local-first use |

## Implemented recommendation pipeline

### User-understanding side

```text
explicit onboarding selections or allowed public evidence
  -> authorization / consent / public-signal policy
  -> normalized evidence
  -> semantic derivation
  -> idempotent/retractable signal ledger
  -> profile application
  -> local or user-owned profile state
```

### Execution side

```text
existing profile
  -> injected scoring-input builder
  -> hybrid scoring
  -> optional metadata-driven diversity/novelty reranking
  -> optional candidate-bound explanations
  -> bounded candidate serving
```

The missing reusable bridge is therefore:

```text
profile
  -> candidate discovery
  -> normalized candidate domain
  -> candidate-type eligibility and policy
  -> scoring-input construction
```

PR #103 intentionally does not fetch candidates or infer provider semantics. That boundary should be preserved.

## Implemented provider and protocol slices

### ActivityPub and Mastodon-compatible sources

- Generic ActivityPub activity normalization.
- Provider-neutral public actor/outbox ingestion.
- Actor identity and outbox binding.
- ActivityStreams `Collection`, `OrderedCollection`, `CollectionPage`, and `OrderedCollectionPage` traversal.
- Correct linked/inline `first` and `next` handling, including ActivityStreams `Link.href` target resolution.
- Page `partOf` validation, bounded traversal, cycle detection, compact resumable cursors, and same-authority URL policy.
- Explicitly public activity filtering before recommendation-source emission.
- Mastodon public, home, and list timeline provider adapters.
- Authorization validation before transport.
- Curated account-set ingestion for Mastodon Collections, Loops Starter Kits, and explicit Pixelfed documents.
- Legacy Fediverse follow-pack ingestion.
- Account eligibility with moved-account resolution, recency, discoverability, noindex/opt-out handling, block/mute/provider policy, and identity binding.
- Public account featured hashtags and public instance trending hashtags.

Private timeline readers may exist for application workflows, but their contents are blocked from positive recommendation-affinity derivation by the shared signal policy.

### ActivityPods/Solid sources and persistence

- ActivityPods actor/WebID identity binding.
- Same-Pod outbox, public-key owner, proxy endpoint, and SPARQL endpoint validation.
- Public ActivityPods outbox adapter built on the generic ActivityPub traversal.
- Anonymous public reads for recommendation content.
- Pod-bound application registration, AccessGrant, optional DataGrant, application actor, expiry, revocation, and `apods:ReadOutbox` validation.
- Dependency-injected Solid Notifications subscription transport.
- Reauthorization before notification processing.
- `Add`, `Remove`, `Create`, `Update`, and `Delete` notification normalization.
- Notification payloads remain control-plane evidence; `Add` requires a public refetch before recommendation use.
- `Remove` produces retraction work, `Create`/`Update` invalidate snapshots, and `Delete` disables sources.
- Grant-bound ActivityPods profile persistence using JSON-LD/LDP semantics and conditional mutation contracts.
- Owner/WebID, application registration, grant, storage-root, container/resource, and access-mode binding.
- Conditional write/delete conflict handling.
- Explicit user-owned state-placement manifest on the bundled ActivityPods persistence adapter.

ActivityPods is a user-controlled remote-storage exception, not a generic provider-server personalization path.

### ATProto sources

- Repository record and provider API normalization.
- Strict DID, handle, NSID, record-key, AT URI, cursor, and record validation.
- Live `queryLabels` ingestion.
- Live `subscribeLabels` ingestion with bounded frame, label, signature, sequence, and checkpoint handling.
- Labeler DID verification, subscription evidence, expiration, negation tombstones, stale-state protection, and provenance.
- Label semantic classification and conservative signal-effect policy.
- Labeler discovery contracts that preserve explicit subscription as a separate user action.

### Public discovery and provider policy

- Curated public account sets and follow packs remain curator/discovery evidence, not viewer endorsement.
- Public featured hashtags are explicit public account metadata.
- Public trends are weak contextual evidence and do not become durable preference without corroboration.
- Optional provider/operator policy sources remain filter/audit evidence only.
- Existing account eligibility provides the reusable gate for future account-candidate generation.

## Core privacy, safety, and recovery behavior

- Ambiguous authorization or consent fails closed.
- Provider-private data cannot become positive recommendation affinity through the shared signal-normalization boundary.
- Private moderation state remains filtering-only.
- User-controlled ActivityPods/Solid Pod state may use the remote path only when storage authority is user-owned and authorization is correctly bound.
- Provider-owned subject-level profile persistence is denied.
- Profile persistence requires a placement manifest before I/O.
- Source records, URLs, identifiers, timestamps, cursors, limits, grants, signatures, and provider records are bounded and runtime-validated.
- Provider-specific semantics remain outside generic scoring contracts.
- Unknown or moderation-oriented labels do not silently become positive interests.
- Replay, stale-state, negation, tombstone, and duplicate handling are conservative.
- Derived-state invalidation is journaled and repairable rather than rolling back authoritative profile state after an invalidator failure.
- Semantic profile checkpoints detect missed invalidation work after crash/journal failure.
- Subject deletion persists deletion intent, retries authoritative deletion during repair, and then invalidates dependent embeddings/caches.

## Completed prerequisites for candidate/onboarding work

The following architectural prerequisites are no longer outstanding blockers:

- label semantic classification;
- signal-effect policy;
- idempotent signal ledger and retractions;
- profile application orchestration;
- normalized evidence ingestion;
- profile-to-results execution orchestration;
- ATProto live labels;
- Mastodon/ActivityPub live inputs;
- curated account sets and legacy follow packs;
- account eligibility;
- generic ActivityPub outbox traversal;
- ActivityPods live outbox and user-controlled profile persistence;
- public/user-controlled signal invariant;
- derived-state invalidation and crash recovery;
- storage-authority modeling;
- local-first state-placement policy;
- mandatory profile-persistence placement manifests.

These phases should not be reimplemented under onboarding-specific names.

## Highest-priority remaining architectural gap

The repository understands:

1. what the user is interested in through profiles; and
2. how to score/rerank/explain/serve already-prepared recommendation inputs.

It does not yet have a reusable first-class answer for:

- what kinds of entities can be recommendation candidates;
- how candidate identity is normalized across protocols;
- where candidates come from;
- how discovery provenance differs from user endorsement;
- how profile interests generate useful candidates before interaction history exists;
- how type-specific eligibility is applied before scoring;
- how normalized candidates become the scoring inputs expected by PR #103.

That is the immediate dependency before a higher-level first-session onboarding orchestrator.

## Post-PR #111 execution roadmap

The detailed acceptance criteria and non-goals live in [`candidate-cold-start-onboarding-roadmap.md`](candidate-cold-start-onboarding-roadmap.md).

The dependency order is:

1. **Candidate domain and candidate-source contracts**
   - normalized multi-kind candidate identity;
   - bounded provenance and verification state;
   - protocol-neutral candidate-source adapters.
2. **Cold-start candidate generation**
   - profile-to-candidate matching without requiring behavioral history;
   - reuse existing curated/public discovery sources;
   - ATProto accounts/feeds/lists/starter packs/labelers behind verification boundaries.
3. **Candidate eligibility and policy composition**
   - reuse existing account eligibility;
   - define gates for posts, feeds, lists, starter packs, labelers, communities, hashtags/topics, and instances;
   - keep viewer-private moderation state filtering-only.
4. **Cold-start scoring-input builder**
   - transform profile plus eligible normalized candidates into deterministic/entity/graph/embedding inputs for the existing hybrid scorer;
   - provide conservative no-history fallbacks.
5. **First-session recommendation orchestrator**
   - onboarding bootstrap -> candidate discovery -> eligibility -> scoring inputs -> existing execution orchestrator -> bounded recommendations.
6. **Recommendation action-plan contracts**
   - protocol-neutral plans for follow/subscribe/join/follow-hashtag/register operations;
   - application executed, explicitly user-confirmed.
7. **Onboarding lifecycle and refresh**
   - edit selections, rerun, retract, expire, resume, refresh, and invalidate derived state through existing recovery machinery.
8. **Reference onboarding integration and UX examples**
   - demonstrate the engine contracts without making UI or framework choices part of the recommendation core.

A repository-driven correctness, privacy, or security finding may change this order, but the change should be documented before implementation.

## Other remaining work

The candidate/onboarding sequence is the primary product-architecture dependency, but production hardening still includes:

- reference device-local persistence adapters such as IndexedDB/SQLite or equivalent;
- broader generic Solid Pod reference composition beyond the ActivityPods-specific adapter;
- privacy-safe health/freshness observability;
- property/fuzz/replay/concurrency/cancellation/reconnect tests where applicable;
- benchmarks and performance budgets;
- examples and compatibility guidance;
- release automation;
- optional operator HTTP/workers for deployments that choose centralized infrastructure, without permitting provider-owned subject-level personalization state.

Additional live protocol clients should be added when they plug into or unlock the candidate architecture, not simply to accumulate integrations.

## Definition of production completeness

The project should not be described as a complete recommendation product or turnkey hosted service until it has:

- a first-class multi-kind candidate domain;
- tested cold-start candidate generation;
- explicit eligibility policy for every served candidate kind;
- a reusable scoring-input builder connecting candidates to the existing execution orchestrator;
- end-to-end first-session recommendation composition;
- correct lifecycle/retraction behavior after onboarding edits and source changes;
- at least one tested device-local persistence reference path;
- a tested user-controlled remote persistence path (the ActivityPods path exists; broader Solid reference coverage remains desirable);
- privacy-safe operational health behavior;
- replay, concurrency, cancellation, reconnect, and crash-recovery coverage appropriate to stateful/networked adapters;
- accurate integrator documentation and examples.

A provider-owned durable server is not a production-completeness requirement for subject-level personalization and is prohibited by the current storage-authority policy. Optional operator infrastructure may hold only policy-permitted state such as aggregate statistics or infrastructure that does not assume authority over a user's recommendation profile.

Today the repository is a substantial, reusable recommendation-engine library with strong privacy/state-placement enforcement, real ActivityPub/ATProto/ActivityPods integration slices, onboarding profile seeding, durable derived-state recovery, and a profile-to-serving execution orchestrator. Its largest remaining architectural gap is reusable candidate discovery and cold-start composition between the profile and scoring layers.
