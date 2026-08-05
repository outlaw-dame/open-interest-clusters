# Canonical Project Status

This document is the authoritative summary of the current repository state.

Last reconciled against the PR #100 head after merged PRs #96, #97, and #99 on 2026-08-05.

## Mission and boundaries

Open Interest Clusters is a portable, privacy-preserving recommendation and semantic-interest substrate for ActivityPub, ATProto, ActivityPods/Solid, local-first applications, and provider-specific integrations.

The core remains protocol-neutral, runtime-neutral, storage-neutral, and deny-by-default. Provider transports, credentials, retry policy, HTTP signatures, OAuth, persistence engines, and deployment frameworks remain dependency-injected or external.

### Recommendation-data privacy policy

Project-owned provider integrations and deployment guidance permit interest inference from:

- explicitly public posts;
- explicitly public account metadata;
- explicitly public topic, hashtag, collection, and provider metadata;
- local user selections or feedback when the user explicitly opts in to the applicable local processing.

Authenticated access is not, by itself, permission to use private data for interest inference. Followed hashtags, private timelines, follower-only posts, direct messages, ACL-controlled Pod resources, and equivalent viewer-private state are not intended recommendation-interest signals.

This is not yet a repository-wide enforced invariant. The generic consent evaluator can authorize private-data ranking when a caller explicitly configures that use, and generic signal derivation currently trusts an allowed consent decision. Until a shared public-only derivation guard is implemented, integrations must prevent private source items from entering recommendation-interest derivation.

The narrow private-data exception in project-owned recommendation flows is moderation and safety preferences. Blocks, mutes, labeler subscriptions, and similar settings may filter, suppress, or explain candidates, but must not be converted into positive interest evidence.

## Current maturity

| Area | Status |
| --- | --- |
| Dataset, schema, normalization, catalog | Mature library capability |
| Consent, privacy, deletion contracts | Mature library capability; public-only inference is not yet globally enforced in generic derivation |
| Interest signals and profile primitives | Implemented |
| Embedding, ANN, graph, scoring, serving | Implemented primitives |
| End-to-end orchestration | Implemented reusable orchestration layer, still not a turnkey service |
| ATProto label semantics | Classification and effect policy implemented conservatively |
| Idempotency, replay, and retraction | Implemented core ledger/retraction primitives; broader integration remains |
| ActivityPub live integration | Generic public actor/outbox, Mastodon timelines, and curated-account provider adapters implemented |
| ATProto live integration | Repository/API, `queryLabels`, and `subscribeLabels` slices implemented |
| ActivityPods/Solid integration | Public outbox and grant-bound live notification slice implemented; Pod persistence and write composition remain incomplete |
| Public discovery sources | Curated account sets, legacy follow packs, public featured hashtags, public trends, and opt-in provider policies implemented |
| Deployable operator service | Not implemented |

## Implemented provider and protocol slices

### ActivityPub and Mastodon-compatible sources

- Generic ActivityPub activity normalization.
- Provider-neutral public actor/outbox ingestion.
- Actor identity and outbox binding.
- ActivityStreams `Collection`, `OrderedCollection`, `CollectionPage`, and `OrderedCollectionPage` support.
- Linked and inline `first` and `next` page handling, including correct ActivityStreams `Link.href` target resolution.
- Page `partOf` validation, bounded traversal, cycle detection, compact resumable cursors, and same-authority URL policy.
- Explicitly public activity filtering before recommendation-source emission.
- Mastodon public, home, and list timeline provider adapters.
- Authorization validation before transport.
- Public/private capability separation.
- Curated account-set ingestion for Mastodon Collections, Loops Starter Kits, and explicit Pixelfed documents.
- Legacy Fediverse follow-pack ingestion with moved-account resolution, activity recency, discoverability, opt-out, block, mute, provider-policy, and identity-binding checks.
- Public account featured hashtags and public instance trending hashtags.

Home and list timeline readers exist as provider adapters because applications may need normalized reads for non-recommendation workflows. Project policy forbids using their private contents as recommendation-interest evidence, but the generic derivation APIs do not yet enforce that prohibition automatically.

### ActivityPods/Solid sources

- ActivityPods actor/WebID identity binding.
- Same-Pod inbox, outbox, public-key owner, proxy endpoint, and SPARQL endpoint validation.
- Public ActivityPods outbox adapter built on the generic ActivityPub traversal rather than a duplicate collection implementation.
- Anonymous public reads with the ActivityStreams JSON-LD context.
- ActivityPods source-context projection for accepted public records.
- Pod-bound application registration, AccessGrant, optional DataGrant, application actor, expiry, revocation, and `apods:ReadOutbox` validation.
- Dependency-injected Solid Notifications subscription transport.
- Reauthorization before every notification frame and fail-closed handling of revocation, expiry, or grant-identity changes.
- `Add`, `Remove`, `Create`, `Update`, and `Delete` notification normalization.
- Immediate bounded stream termination without waiting for an additional notification after a configured limit is reached.
- Notification state and content are not exposed to the recommendation layer.
- `Add` produces only a public-refetch command; the referenced activity must pass through the anonymous public path before recommendation use.
- `Remove` produces a retraction command, `Create`/`Update` invalidate the snapshot, and `Delete` disables the source.

This slice intentionally does not ingest the inbox, convert ACL-controlled data into positive interests, implement Pod persistence, post to the outbox, or provide an application-registration network client. Those remain separate deployment concerns.

### ATProto sources

- Repository record and provider API normalization.
- Strict DID, handle, NSID, record-key, AT URI, cursor, and record validation.
- Live `queryLabels` ingestion.
- Live `subscribeLabels` ingestion with bounded frame, label, signature, sequence, and checkpoint handling.
- Labeler DID verification, subscription evidence, expiration, negation tombstones, stale-state protection, and provenance.

### Public discovery and provider policy

- Curated public account sets and legacy follow packs remain curator evidence, not automatic viewer endorsement.
- Public account featured hashtags are strong explicit curator metadata.
- Public instance trends are weak contextual evidence and must not become durable preference without corroboration.
- Garden Fence domain suspensions are an opt-in provider/operator policy source, disabled by default.
- Provider-policy reasons remain audit/filter evidence and are never positive interest signals.

## Core privacy and safety behavior

- Ambiguous authorization or consent fails closed.
- Project-owned integrations reject or exclude private recommendation-interest inputs.
- ActivityPods authorized notifications are control-plane evidence only; they cannot directly become positive interest signals.
- Generic derivation callers must enforce the public-only project policy until a shared guard exists.
- Moderation settings affect eligibility and filtering only in project-owned recommendation flows.
- Source records, URLs, identifiers, timestamps, cursors, limits, grants, and signatures are bounded and runtime-validated.
- Local-network, credential-bearing, malformed, cross-origin, and endpoint-confused URLs are rejected where applicable.
- Provider-specific semantics remain outside generic scoring contracts.
- Unknown or moderation-oriented labels do not silently become positive interests.
- Replay, stale-state, negation, tombstone, notification deduplication, and bounded-stream behavior are handled conservatively.

## Remaining high-priority work

1. **Repository-wide public-only derivation guard**
   - Prevent private or authenticated-only provider records from becoming recommendation-interest signals.
   - Preserve explicitly opted-in local selections and local feedback.
   - Keep moderation and safety settings available for filtering without converting them into affinity evidence.

2. **Retraction integration across profiles and embeddings**
   - Connect ActivityPods `Remove`/`Delete`, source deletion, label negation, consent revocation, and provider-policy changes to consistent derived-state removal.

3. **Reference persistence adapters**
   - IndexedDB/SQLite local-first path.
   - Solid Pod persistence path.
   - Durable Postgres/pgvector path.

4. **ActivityPods deployment composition**
   - Reference application-registration and grant-discovery client.
   - Notification-service discovery and reconnect/resubscription policy.
   - Optional Pod-controlled writes and storage behind explicit authorization.
   - Proxy-endpoint transport for authorized remote resource access without admitting private data to positive-interest derivation.

5. **Operational hardening**
   - Privacy-safe health and freshness reporting.
   - Property, fuzz, replay, concurrency, cancellation, reconnect, and recovery tests.
   - Benchmarks, package examples, release automation, and compatibility policy.

6. **Turnkey service composition**
   - Optional operator HTTP API and workers built around the reusable core, without making centralized operation mandatory.

## Correct next execution order

1. Keep README and architecture/status documentation synchronized with merged behavior.
2. Add the repository-wide public-only derivation guard.
3. Integrate retractions through profile and embedding state.
4. Add reference local-first, Solid Pod, and durable persistence paths.
5. Complete optional ActivityPods deployment composition around the merged integration contracts.
6. Add observability, adversarial testing, performance budgets, and release tooling.

A repository-driven dependency or security finding may change this order, but that change must be documented before implementation.

## Definition of production completeness

The project should not be described as a complete hosted recommendation service until it has:

- repository-wide enforcement of the public-only recommendation-interest policy;
- end-to-end deletion and retraction propagation;
- at least one tested local-first persistence implementation;
- at least one tested Solid Pod persistence/deployment implementation;
- at least one tested durable server implementation;
- privacy-safe operational health behavior;
- replay, concurrency, cancellation, reconnect, and crash-recovery coverage;
- accurate operator and integrator documentation.

Today it is a substantial, reusable recommendation-engine library with generic ActivityPub, ActivityPods live-outbox, Mastodon, and ATProto integration slices, strong privacy contracts, and incomplete production deployment composition.
