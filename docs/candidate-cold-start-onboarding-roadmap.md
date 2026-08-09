# Candidate, cold-start, and onboarding roadmap

This document defines the dependency-ordered recommendation work that follows the privacy, evidence, profile, execution, retraction, and state-placement architecture completed through PR #111.

It is intentionally an engine roadmap, not an application-UI roadmap. The first major consumer is onboarding, but the contracts defined here must remain reusable by normal recommendation flows after onboarding.

## Current architectural baseline

The repository already has both ends of the recommendation pipeline.

```text
USER UNDERSTANDING
explicit onboarding selections
  -> consented local/user-owned signals
  -> idempotent/retractable profile state

EXECUTION
prepared scoring inputs
  -> hybrid scoring
  -> optional diversity/novelty reranking
  -> explanations
  -> bounded serving
```

The missing reusable middle is:

```text
profile
  -> candidate discovery
  -> normalized candidate domain
  -> type-specific eligibility and policy
  -> scoring-input construction
```

PR #103 deliberately keeps candidate and scoring-input construction injected. The next work must preserve that separation instead of placing provider-specific discovery logic inside the execution orchestrator.

## Non-negotiable invariants

Every phase in this roadmap must preserve the repository-wide privacy and separation-of-powers rules.

- Recommendation affinity may come only from explicitly public provider evidence, ATProto public repositories, explicit user-owned local evidence, or narrowly authorized user-controlled ActivityPods/Solid Pod evidence permitted by the repository policy.
- Provider-private activity must not become positive affinity evidence.
- Blocks, mutes, domain blocks, keyword filters, safety preferences, and equivalent private moderation state are filtering constraints only. They may suppress or explain candidates, but must not become positive interests.
- Subject-level recommendation state may be persisted only in `device_owned` local-first storage or explicitly `user_owned` remote storage such as an authorized ActivityPod/Solid Pod. Provider-owned subject-level personalization is denied.
- Curated-set, starter-pack, collection, directory, and follow-pack membership is discovery provenance. It is not viewer endorsement.
- Third-party directories are optional untrusted discovery hints. Protocol-native or otherwise authoritative verification must occur before their entities are treated as verified candidates.
- Labeler discovery must never imply or create a subscription. Subscription remains an explicit user/application action.
- Protocol actions such as follow, subscribe, join, register, or follow-hashtag remain application/platform operations. The engine may propose bounded action plans but must not execute them.
- Candidate discovery, eligibility, scoring-input construction, and explanations must remain bounded, deterministic where practical, runtime-validated, and privacy-safe.
- Provider details must stay behind adapters and must not leak into generic scoring contracts.

## Phase 1 — Candidate domain and candidate-source contracts

### Goal

Make recommendation targets first-class, protocol-neutral entities so the engine can reason about more than anonymous `clusterId` values without coupling the generic core to Mastodon, ActivityPub, ATProto, ActivityPods, Pixelfed, Loops, or external directories.

### Required candidate kinds

The initial normalized domain should support, where existing provider semantics justify them:

- `account`
- `post`
- `feed`
- `list`
- `starter_pack`
- `labeler`
- `community`
- `hashtag`
- `topic`
- `instance`

A `collection` kind may be added only if it represents a recommendation target that cannot cleanly normalize to an existing kind. Provider collection containers used only as discovery sources should remain provenance rather than become candidates automatically.

### Candidate identity

Each normalized candidate must have bounded stable identity independent of display metadata. The contract should cover:

- candidate kind;
- canonical candidate ID;
- protocol family;
- provider/source namespace where needed;
- native identity such as actor URI, DID, AT URI, feed/list URI, instance origin, or normalized hashtag;
- optional canonical-interest associations;
- optional public entities/tags/language metadata;
- observation timestamp and freshness metadata;
- source provenance;
- verification state;
- candidate availability/eligibility state where already known.

Native identifiers must be normalized by existing protocol utilities where possible rather than revalidated with duplicate logic.

### Provenance

A candidate must retain why it entered the candidate set. Provenance should be able to distinguish at least:

- explicit onboarding-interest match;
- curated account set;
- legacy follow pack;
- starter pack;
- public featured hashtag;
- public trend;
- public profile metadata;
- public interaction/graph evidence;
- labeler discovery;
- native provider search/discovery;
- optional third-party directory hint;
- instance directory metadata.

Provenance records must be bounded, deduplicated, and suitable for downstream explanation generation.

### Candidate-source adapter contract

Define a protocol-neutral source interface that accepts bounded discovery context and returns normalized candidate records or provider records that are immediately normalized at the boundary.

The interface must support:

- explicit source capability declaration;
- deterministic source IDs;
- bounded pagination/cursors where applicable;
- cancellation/abort propagation;
- observation timestamps;
- source authority/verification metadata;
- privacy classification;
- provider-policy evaluation hooks;
- bounded candidate counts;
- per-item failure isolation where safe;
- no implicit writes, follows, subscriptions, or provider actions.

### Acceptance criteria

Phase 1 is complete when:

1. candidate identity is stable and runtime-validated;
2. the generic domain can represent the initial target kinds without provider-specific union members;
3. candidate provenance cannot be confused with user endorsement;
4. candidate-source adapters have explicit bounds and authority semantics;
5. untrusted directory hints are representable without being marked verified;
6. tests cover duplicate identity, unsafe identifiers, excessive metadata, provenance deduplication, unsupported kinds, and verification-state confusion;
7. the new contracts are exported through the public package surface and documented.

### Non-goals

- no ranking algorithm change;
- no UI;
- no provider action execution;
- no implicit labeler subscription;
- no provider-specific network client unless needed only as a small reference adapter after the generic contract exists.

## Phase 2 — Cold-start candidate generation

### Goal

Generate useful candidate sets from an existing recommendation profile before behavioral history or bandit learning exists.

### Inputs

Cold-start generation should consume:

- the current recommendation profile;
- bounded candidate-source adapters;
- optional request context such as language or requested target kinds;
- existing public discovery sources;
- optional untrusted directory hints that must be verified before recommendation use.

It must not require private timelines or centralized behavioral history.

### Initial discovery sources

Reuse already-implemented inputs rather than building onboarding-specific copies:

#### ActivityPub/Fediverse

- Mastodon Collections or equivalent curated sets already represented by repository adapters;
- Loops starter kits;
- explicit Pixelfed starter-kit documents;
- Fedidevs/community/follow-pack inputs already covered by the curated and legacy-pack architecture;
- public account featured hashtags;
- public instance trends;
- public ActivityPub actor/outbox metadata where it is explicitly public;
- optional FediDB or equivalent instance/account discovery only behind a source adapter and verification/policy boundary.

#### ATProto

- protocol-native accounts;
- feeds;
- lists;
- starter packs;
- labelers using the existing labeler-discovery subsystem;
- optional directory hints recorded as untrusted provenance until authoritative ATProto resolution succeeds.

### Matching

Cold-start matching should support deterministic signals derived from the already-consented profile and candidate public metadata, such as:

- canonical-interest overlap;
- canonical tag/hashtag overlap;
- entity overlap;
- language compatibility;
- public topical metadata;
- curated-source association;
- graph proximity where available;
- embedding similarity where a compatible model/vector is available;
- freshness/recency;
- source-quality or verification evidence that is policy-safe and not confused with user affinity.

No single source should be treated as magical endorsement. Multiple provenance paths may corroborate a candidate.

### Output

The phase should produce a bounded normalized candidate set with sufficient features/provenance for later eligibility, scoring-input construction, and explanations. It should not directly call provider follow/subscribe APIs.

### Acceptance criteria

- a brand-new onboarding profile can produce candidates without interaction history;
- duplicate candidates discovered from several sources collapse to one canonical identity while retaining bounded multi-source provenance;
- source failures do not silently convert unverified hints into verified candidates;
- candidate generation works with zero results and partial provider availability;
- private moderation data is not read as positive matching evidence;
- tests cover source fan-out bounds, duplicate collapse, verification, deterministic matching, cancellation, empty sources, and partial failures.

## Phase 3 — Candidate eligibility and policy composition

### Goal

Generalize eligibility so every candidate kind is evaluated before it can become a scoring/serving result, while reusing existing account policy rather than duplicating it.

### Shared gate order

```text
discovery
  -> identity resolution / verification
  -> candidate-type availability
  -> provider policy
  -> viewer safety and moderation constraints
  -> candidate eligibility result
```

Eligibility should run before expensive scoring or explanation work whenever the necessary information is available.

### Account eligibility

Reuse the existing account gate and its hardening:

- 45-day activity default;
- deactivated/suspended/deleted/unresolved rejection;
- moved-account resolution;
- move-loop protection;
- fail-closed unverifiable activity where required;
- discoverability/noindex/opt-out policy;
- identity binding;
- blocks, mutes, domain blocks, provider policy, and other existing safety gates.

The candidate layer must consume this behavior rather than fork it.

### Other candidate kinds

At minimum, define policy expectations for:

| Kind | Required eligibility examples |
| --- | --- |
| `post` | explicitly public, still available, identity-bound, not blocked/filter-matched |
| `feed` | resolvable, available, authoritative identity verified |
| `list` | resolvable, available, authoritative identity verified |
| `starter_pack` | resolvable/current, bounded members, authoritative identity verified |
| `labeler` | DID/identity verified, available, policy-eligible; subscription still explicit |
| `community` | protocol-appropriate existence and availability, policy-eligible |
| `hashtag` | normalized valid public topic and not locally filtered |
| `topic` | canonical catalog identity and policy-safe metadata |
| `instance` | current/healthy enough for recommendation, registration open when recommending signup, policy-eligible |

### Moderation and safety boundary

Viewer-private settings may be passed into the eligibility/filter stage only under the repository's local/user-owned state-placement policy. They must not be copied into candidate affinity features, persisted to provider-owned recommendation state, or exposed in public explanation text.

### Acceptance criteria

- every served candidate kind has an explicit eligibility policy;
- account policy is reused, not duplicated;
- ineligible candidates are rejected before expensive scoring when possible;
- private filtering inputs cannot contribute positive affinity;
- unknown or unverifiable required safety state fails closed according to the candidate kind's policy;
- tests cover empty moderation sets, moved identities, stale entities, unavailable feeds/lists, closed-registration instances, labeler verification, and filter-only privacy behavior.

## Phase 4 — Cold-start scoring-input builder

### Goal

Build the deterministic/entity/graph/embedding inputs expected by the existing recommendation execution orchestrator from a profile plus normalized eligible candidates.

This is the direct dependency that closes the intentionally injected boundary in PR #103.

### Responsibilities

The builder should:

- accept an execution context/profile and a bounded eligible candidate set;
- map candidate IDs to the `clusterId`/scoring identity expected by the current hybrid scorer without losing candidate identity;
- compute deterministic cold-start features;
- resolve entity overlap through existing entity infrastructure;
- optionally resolve graph features through existing graph infrastructure;
- optionally resolve compatible embeddings/ANN similarities through existing embedding infrastructure;
- default bandit/context/session features conservatively when no history exists;
- emit finite, bounded scoring inputs only;
- preserve enough association data to bind scored results back to normalized candidates.

### Cold-start behavior

The absence of behavioral history must be a supported state, not an error. Initial recommendations should derive primarily from explicit onboarding interests, public candidate metadata, curator/source provenance, freshness, language compatibility, and semantic/entity relationships.

### Acceptance criteria

- a profile plus candidate set can be passed into PR #103's execution orchestrator without an application inventing ad hoc score arrays;
- missing optional embedding, graph, or bandit inputs have documented deterministic fallback behavior;
- every scorer result can be mapped back to exactly one normalized candidate;
- non-finite scores, unknown candidate references, duplicate scoring identities, and stale feature bindings fail closed;
- tests cover cold-start/no-history operation and optional subsystem absence.

## Phase 5 — First-session recommendation orchestrator

### Goal

Compose the existing onboarding bootstrap and recommendation execution layers into a bounded first-session flow without creating a competing recommendation engine.

### Flow

```text
explicit onboarding choices
  -> existing onboarding bootstrap
  -> local/user-owned profile
  -> cold-start candidate discovery
  -> normalized candidate identity/provenance
  -> type-specific eligibility and policy
  -> cold-start scoring-input builder
  -> existing recommendation execution orchestrator
  -> diversity/novelty reranking
  -> explanation resolution
  -> bounded first-session recommendations
```

### Required behavior

- consume the existing onboarding profile/bootstrap API rather than redefining selection semantics;
- allow requested candidate-kind mixes and per-kind caps;
- preserve global bounded work before expensive operations;
- support partial source availability;
- remain functional with no behavioral history;
- preserve deterministic tie-breaking where practical;
- return candidate-domain identities and presentation-safe metadata in addition to scoring results;
- never execute follow/subscribe/join operations;
- expose only privacy-safe profile summary/freshness data, matching existing execution-orchestrator behavior.

### Acceptance criteria

- a new user can go from explicit selections to bounded useful recommendations through one reusable composition;
- the composition reuses existing profile, execution, reranking, explanation, and serving systems;
- no provider-specific branching appears in the generic orchestrator;
- empty/partial candidate sources degrade safely;
- cancellation, time/volume limits, and duplicate identities are tested;
- results do not expose profile contents or private moderation inputs.

## Phase 6 — Recommendation action-plan contracts

### Goal

Provide protocol-neutral plans describing actions an application may offer after a recommendation, while preserving application ownership of authentication, UX, confirmation, and provider API calls.

### Initial actions

Potential normalized actions include:

- `follow_account`
- `follow_hashtag`
- `subscribe_feed`
- `subscribe_list` where the provider supports that concept;
- `follow_starter_pack_members` or equivalent bounded expansion plan;
- `subscribe_labeler`
- `join_community` / `follow_community` according to protocol semantics;
- `register_instance` / `open_instance_signup` for instance recommendations.

The exact action vocabulary should be limited to real provider capabilities and must not imply equivalence where protocols differ.

### Safety requirements

- every mutating action requires explicit application/user confirmation;
- plans contain no access token, credential, private provider record, or executable transport callback;
- action identity must bind to the candidate that produced it;
- stale/moved/deleted candidate identities must be revalidated by the application/provider adapter before execution;
- labeler subscription remains explicitly opt-in.

### Acceptance criteria

- candidate kinds can expose supported actions without embedding provider clients in the engine;
- unsupported actions fail closed;
- tests cover candidate/action mismatch, stale identity, duplicate actions, bounds, and explicit-confirmation flags.

## Phase 7 — Onboarding lifecycle and refresh

### Goal

Make onboarding-derived state maintainable after the first session rather than a one-time seed.

### Lifecycle operations

Support dependency-correct behavior for:

- editing selected topics/tags;
- adding or removing selections;
- re-running candidate generation;
- propagating signal retractions through the existing ledger/profile/derived-state invalidation architecture;
- expiration and refresh;
- resuming an interrupted onboarding/recommendation request without duplicate effects;
- candidate-cache and explanation-cache invalidation;
- source disappearance or verification loss;
- moved/deleted accounts;
- consent revocation and derived-data deletion;
- switching between device-owned and user-owned authorized persistence without permitting provider-owned subject state.

### Acceptance criteria

- removing an onboarding interest retracts its contribution instead of only adding a new profile snapshot;
- reruns are idempotent and do not duplicate evidence/signals;
- derived candidate and explanation state is invalidated through the existing durable invalidation machinery;
- lifecycle operations remain correct after crash/retry;
- deletion and consent revocation preserve the existing replay barriers and privacy invariants.

## Phase 8 — Reference onboarding integration and UX examples

### Goal

Demonstrate how applications can use the stable engine contracts without making UI design part of the recommendation core.

### Reference integration should demonstrate

- catalog/topic selection;
- explicit sensitive-selection opt-in where applicable;
- local/device-owned persistence by default;
- user-controlled ActivityPods/Solid Pod persistence as the remote exception;
- first-session account/feed/list/starter-pack/labeler/topic recommendations;
- clear provenance-based explanations;
- explicit action confirmation;
- editing/re-running onboarding;
- graceful empty/partial-source states;
- accessibility-oriented presentation guidance without prescribing a specific framework.

Example explanation inputs should support outputs such as:

- "Suggested because you selected NBA and this active account appears in a basketball community pack."
- "Suggested because you selected open-source software and this verified feed covers Linux and FOSS."

The engine should expose structured explanation provenance; applications remain responsible for final wording and localization.

### Non-goals

- no mandatory page/navigation framework;
- no bundled visual design system;
- no requirement that every adopting application use the same onboarding flow.

## Cross-phase source priorities

Do not add more live protocol clients merely because they exist. Add source integrations when they exercise or unlock the candidate architecture.

Initial priority should be to reuse already-landed public sources. Additional source work should plug into `CandidateSourceAdapter` rather than cause another architecture revision.

High-value later adapters may include:

- native ATProto starter-pack/feed/list discovery;
- verified instance discovery with registration/open-state metadata;
- protocol-appropriate community discovery;
- additional ActivityPub software-specific public discovery endpoints;
- reference local-search indexes over public/user-owned cached records.

## Operational requirements across all phases

Each phase should add or preserve:

- bounded input sizes and fan-out;
- cancellation/abort support for network or long-running adapter work;
- timeouts and retry/backoff only at transport/adaptor boundaries, not inside pure domain logic;
- deterministic replay identities where stateful work occurs;
- explicit freshness and observation timestamps;
- safe handling of partial provider failure;
- privacy-safe errors and telemetry;
- no raw subject identifiers in logs/telemetry;
- property/fuzz tests for parsers and normalizers where useful;
- duplicate/replay/staleness tests;
- no silent downgrade from verified to unverified authority or vice versa;
- package-export and documentation updates for public contracts.

## Dependency order

The intended execution order is strict unless a repository-driven correctness or security finding requires a documented change:

1. **Candidate domain and candidate-source contracts**
2. **Cold-start candidate generation**
3. **Candidate eligibility and policy composition**
4. **Cold-start scoring-input builder**
5. **First-session recommendation orchestrator**
6. **Recommendation action-plan contracts**
7. **Onboarding lifecycle and refresh**
8. **Reference onboarding integration and UX examples**

The key architectural rule is that onboarding is the first major consumer of the reusable candidate system, not a separate recommendation architecture.
