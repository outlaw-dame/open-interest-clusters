# Privacy Model

Open Interest Clusters is designed for privacy-preserving discovery and recommendation. Privacy is not limited to dataset exclusion flags: consent, authorization, data-use boundaries, local-first profile state, persistence, deletion, source eligibility, and derived embedding lifecycle are all part of the model.

## Core privacy principles

- Deny by default when consent, authorization, or a privacy boundary is ambiguous.
- Process only the data needed for an explicitly allowed recommendation use.
- Keep user-private personalization local-first unless the user explicitly permits another boundary.
- Separate public/shared semantic intelligence from private subject-level profile state.
- Preserve source provenance without copying raw subject identifiers into signals, profile snapshots, audit events, errors, or telemetry.
- Treat deletion and consent revocation as lifecycle events that must propagate to derived data.
- Do not infer consent from public availability alone.
- Keep provider-specific authorization and visibility semantics intact at protocol boundaries.

## Data-use consent

Recommendation processing is governed by explicit data-use categories. Callers provide a consent policy and a request describing the subject, requested use, protocol, source visibility, access basis, and whether private, third-party, or server-side processing is involved.

The consent evaluator returns a privacy-safe allow or deny event. Missing, revoked, expired, mismatched, or insufficient consent fails closed.

Consent events intentionally avoid raw subject identifiers. They preserve only the information required to explain and audit the decision safely.

## Privacy boundaries

Interest signals and profile state carry an explicit privacy boundary.

### `local_only`

The default for user-private personalization. Processing and storage are expected to remain on the user’s device or in user-controlled local storage.

### `server_allowed`

Server-side profile processing or persistence is permitted only when the caller supplies consent that explicitly allows the requested server-side use.

### `aggregate_only`

Data may contribute only to non-subject-level aggregate intelligence. It must not be used to create or persist an identifiable or pseudonymous per-user profile.

The profile store defaults to accepting only `local_only` signals unless configured otherwise. Aggregate-only data is rejected for subject-level onboarding/profile seeding.

## Public and private intelligence

### Public/shared intelligence

The following may be shared when derived from public or explicitly indexable data:

- canonical interest clusters;
- normalized public hashtags and aliases;
- public entity mappings;
- public graph/co-occurrence structures;
- public cluster embeddings and ANN snapshots;
- candidate-generation metadata that does not contain user-private state.

### Private/local intelligence

The following should remain local-first by default:

- selected interests;
- browsing or interaction-derived interest signals;
- followed, dismissed, seen, muted, or blocked state;
- subject-level profile entries;
- local semantic profile vectors;
- local bandit and feedback state;
- personalized reranking decisions;
- user-facing recommendation explanations;
- labeler subscription evidence when it reveals user preferences or moderation choices.

## Protocol visibility and authorization

Public, follower-only, direct, local-only, Solid ACL-controlled, and ATProto repository data are not interchangeable.

Protocol source adapters preserve:

- source visibility;
- access basis;
- private-data and third-party-data flags;
- server-side processing state;
- provider policy;
- subject match;
- authorization evidence.

Private or restricted source reads require explicit authorization evidence and matching consent. Provider clients must perform OAuth, ACL, capability, block, mute, label, and provider-policy checks before passing records into the core normalizers.

ATProto public repositories are treated as broadly public data sources, but applications must still respect OAuth scopes, labels, blocks, mutes, AppView/PDS boundaries, and user consent for derived personalization.

## Source eligibility and exclusion controls

Interest-cluster data and source records support exclusion controls such as:

- `discoverable = false`;
- `indexable = false`;
- account, profile, post, or instance policy denials;
- viewer blocks and mutes;
- provider policy restrictions;
- opt-out markers including:
  - NoAI;
  - NoBot / NoBots;
  - NoCrawl / NoCrawling;
  - NoIndex / NoIndexing;
  - NoSearch;
  - NoScrape / NoScraping;
  - NoLLM / NoLLMs;
  - Robotxt.

Eligibility checks occur before source data is used for recommendation derivation or ranking. Unknown or conflicting policy evidence fails closed where a safe decision cannot be made.

## Labelers and labels

A user’s subscription to a labeler is treated as evidence that the application may consume that labeler’s output for an allowed use. It is not a global trust score and does not mean every label should become a positive interest.

The label pipeline preserves labeler DID, target, value, timestamps, expiration, provenance, signature metadata, and negation tombstones. Expired, negated, unsubscribed, mismatched, or consent-denied labels do not become recommendation evidence.

Accepted labels still require semantic classification before they can safely influence ranking. A label may represent:

- topic interest;
- moderation;
- safety;
- identity or community;
- content format;
- game or playful classification;
- eligibility/filtering;
- unknown provider-specific meaning.

Conservative defaults apply:

- unknown labels remain audit-only evidence;
- moderation and safety labels are not positive-interest signals;
- only labels classified as topical interests are automatically eligible for positive-interest effects;
- identity, community, and game labels require explicit low-weight policy before affecting affinity.

## Profile privacy

Recommendation profile snapshots are deliberately redacted:

- raw subject IDs are not included;
- profile entries contain canonical targets, scores, confidence, counts, privacy boundaries, protocols, source visibilities, timestamps, and expiration only;
- subject keys used for durable persistence are derived pseudonymous keys rather than raw identifiers;
- expired entries are pruned;
- configured entry limits bound retained profile state;
- disallowed privacy boundaries are rejected.

The current in-memory profile store is additive. Live/replayable integrations must add idempotent signal identity and retraction semantics before duplicate delivery can be considered safe.

## Persistence privacy

Profile persistence is adapter-based and supports local or server storage targets.

Persistence operations:

- validate and normalize profile records;
- enforce storage-target and consent requirements;
- reject aggregate-only subject profiles;
- use pseudonymous subject keys;
- verify writes by reading them back;
- clean up corrupted or mismatched writes;
- expose privacy-safe error reasons rather than raw adapter failures;
- support deletion through derived-data deletion intents.

Adapters must encrypt sensitive local/server storage as appropriate for their environment and must not log profile payloads or raw subject IDs.

## Embedding privacy and lifecycle

Subject profile embeddings are derived data. Embedding records preserve:

- pseudonymous subject key;
- allowed privacy boundary;
- model/provider/version metadata;
- source profile fingerprint and digest;
- vector dimensions and distance metric;
- creation and expiration times;
- invalidation status and reason.

Embeddings become stale or invalid when:

- consent is revoked;
- deletion is requested;
- the profile is replaced or changes;
- the model changes or is retired;
- dimensions or privacy boundaries no longer match;
- the record expires.

Embeddings must not outlive the profile/consent state that authorized their creation.

## Deletion and revocation

Derived-data deletion intents identify the subject, request time, scope, and targets such as profiles or embeddings.

A compliant integration must:

1. stop new processing for revoked consent;
2. delete the requested profile record;
3. invalidate or delete related embeddings;
4. clear associated local feedback/bandit state when included in scope;
5. prevent replayed events from silently recreating deleted state without new valid consent;
6. return privacy-safe results and errors.

## Logging, telemetry, and explanations

Logs, metrics, audit events, and errors must not include:

- raw subject identifiers;
- access tokens or credentials;
- private source payloads;
- full profile snapshots;
- raw embedding vectors;
- private labeler subscription lists;
- provider responses containing unrelated third-party data.

Operational reporting should use bounded, privacy-safe counters and reason codes.

User-facing explanations may describe why a recommendation was produced, but they must not expose private third-party data, hidden moderation state, or sensitive inferred attributes.

## Integration requirements

Every adapter or orchestration layer must preserve these invariants:

- authorization before restricted source reads;
- consent before private or server-side processing;
- strict input normalization before profile/ranking use;
- local-only defaults for private personalization;
- explicit semantic policy before labels affect ranking;
- idempotency before consuming replayable streams;
- retraction/expiration support for mutable source state;
- deletion propagation to profiles and embeddings;
- privacy-safe observability;
- no forced centralized behavioral tracking.

See [`canonical-status.md`](canonical-status.md) for current implementation status and the required execution order.