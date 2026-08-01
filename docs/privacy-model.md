# Privacy Model

Open Interest Clusters is designed for privacy-preserving discovery and recommendation. Privacy is enforced through consent, authorization, explicit data-use and storage boundaries, local-first defaults, source eligibility, deletion, and derived-data lifecycle controls.

## Core principles

- Deny by default when consent, authorization, or a privacy boundary is ambiguous.
- Process only data required for an explicitly allowed recommendation use.
- Keep user-private personalization local-first unless another boundary is explicitly permitted.
- Separate public/shared semantic intelligence from subject-level profile state.
- Do not copy raw subject identifiers into signals, profile snapshots, audit events, errors, or telemetry.
- Treat consent revocation and deletion as lifecycle events that propagate to derived data.
- Do not infer consent from public availability alone.
- Preserve provider-specific visibility and authorization semantics at protocol boundaries.

## Consent and data use

Callers provide a consent policy and a request describing the subject, requested data use, protocol, source visibility, access basis, and whether private, third-party, or server-side processing is involved.

The consent evaluator returns a privacy-safe allow or deny event. Missing, revoked, expired, mismatched, or insufficient consent fails closed. Consent events intentionally omit raw subject identifiers.

## Privacy boundaries

Interest signals and profile state carry an explicit privacy boundary.

### `local_only`

The default for user-private personalization. Processing and storage are expected to remain on the user's device or in user-controlled local storage.

### `server_allowed`

Server-side profile processing or persistence is permitted only when consent explicitly allows the requested server-side use.

### `aggregate_only`

The intended meaning is that data contributes only to non-subject-level aggregate intelligence and must not create an identifiable or pseudonymous per-user profile.

Current enforcement is incomplete at one low-level boundary: `createInMemoryRecommendationProfileStore` defaults to `local_only`, but a caller can explicitly configure `allowedPrivacyBoundaries: ["aggregate_only"]`. In that configuration, the store currently accepts aggregate-only signals into state keyed by a subject ID. Onboarding/profile seeding and durable profile persistence reject aggregate-only subject profiles, but the generic in-memory store does not yet enforce that invariant itself.

Until that implementation gap is closed, integrations must not configure a subject-level profile store to accept `aggregate_only`. The future profile-application orchestrator must fail closed before aggregate-only evidence reaches per-subject state.

## Public and private intelligence

Public or explicitly indexable intelligence may include canonical interest clusters, normalized public hashtags, public entity mappings, public co-occurrence graphs, public cluster embeddings, ANN snapshots, and non-personal candidate metadata.

The following remain local-first by default:

- selected interests and interaction-derived signals;
- followed, dismissed, seen, muted, and blocked state;
- subject-level profile entries and semantic profile vectors;
- local bandit and feedback state;
- personalized reranking decisions and explanations;
- labeler subscriptions when they reveal preferences or moderation choices.

## Protocol authorization and eligibility

Public, follower-only, direct, local-only, Solid ACL-controlled, and ATProto repository data are not interchangeable. Source adapters preserve visibility, access basis, private/third-party flags, server-processing state, provider policy, subject match, and authorization evidence.

Provider clients must perform OAuth, ACL, capability, block, mute, label, and provider-policy checks before passing records to core normalizers. ATProto public repositories are broadly public sources, but applications must still respect OAuth scopes, labels, blocks, mutes, AppView/PDS boundaries, and consent for derived personalization.

Eligibility controls include dataset discovery/indexing flags, account or instance policy denials, viewer blocks and mutes, provider restrictions, and opt-out markers such as NoAI, NoBot, NoCrawl, NoIndex, NoSearch, NoScrape, NoLLM, and Robotxt.

## Labelers and labels

A user's labeler subscription is evidence that an application may consume that labeler's output for an allowed use. It is not a global trust score and does not mean every label is an interest.

The label pipeline preserves labeler DID, target, value, timestamps, expiration, provenance, signature metadata, and negation tombstones. Expired, negated, unsubscribed, mismatched, or consent-denied labels do not become accepted evidence.

The currently exported direct label bridge converts accepted labels into neutral `canonical_interest` signals unless the caller overrides the target kind. This preserves auditable evidence but is not a complete semantic gate. Integrations must not interpret that bridge as proof that a label is a positive interest.

A required semantic layer must distinguish topical interests from moderation, safety, identity, community, content-format, game, eligibility, and unknown labels. Unknown labels remain audit-only; moderation and safety labels are not positive interests; identity/community/game labels require explicit policy before affecting affinity.

## Profile and persistence privacy

Profile snapshots omit raw subject IDs and retain only canonical targets, scores, confidence, counts, privacy boundaries, protocols, source visibility, timestamps, and expiration. The profile store prunes expired entries and caps retained state.

The in-memory store is additive and does not provide general event identity, deduplication, or retraction. Replayable integrations must add idempotent signal application before duplicate delivery is safe.

Durable persistence uses adapter contracts and pseudonymous subject keys. Persistence validates records, enforces storage-target and consent requirements, rejects aggregate-only subject profiles, verifies writes, cleans up corrupted writes, exposes privacy-safe errors, and supports deletion intents.

## Embedding lifecycle

Profile embeddings are derived data. Records preserve a pseudonymous subject key, privacy boundary, model and artifact metadata, profile fingerprint, vector dimensions, timestamps, and invalidation state.

Embeddings become stale or invalid when consent is revoked, deletion is requested, the profile changes, the model changes or is retired, dimensions or privacy boundaries mismatch, or the record expires. They must not outlive the profile and consent state that authorized them.

## Deletion and revocation

A compliant integration must:

1. stop new processing after consent revocation;
2. delete requested profile records;
3. invalidate or delete related embeddings;
4. clear feedback or bandit state when included in scope;
5. prevent replayed events from recreating deleted state without new valid consent;
6. return privacy-safe results and errors.

## Logging and explanations

Logs, metrics, audit events, errors, and explanations must not expose raw subject identifiers, credentials, private source payloads, full profiles, raw vectors, private labeler subscription lists, or unrelated third-party data.

Use bounded privacy-safe counters and reason codes. User-facing explanations must not reveal private third-party data, hidden moderation state, or sensitive inferred attributes.

## Integration invariants

Every adapter and orchestration layer must preserve:

- authorization before restricted reads;
- consent before private or server-side processing;
- strict normalization before profile or ranking use;
- local-only defaults for private personalization;
- no aggregate-only evidence in per-subject state;
- explicit semantic policy before labels affect ranking;
- idempotency before replayable streams reach additive state;
- retraction and expiration for mutable source state;
- deletion propagation to profiles and embeddings;
- privacy-safe observability;
- no forced centralized behavioral tracking.

See [`canonical-status.md`](canonical-status.md) for current implementation status and execution order.
