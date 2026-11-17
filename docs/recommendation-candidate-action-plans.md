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

A starter-pack plan also requires `starterPackMembers`: one `RecommendationCandidateEligibilityResult` per member, produced by the account eligibility path. Each one must be an account candidate with `eligible: true`, `reasonCodes` of exactly `["eligible"]`, an evaluation time no later than the plan, and a `resolvedAccount` that is not deactivated, suspended, or deleted. The plan keeps only a binding for each member (`candidateId`, `accountId`, `accountUri`, `eligibilityEvaluatedAt`) under `members`, so a later execution step can compare against the identity that was actually checked. Nothing else from the eligibility result is copied.

`starterPackMembers` is required because a plan that expands a curated set of accounts has to record exactly which vetted accounts it covers, which follows the spirit of Mastodon's Collections feature (Mastodon's take on starter packs, added in Mastodon 4.6.0).

Mastodon Collections list each account with a consent state of `pending`, `accepted`, `rejected`, or `revoked`. The curated-set candidate source only turns `accepted` members into candidates, and only for sets marked `discoverable` and not `sensitive`. Members in any other state, including `unknown`, are dropped before eligibility runs. The plan itself never sees the consent state, so the caller must build `starterPackMembers` only from candidates that came through that source. Consent can be withdrawn after a plan is created, so a `revoked` or `rejected` state has to be rechecked together with the identity and eligibility revalidation before anything is executed. Pushing a revocation out to plans that already exist belongs to the Phase 7 lifecycle work and is not built here.

Plan creation fails when the member list is missing, empty, longer than `maxStarterPackMembers`, or contains two entries that resolve to the same account. It does not drop members to fit the limit. Members that are ineligible should be left out by the caller, as the safety amendments describe.

The engine does not run the member-level checks itself and does not fetch pack contents. It only refuses to build a plan unless each member arrives with passing evidence. The application still has to revalidate each bound identity before executing anything, see [`candidate-roadmap-safety-amendments.md`](candidate-roadmap-safety-amendments.md). Provider capability evidence covers the pack's provider only, not the providers of individual members.

## Relationship to the onboarding hashtag plan

`RecommendationHashtagFollowPlan` predates the generalized candidate architecture and remains an onboarding/catalog primitive. `RecommendationCandidateActionPlan` does not silently replace it. The generalized plan operates on normalized, eligibility-checked recommendation candidates and provides the candidate-bound safety contract needed by first-session and later recommendation flows.

A future compatibility migration may adapt the onboarding hashtag plan onto the generalized contract only if doing so preserves its existing API semantics and explicit-user-action boundary.
