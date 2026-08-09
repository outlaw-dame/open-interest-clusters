# Open Interest Clusters

A portable, privacy-preserving recommendation and semantic-interest substrate for local-first applications, federated services, and protocol-neutral recommendation systems.

> **Status:** active pre-1.0 library development. The repository now includes substantial recommendation infrastructure and several live provider-integration slices, but it is not yet a turnkey hosted recommendation service.

## Design principles

- **Privacy and consent first:** ambiguous authorization or consent fails closed.
- **Public or user-controlled recommendation policy:** affinity inference is restricted to explicitly public evidence, ATProto public repositories, explicit user-owned local evidence, or narrowly authorized ActivityPods/Solid Pod evidence under the user's ACL control. Generic application-managed server storage and provider-private activity are not eligible affinity sources.
- **Moderation is filtering-only:** blocks, mutes, domain blocks, keyword filters, labeler subscriptions, and similar private settings may suppress or explain candidates but must not become positive interest signals.
- **Local-first personalization:** selected interests, feedback, profiles, semantic vectors, reranking, and explanations can remain on-device or in user-controlled storage.
- **Protocol-neutral core:** ActivityPub, ATProto, ActivityPods/Solid, and provider-specific records are normalized before entering generic recommendation logic.
- **Replaceable infrastructure:** storage, ANN, streams, HTTP, OAuth, retries, signatures, and deployment frameworks stay behind adapters.
- **Deterministic and auditable behavior:** validation, provenance, reason codes, bounds, replay handling, and explanations are first-class.

## Implemented capabilities

### Core recommendation substrate

- Canonical interest-cluster schema and starter dataset.
- Strict Unicode, hashtag, URL, identifier, timestamp, cursor, and record normalization.
- Consent, authorization, eligibility, deletion, and privacy-safe reason contracts.
- Interest signals, idempotent/retractable profile aggregation, persistence boundaries, embedding lifecycle, ANN, graph intelligence, hybrid scoring, bandits, explanations, and bounded candidate serving.
- Onboarding selection and profile-bootstrap primitives.
- A reusable normalized-evidence ingestion pipeline.
- A profile-to-results execution orchestrator with injected scoring-input construction.
- Durable derived-state invalidation and repair for embeddings, candidate caches, explanation caches, expiration, retractions, and deletion.
- A shared normalized-signal guard enforcing the public or user-controlled affinity boundary across direct construction, derivation, ledger replay, profile ingestion, and orchestration.
- Explicit storage-authority and local-first state-placement policy enforced at profile-persistence boundaries.

### ActivityPub and Mastodon-compatible integration

- Generic ActivityPub activity normalization.
- Mastodon public, home, and list timeline provider adapter.
- Consent-safe authorization checks before transport.
- Same-origin, endpoint-confined pagination.
- Curated account-set ingestion for Mastodon Collections, Loops Starter Kits, and explicit Pixelfed documents.
- Legacy Fediverse follow packs with moved-account resolution, activity recency, discoverability, noindex/opt-out, block, mute, provider-policy, and identity-binding checks.
- Public account featured hashtags and public instance trending hashtags.

Private timeline adapters may support normalized application reads, but their contents cannot become recommendation-interest affinity evidence. Private moderation and safety state may affect local/user-owned filtering only.

### ATProto integration

- Repository-record and provider API normalization.
- Strict DID, handle, NSID, record-key, AT URI, cursor, and record validation.
- Live `queryLabels` ingestion.
- Live `subscribeLabels` ingestion with bounded frames, labels, signatures, sequences, checkpoints, and stale-state protection.
- Labeler identity, subscription evidence, provenance, expiration, negation tombstones, semantic classification, conservative effect policy, and labeler-discovery contracts.

### ActivityPods/Solid integration

- Public ActivityPods outbox reads built on the generic ActivityPub traversal.
- Grant-bound live notification handling with reauthorization and public-refetch requirements.
- User-controlled ActivityPods profile persistence with owner/grant/storage binding and conditional write/delete semantics.
- Explicit `user_owned` state-placement manifest for the bundled ActivityPods persistence adapter.

### Public discovery and safety policy

- Curated sets and follow packs remain curator evidence, not automatic viewer endorsement.
- Public featured hashtags are strong explicit curator metadata.
- Public trends are weak contextual signals and require corroboration before durable preference.
- Garden Fence domain suspensions are an opt-in operator/provider policy source, disabled by default.
- Policy reasons are audit/filter evidence only, never positive interests.
- User-controlled ActivityPods/Solid Pod state may support affinity only with explicit consent, `solid_acl_control`, `user_owned` provenance, no third-party private data, and the narrowly bounded remote-storage path.

## Architecture

```text
Dataset and canonical normalization
  → protocol/provider source normalization
  → authorization, eligibility, consent, and provider/deployment privacy policy
  → semantic classification and signal-effect policy
  → idempotent/retractable signal application
  → profile and local/user-owned preference state
  → candidate discovery and eligibility                [next major layer]
  → scoring-input construction                         [next major layer]
  → embeddings, graph intelligence, ANN and hybrid scoring
  → reranking, explanations, and bounded candidate serving
```

Provider-specific behavior remains behind adapters:

```text
Core contracts
  ├─ ActivityPub and Mastodon provider adapters
  ├─ ATProto repository, queryLabels, and subscribeLabels adapters
  ├─ ActivityPods/Solid adapters
  ├─ local/device persistence adapters
  ├─ permitted aggregate infrastructure adapters
  └─ optional stream and worker adapters
```

ActivityPods is a preferred canonical-event architecture for deployments that adopt it, but the library also supports providers that extend ActivityPub without adopting ATProto or the full ActivityPods architecture.

## Current limitations

- A first-class protocol-neutral multi-kind candidate domain is not yet implemented.
- Cold-start candidate generation from a profile is not yet a reusable engine layer.
- Candidate-type eligibility is complete for important account paths but is not yet generalized across feeds, lists, starter packs, labelers, communities, hashtags/topics, instances, and posts.
- The execution orchestrator intentionally requires an injected scoring-input builder; the reusable profile + candidate → scoring-input bridge is still missing.
- Higher-level first-session recommendation orchestration should wait on those candidate/scoring boundaries rather than becoming an onboarding-specific subsystem.
- Reference IndexedDB/SQLite and broader generic Solid persistence paths remain incomplete.
- No turnkey operator HTTP API, worker daemon, dashboard, or deployment chart is bundled.
- Privacy-safe observability, fuzz/replay/concurrency coverage, benchmarks, examples, compatibility guidance, and release tooling still need expansion.
- Pre-1.0 APIs do not yet have stable compatibility guarantees.

## Near-term roadmap

The dependency-correct next sequence is:

1. Candidate domain and candidate-source contracts.
2. Cold-start candidate generation from the existing profile and public/verified discovery sources.
3. Generalized candidate eligibility and policy composition, reusing existing account gates and keeping moderation filtering-only.
4. A reusable cold-start scoring-input builder for the existing execution orchestrator.
5. First-session recommendation orchestration using the existing onboarding bootstrap and execution layers.
6. Protocol-neutral recommendation action-plan contracts that remain application-executed and explicitly user-confirmed.
7. Onboarding lifecycle, rerun, retraction, expiration, and refresh behavior.
8. Reference onboarding integration and UX examples after the engine contracts stabilize.

See [`docs/canonical-status.md`](docs/canonical-status.md) for the authoritative current state and [`docs/candidate-cold-start-onboarding-roadmap.md`](docs/candidate-cold-start-onboarding-roadmap.md) for phase-level acceptance criteria, invariants, and non-goals.

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
- user-owned local evidence may remain local-first;
- user-controlled ActivityPods/Solid Pod evidence may use the remote path only with explicit ACL control, `user_owned` provenance, and no third-party private data;
- generic application-managed server storage is not an affinity or persistence-authority exception;
- provider-owned subject-level recommendation state is denied;
- profile persistence must declare and pass state-placement policy before I/O;
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
