# Recommendation candidate action plans

Phase 6 adds a protocol-neutral contract that describes a possible user action for an already-eligible recommendation candidate. Action plans are intentionally non-executable. They are data returned to an application, not permission for the recommendation engine to mutate a provider.

## Safety boundary

Every plan:

- is bound to the exact normalized candidate snapshot whose eligibility was evaluated;
- requires an explicit `eligible` result from the candidate-eligibility layer;
- records when that eligibility result was evaluated and rejects a result newer than the plan itself;
- requires explicit user confirmation before any mutation;
- requires identity, eligibility, and provider-capability revalidation immediately before an application performs the provider-side action;
- is created only when current provider capability evidence supports the action (see below);
- has `executable: false`; the engine does not perform follows, subscriptions, joins, registration, or starter-pack expansion;
- carries no OAuth token, credential, private moderation state, or subject personalization state.

These requirements preserve the existing project boundary: recommendation may suggest an action, but user/application authority remains responsible for executing it under current provider authorization and policy.

## Provider capability gate

`createRecommendationCandidateActionPlan` takes the candidate's `RecommendationProviderDescriptor` (from runtime provider discovery, see [`recommendation-provider-discovery.md`](recommendation-provider-discovery.md)) and throws unless all of these hold:

- the candidate has a known protocol and a provider, and `provider.providerId` equals `candidate.provider`;
- `detectedAt` is not after the plan's `createdAt`, and `expiresAt` is after it, so expired or future-dated evidence is rejected;
- the descriptor has a protocol binding for the candidate's protocol with `verification: "verified"`;
- the descriptor reports the matching capability as `supported` for that protocol. `unsupported`, `unknown`, and conflicting evidence all fail.

| Candidate kind | Required capability |
| --- | --- |
| account | `follows` |
| feed | `feeds` |
| list | `lists` |
| starter pack | `starter_packs` |
| labeler | `labels` |
| community | `communities` |
| hashtag | `hashtags` |
| instance | none, but the verified protocol binding is still required |

The plan records `providerCapabilitiesExpireAt`. That is the point after which an application must rediscover capabilities, and `requiresCapabilityRevalidation` is always `true`. Passing the gate once does not authorize a later mutation.

## Candidate actions

| Candidate kind | Plan action |
| --- | --- |
| account | `follow_account` |
| feed | `subscribe_feed` |
| list | `subscribe_list` |
| starter pack | `expand_starter_pack` |
| labeler | `subscribe_labeler` |
| community | `follow_community` |
| hashtag | `follow_hashtag` |
| instance | `open_instance_signup` |

`post` and `topic` deliberately have no mutation action-plan contract. They remain recommendation/display candidates unless a future phase defines a concrete, privacy-safe user action for them.

Starter-pack expansion is bounded to 100 members by default and cannot exceed 1,000. The bound is part of the plan contract; it is not permission to follow those members automatically.

A starter-pack plan also requires `starterPackMembers`: one `RecommendationStarterPackMemberInput` per member, holding an `eligibility` result (a `RecommendationCandidateEligibilityResult` from the account eligibility path) and a `consent` record. The eligibility result must be an account candidate with `eligible: true`, `reasonCodes` of exactly `["eligible"]`, an evaluation time no later than the plan, and a `resolvedAccount` that is not deactivated, suspended, or deleted. The member candidate's `nativeId` must also equal the resolved account URI. The plan keeps only a binding for each member (`candidateId`, `accountId`, `accountUri`, `eligibilityEvaluatedAt`, `consentState`, `consentSetSourceId`, `consentObservedAt`) under `members`, so a later execution step can compare against the identity and membership that were actually checked. Nothing else is copied.

`starterPackMembers` is required because a plan that expands a curated set of accounts has to record exactly which vetted accounts it covers, which follows the spirit of Mastodon's Collections feature (Mastodon's take on starter packs, added in Mastodon 4.6.0).

A Mastodon Collection (or Loops or Pixelfed starter kit) reaches this plan as a `starter_pack` candidate produced by the curated-set source, and it is gated by the same `starter_packs` capability as any other starter pack. See "Curated sets as starter-pack candidates" in [`cold-start-candidate-generation.md`](cold-start-candidate-generation.md) for the shape of that candidate and why the capability is shared.

Mastodon Collections list each account with a consent state of `pending`, `accepted`, `rejected`, or `revoked`. The curated-set candidate source only turns `accepted` members into candidates, and only for sets marked `discoverable` and not `sensitive`. Members in any other state, including `unknown`, are dropped before eligibility runs.

The plan now checks this itself. Each member's `consent` is `{ state, setProvider, setId, observedAt }`, where `state` is a `RecommendationCuratedAccountMembershipState`. Plan creation throws unless:

- `state` is exactly `"accepted"` (`pending`, `rejected`, `revoked`, `unknown`, and anything else are refused);
- `setProvider` and `setId` are well-formed identity strings and `observedAt` is a strict RFC 3339 timestamp no later than the plan's `createdAt`;
- the member candidate carries a `curated_account_set` provenance entry whose `sourceId` equals `createRecommendationCuratedAccountSetSourceId(setProvider, setId)`, whose `observedAt` equals `consent.observedAt`, and which has a `sourceItemId`.

The source ID helper is the same function the curated-set source uses to stamp provenance, so the two cannot drift apart. The binding stores the hashed source ID rather than the raw provider and set ID.

This is a consistency check, not proof. The consent record and the candidate's provenance are both supplied by the caller and neither is signed. The plan can tell that they agree with each other and with the candidate, but it cannot tell that they came from the curated-set source. A caller who fabricates a matching consent record and matching provenance will not be caught. Members should be built from the source's output, and the application remains responsible for that.

Consent can be withdrawn after a plan is created, so a `revoked` or `rejected` state has to be rechecked together with the identity and eligibility revalidation before anything is executed. Plans are frozen, so a revocation reported after creation is applied by `assessRecommendationCandidateActionPlan`, which marks the plan invalid or stale without changing it. See [`phase7-onboarding-lifecycle.md`](phase7-onboarding-lifecycle.md). Consent evidence and the reported events are caller-supplied and unsigned.

Plan creation fails when a member's consent or eligibility entry is missing, the member list is missing, empty, longer than `maxStarterPackMembers`, or contains two entries that resolve to the same account. It does not drop members to fit the limit. Members that are ineligible should be left out by the caller, as the safety amendments describe.

The engine does not run the member-level checks itself and does not fetch pack contents. It only refuses to build a plan unless each member arrives with passing evidence. The application still has to revalidate each bound identity before executing anything, see [`candidate-roadmap-safety-amendments.md`](candidate-roadmap-safety-amendments.md). Provider capability evidence covers the pack's provider only, not the providers of individual members.

## Relationship to the onboarding hashtag plan

`RecommendationHashtagFollowPlan` predates the generalized candidate architecture and remains an onboarding/catalog primitive. `RecommendationCandidateActionPlan` does not silently replace it. The generalized plan operates on normalized, eligibility-checked recommendation candidates and provides the candidate-bound safety contract needed by first-session and later recommendation flows.

A future compatibility migration may adapt the onboarding hashtag plan onto the generalized contract only if doing so preserves its existing API semantics and explicit-user-action boundary.
