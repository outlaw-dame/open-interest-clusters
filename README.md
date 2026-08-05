# Open Interest Clusters

A portable, privacy-preserving recommendation and semantic-interest substrate for local-first applications, federated services, and protocol-neutral recommendation systems.

> **Status:** active pre-1.0 library development. The repository now includes substantial recommendation infrastructure and several live provider-integration slices, but it is not yet a turnkey hosted recommendation service.

## Design principles

- **Privacy and consent first:** ambiguous authorization or consent fails closed.
- **Public-only recommendation policy:** project-owned provider integrations and deployment guidance restrict interest inference to explicitly public posts and public account/topic metadata. The generic consent and signal APIs still support explicitly authorized private-data processing, so integrators must not route private timeline content into recommendation-interest derivation until a repository-wide public-only derivation guard is implemented.
- **Moderation is filtering-only:** blocks, mutes, labeler subscriptions, and similar private settings may suppress or explain candidates but must not become positive interest signals.
- **Local-first personalization:** selected interests, feedback, profiles, semantic vectors, reranking, and explanations can remain on-device or in user-controlled storage.
- **Protocol-neutral core:** ActivityPub, ATProto, ActivityPods/Solid, and provider-specific records are normalized before entering generic recommendation logic.
- **Replaceable infrastructure:** storage, ANN, streams, HTTP, OAuth, retries, signatures, and deployment frameworks stay behind adapters.
- **Deterministic and auditable behavior:** validation, provenance, reason codes, bounds, replay handling, and explanations are first-class.

## Implemented capabilities

### Core recommendation substrate

- Canonical interest-cluster schema and starter dataset.
- Strict Unicode, hashtag, URL, identifier, timestamp, cursor, and record normalization.
- Consent, authorization, eligibility, deletion, and privacy-safe reason contracts.
- Interest signals, profile aggregation, persistence boundaries, embedding lifecycle, ANN, graph intelligence, hybrid scoring, bandits, explanations, and bounded candidate serving.
- Reusable end-to-end orchestration primitives.

### ActivityPub and Mastodon-compatible integration

- Generic ActivityPub activity normalization.
- Mastodon public, home, and list timeline provider adapter.
- Consent-safe authorization checks before transport.
- Same-origin, endpoint-confined pagination.
- Curated account-set ingestion for Mastodon Collections, Loops Starter Kits, and explicit Pixelfed documents.
- Legacy Fediverse follow packs with moved-account resolution, activity recency, discoverability, noindex/opt-out, block, mute, provider-policy, and identity-binding checks.
- Public account featured hashtags and public instance trending hashtags.

Private timeline adapters exist for normalized application reads. Project policy forbids using their contents as recommendation-interest evidence, but that prohibition is not yet enforced by every generic derivation API and therefore remains an integrator responsibility.

### ATProto integration

- Repository-record and provider API normalization.
- Strict DID, handle, NSID, record-key, AT URI, cursor, and record validation.
- Live `queryLabels` ingestion.
- Live `subscribeLabels` ingestion with bounded frames, labels, signatures, sequences, checkpoints, and stale-state protection.
- Labeler identity, subscription evidence, provenance, expiration, negation tombstones, semantic classification, and conservative effect policy.

### Public discovery and safety policy

- Curated sets and follow packs remain curator evidence, not automatic viewer endorsement.
- Public featured hashtags are strong explicit curator metadata.
- Public trends are weak contextual signals and require corroboration before durable preference.
- Garden Fence domain suspensions are an opt-in operator/provider policy source, disabled by default.
- Policy reasons are audit/filter evidence only, never positive interests.

## Architecture

```text
Dataset and canonical normalization
  → protocol/provider source normalization
  → authorization, eligibility, consent, and provider/deployment privacy policy
  → semantic classification and signal-effect policy
  → idempotent/retractable signal application
  → profile and local preference state
  → embeddings, graph intelligence, and ANN retrieval
  → hybrid scoring and reranking
  → explanations and bounded candidate serving
```

Provider-specific behavior remains behind adapters:

```text
Core contracts
  ├─ ActivityPub and Mastodon provider adapters
  ├─ ATProto repository, queryLabels, and subscribeLabels adapters
  ├─ ActivityPods/Solid adapters
  ├─ local/device persistence adapters
  ├─ Postgres/pgvector adapters
  └─ optional stream and worker adapters
```

ActivityPods is a preferred canonical-event architecture for deployments that adopt it, but the library also supports providers that extend ActivityPub without adopting ATProto or the full ActivityPods architecture.

## Current limitations

- A repository-wide guard preventing private source items from entering recommendation-interest derivation is not yet implemented; current public-only enforcement is provider- and deployment-policy-specific.
- Generic ActivityPub actor/outbox traversal is not yet implemented.
- A complete live ActivityPods/Solid deployment path is not yet implemented.
- Retraction propagation through every profile and embedding path still needs broader integration.
- Reference IndexedDB, SQLite, Solid Pod, and production Postgres persistence paths remain incomplete.
- No turnkey operator HTTP API, worker daemon, dashboard, or deployment chart is bundled.
- Privacy-safe observability, freshness reporting, adversarial testing, benchmarks, and release tooling need expansion.
- Pre-1.0 APIs do not yet have stable compatibility guarantees.

## Near-term roadmap

1. Keep canonical status and architecture documentation synchronized with merged behavior.
2. Add generic public ActivityPub actor/outbox ingestion with bounded traversal, cycle detection, actor binding, strict URL policy, and public-only recommendation use.
3. Add the ActivityPods/Solid live deployment slice while preserving user-controlled storage and opt-in processing.
4. Add a repository-wide derivation guard for the public-only interest policy, without preventing explicitly local user-selected interests and feedback.
5. Integrate source deletion, label negation, consent revocation, and provider-policy changes through profiles and embeddings.
6. Add tested local-first and durable persistence reference paths.
7. Add privacy-safe observability, fuzz/replay/concurrency/recovery tests, benchmarks, examples, and release tooling.

See [`docs/canonical-status.md`](docs/canonical-status.md) for the authoritative current state and execution order.

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
- project-owned integrations must not use private data for recommendation-interest inference;
- generic derivation callers must independently enforce the public-only project policy until a shared guard exists;
- moderation preferences affect eligibility/filtering only;
- raw subject identifiers do not appear in profile snapshots, audit payloads, errors, or telemetry;
- URLs, identifiers, timestamps, cursors, signatures, and provider records are validated and bounded;
- retries are bounded, cancellable, and restricted to retryable failures;
- duplicate, replayed, stale, negated, or deleted events do not silently corrupt state;
- provider details do not leak into generic scoring contracts;
- deletion and revocation propagate to derived state;
- local-first operation remains possible without centralized behavioral tracking.

## License

MIT. See [`LICENSE`](LICENSE).
