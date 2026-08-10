# Open Interest Clusters

A portable, privacy-preserving recommendation and semantic-interest substrate for local-first applications, federated services, and protocol-neutral recommendation systems.

> **Status:** active pre-1.0 library development. The repository now includes the candidate domain, cold-start candidate generation, generalized candidate eligibility, protocol/application capability hardening, and runtime provider discovery. The next architectural phase is the cold-start scoring-input builder that connects eligible normalized candidates to the existing execution/scoring pipeline.

## Design principles

- **Privacy and consent first:** ambiguous authorization or consent fails closed.
- **Public or user-controlled recommendation policy:** affinity inference is restricted to explicitly public evidence, ATProto public repositories, explicit user-owned local evidence, or narrowly authorized ActivityPods/Solid Pod evidence under the user's ACL control.
- **Moderation is filtering-only:** blocks, mutes, domain blocks, keyword filters, safety settings, and similar private state may suppress candidates but must not become positive interests.
- **Local-first personalization:** selected interests, profiles, semantic vectors, reranking, and explanations can remain on-device or in user-controlled storage.
- **Provider-owned subject personalization is denied:** generic application-managed/provider storage is not an exception to the user-controlled-state rule.
- **Protocol-neutral core:** ActivityPub, ATProto, ActivityPods/Solid, and provider-specific records are normalized before generic recommendation logic.
- **Protocol is not application identity:** ActivityPub does not imply Mastodon; ATProto does not imply Bluesky.
- **Multi-protocol providers are supported:** protocol bindings are additive and retain their own visibility/access/provenance semantics.
- **Replaceable infrastructure:** storage, ANN, streams, HTTP, OAuth, retries, signatures, and deployment frameworks stay behind adapters.
- **Deterministic and auditable behavior:** validation, provenance, reason codes, bounds, replay handling, and explanations are first-class.

## Implemented capabilities

### Core recommendation substrate

- Canonical interest-cluster schema and starter dataset.
- Strict Unicode, hashtag, URL, identifier, timestamp, cursor, and record normalization.
- Consent, authorization, eligibility, deletion, and privacy-safe reason contracts.
- Interest signals, idempotent/retractable profile aggregation, persistence boundaries, embedding lifecycle, ANN, graph/entity intelligence, hybrid scoring, bandits, explanations, and bounded candidate serving.
- Onboarding selection and profile-bootstrap primitives.
- Reusable normalized-evidence ingestion.
- Profile-to-results execution orchestration with intentionally injected scoring-input construction.
- Durable derived-state invalidation and repair for embeddings, candidate caches, explanation caches, expiration, retractions, and deletion.
- Shared normalized-signal enforcement of the public/user-controlled affinity boundary.
- Explicit storage-authority and local-first/user-owned state-placement policy at public persistence boundaries; the low-level in-memory aggregate-only caveat remains documented.
- Existing versioned hashtag-follow action-plan primitives used by onboarding bootstrap.

### Candidate and cold-start architecture

- First-class normalized recommendation candidates for account, post, feed, list, starter pack, labeler, community, hashtag, topic, and instance targets.
- Stable candidate identity separated from mutable display metadata.
- Bounded provenance and verification semantics that keep discovery evidence distinct from viewer endorsement.
- Candidate-source adapters separate from generic evidence adapters.
- Privacy-redacted remote discovery requests; raw profiles, subject IDs, languages/interests, and private moderation state are not sent through the generic remote candidate-source query.
- Bounded multi-source cold-start generation from an existing recommendation profile.
- Deterministic duplicate collapse with provenance preservation.
- Candidate-type eligibility and policy composition before expensive scoring.
- Account current-identity/move resolution, 45-day activity default, deleted/deactivated/suspended/unresolved rejection, opt-out/noindex handling, provider policy, and viewer-safety gates.

### Runtime protocol/application capability architecture

- Profile/application feature support states: `supported`, `unsupported`, or `unknown`.
- Mastodon-compatible and Bluesky-compatible capability profiles are application-specific conveniences, not protocol defaults.
- Custom ATProto applications may provide adapter-normalized profile text without being parsed as Bluesky.
- Conservative compound/camel hashtag phrase matching without rewriting canonical hashtag identity.
- Runtime provider discovery above hardened adapters.
- Provider/server identity remains separate from application/client identity.
- Application identity/profile claims carry their own authority instead of inheriting unrelated protocol-binding authority.
- Additive multi-protocol bindings for ActivityPub, ATProto, ActivityPods, and supported combinations.
- Authority-ranked capability observations with fail-closed identity/capability conflict handling.
- Validated provider+application-scoped capability caching with stale/malformed re-probe behavior and provider-only application-profile rejection.
- Freshness revalidation after asynchronous cache/probe work.
- Bounded concurrency, abort handling, partial probe isolation, and retryable-only bounded exponential backoff.
- Capability discovery never substitutes for consent, OAuth/ACL/grant authorization, storage placement, or candidate-native identity verification.

### ActivityPub and Mastodon-compatible integration

- Generic ActivityPub activity normalization and public actor/outbox traversal.
- Mastodon public/home/list timeline provider adapters.
- Consent-safe authorization checks before transport.
- Same-authority, endpoint-confined bounded pagination.
- Curated account-set ingestion for Mastodon Collections, Loops Starter Kits, and explicit Pixelfed documents.
- Legacy Fediverse follow packs.
- Public account featured hashtags and public instance trends.

Private timeline adapters may support normalized application reads, but their contents cannot become recommendation-interest affinity evidence. Private moderation/safety state may affect only local/user-owned filtering.

### ATProto integration

- Repository-record and provider API normalization.
- Strict DID, handle, NSID, record-key, AT URI, cursor, and record validation.
- Live `queryLabels` and `subscribeLabels` ingestion.
- Labeler identity, subscription evidence, provenance, expiration, negation tombstones, semantic classification, effect policy, and labeler-discovery contracts.
- Third-party directories remain optional untrusted hints until native identity is authoritatively verified.

### ActivityPods/Solid integration

- Public ActivityPods outbox reads built on generic ActivityPub traversal.
- Grant-bound live notification handling with reauthorization and public-refetch requirements.
- User-controlled ActivityPods profile persistence with owner/grant/storage binding and conditional write/delete semantics.
- Explicit `user_owned` state placement for the bundled ActivityPods persistence adapter.

ActivityPods providers may support ActivityPub + Solid/ACL semantics without supporting ATProto. The recommendation architecture does not require them to adopt ATProto.

## Architecture

```text
Dataset and canonical normalization
  -> protocol/provider source normalization
  -> authorization, consent, public/user-controlled signal policy
  -> semantic classification and signal-effect policy
  -> idempotent/retractable signal application
  -> local/user-owned profile state
  -> candidate discovery
  -> normalized candidate identity/provenance
  -> runtime provider/application capability resolution
  -> candidate eligibility / provider policy / viewer safety
  -> cold-start scoring-input construction              [NEXT]
  -> existing hybrid scoring / ANN / graph / embeddings
  -> reranking, explanations, and bounded serving
```

Provider-specific behavior remains behind adapters. Capability discovery does not perform arbitrary network fetching itself; hardened adapters remain responsible for SSRF defenses, redirect/size/content-type bounds, authentication, protocol-native identity validation, OAuth/ACL/grant checks, and provider transport behavior.

## Current roadmap status

The candidate/onboarding dependency chain is now:

1. **Phase 1 — Candidate domain and candidate-source contracts — COMPLETE** (`#114`, `#115` hardening)
2. **Phase 2 — Cold-start candidate generation — COMPLETE** (`#116`)
3. **Phase 3 — Candidate eligibility and policy composition — COMPLETE** (`#117`)
4. **Phase 3.5 — Protocol/application profile capability hardening — COMPLETE** (`#120`, `#121`)
5. **Phase 3.6 — Runtime provider discovery/capability resolution — COMPLETE** (`#122`, with late-review hardening in the immediate follow-up)
6. **Phase 4 — Cold-start scoring-input builder — NEXT**
7. **Phase 5 — First-session recommendation orchestrator — PENDING**
8. **Phase 6 — Generalized recommendation action-plan contracts — PENDING** (existing hashtag-follow plan already implemented)
9. **Phase 7 — Onboarding lifecycle and refresh — PENDING**
10. **Phase 8 — Reference onboarding integration and UX examples — PENDING**

The idempotent signal ledger/retraction layer predates this sequence and is already implemented; it is not Phase 4.

See:

- [`docs/current-roadmap-status.md`](docs/current-roadmap-status.md) for the concise current ledger and Phase 4 requirements;
- [`docs/canonical-status.md`](docs/canonical-status.md) for the authoritative architectural state;
- [`docs/candidate-cold-start-onboarding-roadmap.md`](docs/candidate-cold-start-onboarding-roadmap.md) for detailed phase acceptance criteria;
- [`docs/candidate-roadmap-safety-amendments.md`](docs/candidate-roadmap-safety-amendments.md) for normative privacy/safety amendments;
- [`docs/recommendation-provider-discovery.md`](docs/recommendation-provider-discovery.md) for the runtime capability layer.

## Immediate next phase: cold-start scoring-input builder

The next implementation must turn the current local/user-owned profile plus already-eligible normalized candidates into the bounded `HybridScoreInput` structures consumed by the existing execution orchestrator.

It must preserve exact candidate binding, support no behavioral history, reuse optional entity/graph/embedding infrastructure safely, reject stale/non-finite/mismatched feature bindings, remain deterministic under asynchronous resolver completion order, and keep subject/profile/private moderation state out of remote feature computation.

The builder should not introduce another scorer and should not reinterpret provider-native candidate IDs as taxonomy cluster identities. If candidate IDs are used as scorer-facing `clusterId` values, that mapping must be explicit and exactly reversible.

## Other remaining work

Outside the primary Phase 4-8 dependency chain:

- reference IndexedDB/SQLite or equivalent device-local persistence;
- broader generic Solid Pod reference composition beyond ActivityPods-specific support;
- verified cross-protocol equivalence where independently provable;
- privacy-safe health/freshness observability;
- additional property/fuzz/replay/concurrency/reconnect coverage;
- benchmarks/performance budgets;
- compatibility examples and integration guidance;
- release automation;
- optional operator infrastructure restricted to policy-permitted non-subject/aggregate state.

## Installation

Requirements:

- Node.js `>=20.11.0`
- pnpm `10.32.1`

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint:types
pnpm build
pnpm verify:package-entrypoints
pnpm validate:dataset
pnpm test
```

## Package usage

```ts
import {
  createInMemoryRecommendationProfileStore,
  hybridScore,
  serveCandidates
} from "@memory/open-interest-clusters";
```

Additional exports:

- `@memory/open-interest-clusters/schema`
- `@memory/open-interest-clusters/datasets/global-v1`

## Security and privacy expectations

Changes must preserve these invariants:

- ambiguous authorization and consent fail closed;
- provider-private data must not become recommendation affinity;
- user-owned local evidence remains local-first by default;
- user-controlled ActivityPods/Solid Pod evidence may use the remote path only with correctly bound authorization and user-owned state placement;
- provider-owned subject-level recommendation state is denied;
- moderation/preferences affect eligibility/filtering only;
- raw subject identifiers must not leak through snapshots, audit payloads, errors, or telemetry;
- URLs, identifiers, timestamps, cursors, signatures, provider observations, and records are validated and bounded;
- retries are bounded, cancellable, and limited to explicitly retryable failures;
- duplicate, replayed, stale, negated, or deleted events must not silently corrupt state;
- protocol/application/provider boundaries must not be flattened into false capability or privacy equivalence;
- deletion and revocation propagate to derived state;
- local-first operation remains possible without centralized behavioral tracking.

## License

MIT. See [`LICENSE`](LICENSE).
