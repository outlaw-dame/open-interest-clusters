# Canonical Project Status

This document is the authoritative summary of the current repository state.

Last reconciled against `main` after PR #94 on 2026-08-04.

## Mission and boundaries

Open Interest Clusters is a portable, privacy-preserving recommendation and semantic-interest substrate for ActivityPub, ATProto, ActivityPods/Solid, local-first applications, and provider-specific integrations.

The core remains protocol-neutral, runtime-neutral, storage-neutral, and deny-by-default. Provider transports, credentials, retry policy, HTTP signatures, OAuth, persistence engines, and deployment frameworks remain dependency-injected or external.

### Recommendation-data privacy invariant

Interest inference may use only:

- explicitly public posts;
- explicitly public account metadata;
- explicitly public topic, hashtag, collection, and provider metadata;
- local user selections or feedback when the user explicitly opts in to the applicable local processing.

Authenticated access is not, by itself, permission to use private data for interest inference. Followed hashtags, private timelines, follower-only posts, direct messages, and equivalent viewer-private state are not recommendation-interest signals.

The narrow private-data exception is moderation and safety preferences. Blocks, mutes, labeler subscriptions, and similar settings may filter, suppress, or explain candidates, but must not be converted into positive interest evidence.

## Current maturity

| Area | Status |
| --- | --- |
| Dataset, schema, normalization, catalog | Mature library capability |
| Consent, privacy, deletion contracts | Mature library capability |
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

Home and list timeline readers exist as provider adapters because applications may need normalized reads for non-recommendation workflows. Their private contents must not be used as recommendation-interest evidence.

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
- Private recommendation-interest inference is prohibited unless an explicit local-only user action contract allows it.
- Moderation settings affect eligibility and filtering only.
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

3. **Retraction integration across profiles and embeddings**
   - Ensure source deletion, label negation, consent revocation, and provider-policy changes remove derived contributions consistently.

4. **Reference persistence adapters**
   - IndexedDB/SQLite local-first path.
   - Solid Pod path.
   - Durable Postgres/pgvector path.

5. **Operational hardening**
   - Privacy-safe health and freshness reporting.
   - Property, fuzz, replay, concurrency, cancellation, and recovery tests.
   - Benchmarks, package examples, release automation, and compatibility policy.

6. **Turnkey service composition**
   - Optional operator HTTP API and workers built around the reusable core, without making centralized operation mandatory.

## Correct next execution order

1. Keep README and architecture/status documentation synchronized with merged behavior.
2. Add generic public ActivityPub actor/outbox ingestion.
3. Add the ActivityPods/Solid live deployment slice.
4. Integrate retractions through profile and embedding state.
5. Add reference local-first and durable persistence paths.
6. Add observability, adversarial testing, performance budgets, and release tooling.

A repository-driven dependency or security finding may change this order, but that change must be documented before implementation.

## Definition of production completeness

The project should not be described as a complete hosted recommendation service until it has:

- generic ActivityPub and ActivityPods/Solid live paths;
- end-to-end deletion and retraction propagation;
- at least one tested local-first persistence implementation;
- at least one tested durable server implementation;
- privacy-safe operational health behavior;
- replay, concurrency, cancellation, and crash-recovery coverage;
- accurate operator and integrator documentation.

Today it is a substantial, reusable recommendation-engine library with multiple live provider integrations, strong privacy contracts, and incomplete production deployment composition.
