# Open Interest Clusters

A portable, privacy-preserving recommendation and semantic-interest substrate for local-first applications, federated services, and protocol-neutral recommendation systems.

Open Interest Clusters provides canonical interest data, strict normalization and validation, consent-aware source contracts, local-first personalization primitives, embedding and ANN infrastructure, hybrid scoring, and bounded candidate serving. It is designed to work across ActivityPub, ATProto, ActivityPods/Solid-oriented architectures, and application-specific data sources without requiring one database, vector provider, broker, framework, or hosting model.

> **Project status:** active pre-1.0 library development. The repository contains substantial recommendation-engine infrastructure, but it is not yet a turnkey hosted recommendation service and does not bundle live Mastodon, ActivityPub, ActivityPods, Bluesky, or ATProto network clients.

## Why this project exists

Recommendation systems are commonly tied to centralized behavioral tracking, proprietary taxonomies, fixed infrastructure, and application-specific data models. That makes them difficult to reuse across independent services and difficult to operate without collecting more user data than necessary.

Open Interest Clusters takes a different approach:

- keep the core engine protocol-neutral and infrastructure-neutral;
- use canonical interest clusters rather than platform-specific identifiers;
- treat consent, privacy boundaries, eligibility, and deletion as first-class contracts;
- keep private personalization local-first by default;
- make public/shared intelligence separable from user-private profile state;
- allow embedded, durable, and distributed deployments through adapters;
- preserve provenance and explanation data throughout the recommendation pipeline.

## Core principles

### Privacy and consent first

The recommendation layer is deny-by-default where consent or authorization is required. Interest signals carry their permitted data use, privacy boundary, evidence, and privacy-safe consent event. Subject identifiers are not included in profile snapshots or recommendation signals.

### Local-first personalization

Selected interests, behavioral feedback, profile state, semantic profile vectors, reranking decisions, and user-facing explanations can remain on the user’s device or in user-controlled storage. Server-side processing is an explicit deployment and consent choice, not a core requirement.

### Protocol-neutral contracts

ActivityPub and ATProto records are normalized before entering generic recommendation logic. Provider-specific SDKs, transport clients, storage systems, and authorization mechanisms stay outside the core scoring and serving layers.

### Replaceable infrastructure

The core package does not require Postgres, pgvector, Qdrant, Kafka, Redpanda, Redis, ActivityPods, IndexedDB, SQLite, or a web framework. These systems can be integrated through adapters and deployment-specific packages.

### Deterministic and auditable behavior

Boundary validation is strict, retries are bounded, candidate serving is deterministic for equivalent inputs, and recommendation outputs can retain component scores and explanation metadata.

## What is included

### Canonical interest data

- JSON Schema for portable interest-cluster datasets
- starter global interest dataset
- canonical hashtags, aliases, keywords, entities, and semantic metadata
- sensitive-topic and discovery boundaries
- deterministic catalog indexing and collision handling

### Validation and normalization

- strict dataset validation with AJV
- Unicode and hashtag normalization
- URL and identifier sanitation
- bounded-string and control-character validation
- immutable local and remote dataset loading
- ETag-aware remote loading with bounded retry and backoff

### Consent, privacy, and eligibility

- deny-by-default consent evaluation
- explicit recommendation data-use categories
- private-data and server-processing controls
- privacy-safe audit reason codes
- revocation and derived-data deletion intents
- source eligibility and opt-out policy
- protocol authorization evidence contracts
- consent-gated source adapter composition

### ActivityPub and ATProto source contracts

- generic recommendation source-adapter interfaces
- ActivityPub and ATProto source-context normalization
- Mastodon-shaped status mapping
- generic ActivityPub activity mapping
- ATProto repository-record mapping
- strict DID, handle, NSID, record-key, and AT URI validation
- visibility, access-basis, provider-policy, block, and exclusion handling

These are contract-level and normalization components. The package does not currently fetch remote timelines, repositories, feeds, or label streams by itself.

### ATProto label support

- dedicated label ingestion separate from repository records
- labeler DID and provenance preservation
- target URI/CID, value, version, signature, creation, and expiration metadata
- negation tombstones
- out-of-order delivery and stale-state protection
- user-scoped labeler subscription evidence
- consent- and subscription-aware label policy evaluation
- conservative label-evidence-to-interest-signal derivation

The current label bridge preserves evidence but does not yet provide a complete semantic classification system for distinguishing topical, moderation, safety, identity, community, game, and other label purposes.

### Interest signals and profiles

- normalized interest-signal model
- positive, negative, and neutral polarity
- strength and confidence
- privacy-boundary and consent metadata
- source-item-to-signal derivation
- onboarding-selected interest seeding
- local-first in-memory profile store
- profile expiration, entry limits, and deletion
- hardened persistence records and adapter contracts
- pseudonymous subject-key derivation

### Embeddings and ANN

- embedding provider contracts
- embedding text and orchestration helpers
- embedding lifecycle records and model manifests
- profile fingerprints and integrity metadata
- expiration, invalidation, and staleness evaluation
- in-memory ANN implementation
- ANN serialization and capability-aware orchestration
- adaptive deployment routing
- pgvector and PGlite-oriented adapters
- embedding retrieval and semantic refresh infrastructure

### Entity and graph intelligence

- entity extraction and enrichment pipelines
- entity-to-cluster mapping
- Wikidata graph resolver contracts
- entity cache and cluster indexes
- co-occurrence graph ingestion
- Louvain community detection
- graph pruning, serialization, and replay

### Ranking, personalization, and serving

- deterministic scoring inputs
- entity and graph boosts
- embedding similarity
- global, contextual, and session bandit state
- multi-objective scoring and reward normalization
- local preference and semantic-profile primitives
- recommendation explanation projection
- bounded, filtered, deduplicated candidate serving

## Architecture

The intended dependency flow is:

```text
Dataset and schema
  → validation and canonical normalization
  → protocol/provider source normalization
  → authorization, eligibility, and consent enforcement
  → interest and entity derivation
  → profile and local preference state
  → embeddings, graph intelligence, and ANN retrieval
  → hybrid scoring and reranking
  → explanations and bounded candidate serving
```

Infrastructure-specific behavior belongs behind adapters:

```text
Core contracts
  ├─ local/in-memory reference implementations
  ├─ device storage adapters
  ├─ Solid Pod / ActivityPods adapters
  ├─ Postgres / pgvector adapters
  ├─ stream and worker adapters
  └─ provider-specific ActivityPub / ATProto clients
```

See:

- [`docs/reference-architecture.md`](docs/reference-architecture.md)
- [`docs/subsystem-dependency-map.md`](docs/subsystem-dependency-map.md)
- [`docs/adapter-strategy.md`](docs/adapter-strategy.md)
- [`docs/deployment-profiles.md`](docs/deployment-profiles.md)
- [`docs/privacy-model.md`](docs/privacy-model.md)
- [`docs/risk-ranked-hardening-plan.md`](docs/risk-ranked-hardening-plan.md)
- [`docs/adapter-contributor-guide.md`](docs/adapter-contributor-guide.md)

## Deployment profiles

### Embedded / local-first

Suitable for PWAs, native clients, prototypes, and small communities.

- no broker required
- no server required
- in-memory or device-local ANN
- local profile and preference persistence
- local embedding cache
- in-process or scheduled refresh

Typical adapters may use IndexedDB, SQLite, encrypted mobile storage, or local filesystem snapshots.

### Practical durable

The recommended first production server profile.

- Postgres
- pgvector
- scheduled semantic refresh worker
- durable public/shared intelligence
- local-first user personalization where possible

### Advanced distributed

For high-volume ingestion and distributed semantic processing.

- Kafka-compatible streams or Redpanda
- distributed refresh and indexing workers
- object-backed snapshots
- pgvector, Qdrant, or another ANN provider

### Canonical event backbone

For ActivityPods-oriented and cross-protocol deployments.

- protocol-neutral canonical events
- replayable source ingestion
- ActivityPub and ATProto normalization
- optional durable event streams
- public/shared semantic intelligence
- user-private local-first personalization

These are reference profiles, not hard dependencies.

## Installation

Requirements:

- Node.js `>=20.11.0`
- pnpm `10.32.1`

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Development commands

```bash
# Type-check without emitting files
pnpm lint:types

# Compile TypeScript
pnpm build

# Validate package entrypoints after a build
pnpm verify:package-entrypoints

# Validate the starter interest dataset
pnpm validate:dataset

# Run the complete compiled test suite
pnpm test
```

Normalize the bundled dataset in place only when intentionally updating canonical data:

```bash
pnpm normalize:dataset
```

## Package usage

```ts
import {
  createInMemoryRecommendationProfileStore,
  hybridScore,
  serveCandidates
} from "@memory/open-interest-clusters";
```

The package root exports the schema, normalization, recommendation, profile, embedding, ANN, graph, scoring, local-preference, and serving contracts.

Additional package exports are available at:

- `@memory/open-interest-clusters/schema`
- `@memory/open-interest-clusters/datasets/global-v1`

The exact JSON import syntax depends on the consuming runtime or bundler.

### Minimal local profile example

```ts
import {
  createInMemoryRecommendationProfileStore,
  normalizeRecommendationInterestSignal
} from "@memory/open-interest-clusters";

const store = createInMemoryRecommendationProfileStore({
  allowedPrivacyBoundaries: ["local_only"]
});

const signal = normalizeRecommendationInterestSignal({
  target: { kind: "canonical_interest", key: "technology.open-source" },
  action: "select",
  polarity: "positive",
  strength: 1,
  confidence: 1,
  dataUse: "local_personalization",
  privacyBoundary: "local_only",
  evidence: {
    sourceItemKind: "profile",
    protocol: "app_local",
    sourceVisibility: "local_only",
    accessBasis: "owner",
    trustBoundary: "user_owned",
    observedAt: new Date().toISOString()
  },
  consent: {
    decision: "allow",
    reason: "consent.allow.explicit",
    dataUse: "local_personalization",
    protocol: "app_local",
    sourceVisibility: "local_only",
    accessBasis: "owner",
    containsPrivateData: true,
    containsThirdPartyData: false,
    serverSideProcessing: false
  }
});

await store.ingestSignals({
  subjectId: "local-user",
  signals: [signal]
});

const profile = await store.readProfile("local-user");
```

Applications should normally obtain consent events through the package’s consent evaluation APIs rather than constructing them directly. The explicit object above is shown to illustrate the complete signal envelope.

## Current limitations

The following areas are not yet complete:

- live Mastodon, GoToSocial, generic ActivityPub, ActivityPods/Solid, Bluesky, and ATProto network clients;
- live `queryLabels` and `subscribeLabels` ingestion;
- a complete semantic model for classifying label purposes and effects;
- idempotent signal/event ledgers for retries, replay, and duplicate delivery;
- profile contribution retraction after source tombstones or label negation;
- a unified end-to-end orchestration API from source read through serving;
- turnkey operator service, HTTP API, worker daemon, or dashboard;
- complete reference adapters for IndexedDB, SQLite, Solid Pods, and production Postgres persistence;
- centralized freshness, observability, and operational health reporting;
- stable pre-1.0 API compatibility guarantees.

See the repository architecture and hardening documents before treating the package as a complete hosted recommendation platform.

## Near-term roadmap

The next high-priority work is:

1. reconcile status and architecture documentation with the current implementation;
2. classify label semantics before applying labels as ranking interests or moderation effects;
3. define idempotent signal identity, replay, retraction, and expiration behavior;
4. add profile-application orchestration for classified evidence;
5. build privacy-preserving labeler discovery and recommendation;
6. provide a reusable end-to-end recommendation orchestration layer;
7. add live ActivityPub, ActivityPods/Solid, and ATProto integration slices;
8. expand production adapters, observability, benchmarks, and release tooling.

## Security and privacy expectations

Changes to source ingestion, consent, profile state, persistence, embeddings, ranking, or serving should preserve these invariants:

- ambiguous consent or authorization fails closed;
- private data is not processed outside its allowed boundary;
- raw subject identifiers do not appear in profile snapshots, audit payloads, errors, or telemetry;
- external identifiers, URLs, timestamps, and provider records are validated before use;
- retries are bounded, cancellable where applicable, and restricted to retryable failures;
- duplicate or replayed source events must not silently corrupt state;
- provider-specific details do not leak into generic scoring contracts;
- deletion and consent revocation propagate to derived profile and embedding state;
- local-first operation remains possible without centralized behavioral tracking.

## Contributing

Before adding a new provider, storage system, vector engine, or protocol integration:

1. reuse existing core contracts;
2. keep infrastructure-specific dependencies inside an adapter;
3. preserve strict input validation and privacy boundaries;
4. add behavior-focused tests, including adversarial and failure cases;
5. run type checking, build, package verification, dataset validation, and tests;
6. update architecture or status documentation when behavior or boundaries change.

Read [`docs/adapter-contributor-guide.md`](docs/adapter-contributor-guide.md) and the repository pull-request template before submitting changes.

## License

MIT. See [`LICENSE`](LICENSE).
