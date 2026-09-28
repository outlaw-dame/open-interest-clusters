# Recommendation candidate action plans

Phase 6 adds a protocol-neutral contract that describes a possible user action for an already-eligible recommendation candidate. Action plans are intentionally non-executable. They are data returned to an application, not permission for the recommendation engine to mutate a provider.

## Safety boundary

Every plan:

- is bound to the exact normalized candidate snapshot whose eligibility was evaluated;
- requires an explicit `eligible` result from the candidate-eligibility layer;
- records when that eligibility result was evaluated and rejects a result newer than the plan itself;
- requires explicit user confirmation before any mutation;
- requires identity and eligibility revalidation immediately before an application performs the provider-side action;
- has `executable: false`; the engine does not perform follows, subscriptions, joins, registration, or starter-pack expansion;
- carries no OAuth token, credential, private moderation state, or subject personalization state.

These requirements preserve the existing project boundary: recommendation may suggest an action, but user/application authority remains responsible for executing it under current provider authorization and policy.

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

## Relationship to the onboarding hashtag plan

`RecommendationHashtagFollowPlan` predates the generalized candidate architecture and remains an onboarding/catalog primitive. `RecommendationCandidateActionPlan` does not silently replace it. The generalized plan operates on normalized, eligibility-checked recommendation candidates and provides the candidate-bound safety contract needed by first-session and later recommendation flows.

A future compatibility migration may adapt the onboarding hashtag plan onto the generalized contract only if doing so preserves its existing API semantics and explicit-user-action boundary.
