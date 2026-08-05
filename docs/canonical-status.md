# Canonical Project Status

This document is the authoritative summary of the current repository state.

Last reconciled against `main` after PR #94 on 2026-08-04.

## Mission and boundaries

Open Interest Clusters is a portable, privacy-preserving recommendation and semantic-interest substrate for ActivityPub, ATProto, ActivityPods/Solid, local-first applications, and provider-specific integrations.

The core remains protocol-neutral, runtime-neutral, storage-neutral, and deny-by-default. Provider transports, credentials, retry policy, HTTP signatures, OAuth, persistence engines, and deployment frameworks remain dependency-injected or external.

### Recommendation-data privacy policy

Project-owned provider integrations and deployment guidance permit interest inference from:

- explicitly public posts;
- explicitly public account metadata;
- explicitly public topic, hashtag, collection, and provider metadata;
- local user selections or feedback when the user explicitly opts in to the applicable local processing.

Authenticated access is not, by itself, permission to use private data for interest inference. Followed hashtags, private timelines, follower-only posts, direct messages, and equivalent viewer-private state are not intended recommendation-interest signals.

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
| ActivityPub live integration | Mastodon timeline and curated-account provider adapters implemented |
| ATProto live integration | Repository/API, `queryLabels`, and `subscribeLabels` slices implemented |
| ActivityPods/Solid integration | Contract and adapter work exists; complete live deployment path remains incomplete |
| Public discovery sources | Curated account sets, legacy follow packs, public featured hashtags, public trends, and opt-in provider policies implemented |
| Deployable operator service | Not implemented |

## Implemented provider and protocol slices

### ActivityPub and Mastodon-compatible sources

- Generic ActivityPub activity normalization.
- Mastodon public, home, and list timeline provider adapter.
- Authorization validation before transport.
- Same-origin, endpoint-confined pagination cursors.
- Public/private capability separation.
- Curated account-set ingestion for Mastodon Collections, Loops Starter Kits, and explicit Pixelfed documents.
- Legacy Fediverse follow-pack ingestion with moved-account resolution, activity recency, discoverability, opt-out, block, mute, provider-policy, and identity-binding checks.
- Public account featured hashtags and public instance trending hashtags.

Home and list timeline readers exist as provider adapters because applications may need normalized reads for non-recommendation workflows. Project policy forbids using their private contents as recommendation-interest evidence, but the generic derivation APIs do not yet enforce that prohibition automatically.

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
- Generic derivation callers must enforce the public-only project policy until a shared guard exists.
- Moderation settings affect eligibility and filtering only in project-owned recommendation flows.
- Source records, URLs, identifiers, timestamps, cursors, limits, and signatures are bounded and runtime-validated.
- Local-network, credential-bearing, malformed, cross-origin, and endpoint-confused URLs are rejected where applicable.
- Provider-specific semantics remain outside generic scoring contracts.
- Unknown or moderation-oriented labels do not silently become positive interests.
- Replay, stale-state, negation, and tombstone behavior is handled conservatively.

## Remaining high-priority work

1. **Generic ActivityPub actor/outbox ingestion**
   - Support ActivityStreams `Collection`, `OrderedCollection`, and page forms without assuming Mastodon APIs.
   - Bind outboxes to resolved actor identity.
   - Add bounded traversal, cycle detection, strict URL policy, and explicit public-only recommendation use.

2. **ActivityPods/Solid live deployment slice**
   - Implement user-controlled Pod reads and writes behind Solid authorization evidence.
   - Keep private personalization local or Pod-controlled by default.
   - Preserve interoperability for providers that extend ActivityPub without adopting ATProto.

3. **Repository-wide public-only derivation guard**
   - Prevent private or authenticated-only provider records from becoming recommendation-interest signals.
   - Preserve explicitly opted-in local selections and local feedback.
   - Keep moderation and safety settings available for filtering without converting them into affinity evidence.

4. **Retraction integration across profiles and embeddings**
   - Ensure source deletion, label negation, consent revocation, and provider-policy changes remove derived contributions consistently.

5. **Reference persistence adapters**
   - IndexedDB/SQLite local-first path.
   - Solid Pod path.
   - Durable Postgres/pgvector path.

6. **Operational hardening**
   - Privacy-safe health and freshness reporting.
   - Property, fuzz, replay, concurrency, cancellation, and recovery tests.
   - Benchmarks, package examples, release automation, and compatibility policy.

7. **Turnkey service composition**
   - Optional operator HTTP API and workers built around the reusable core, without making centralized operation mandatory.

## Correct next execution order

1. Keep README and architecture/status documentation synchronized with merged behavior.
2. Add generic public ActivityPub actor/outbox ingestion.
3. Add the ActivityPods/Solid live deployment slice.
4. Add the repository-wide public-only derivation guard.
5. Integrate retractions through profile and embedding state.
6. Add reference local-first and durable persistence paths.
7. Add observability, adversarial testing, performance budgets, and release tooling.

A repository-driven dependency or security finding may change this order, but that change must be documented before implementation.

## Definition of production completeness

The project should not be described as a complete hosted recommendation service until it has:

- generic ActivityPub and ActivityPods/Solid live paths;
- repository-wide enforcement of the public-only recommendation-interest policy;
- end-to-end deletion and retraction propagation;
- at least one tested local-first persistence implementation;
- at least one tested durable server implementation;
- privacy-safe operational health behavior;
- replay, concurrency, cancellation, and crash-recovery coverage;
- accurate operator and integrator documentation.

Today it is a substantial, reusable recommendation-engine library with multiple live provider integrations, strong privacy contracts, and incomplete production deployment composition.
