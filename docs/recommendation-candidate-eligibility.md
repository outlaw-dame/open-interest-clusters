# Recommendation candidate eligibility and policy composition

This document describes Phase 3 between cold-start candidate generation and scoring-input construction.

## Purpose

Discovery is not permission to score or serve a candidate. Every candidate must pass kind-specific eligibility plus provider-policy and viewer-safety gates.

The generic order is:

```text
discovery
  -> candidate normalization
  -> cheap availability and kind-specific checks
  -> authoritative account resolution when applicable
  -> resolved-current-account policy when applicable
  -> provider policy against the effective identity
  -> viewer safety against the effective identity
  -> eligibility result
```

The ordering matters for moved accounts. Activity and every application-relevant account restriction must apply to the current resolved account rather than merely the moved-from candidate that was initially discovered.

## Privacy boundary

Viewer-private moderation state remains filter-only.

The generic layer does not accept raw blocks, mutes, domain blocks, filter keywords, matched labels, subject-private moderation identifiers, or similar data. Instead, callers provide policy evaluator callbacks. Those callbacks may close over private or user-owned state, but the generic layer only receives closed privacy-safe decisions.

Provider policy returns:

```ts
{ allowed: boolean, evidenceComplete: boolean }
```

Viewer safety returns:

```ts
{ eligible: boolean, evidenceComplete: boolean }
```

Resolved-account recommendation policy returns application-neutral restrictions:

```ts
{
  restrictions: readonly (
    | "not_discoverable"
    | "noindex"
    | "opted_out"
  )[];
  evidenceComplete: boolean;
}
```

The restriction list contains only restrictions that actually apply to the resolved account's provider/application capability surface. A platform that has no Mastodon-style discoverability or noindex controls does **not** invent positive booleans; it simply omits those restrictions after its adapter has established complete policy evidence. Explicit recommendation opt-outs discovered through another supported mechanism, such as normalized public profile text, can still produce `opted_out`.

Unexpected properties, duplicate/unknown restrictions, or malformed decisions are rejected and converted to incomplete evidence. Evaluator exceptions likewise fail closed without exposing private error details.

Private policy inputs must remain local or within the repository's permitted user-controlled storage boundary. They must never become affinity features or provider-owned subject-level recommendation state.

## Cheap rejection before expensive work

The compositor rejects candidates before account resolution or policy callbacks when it already knows they cannot be eligible. Examples include:

- candidate-level `unavailable` state;
- account identity that is not bound to the resolver namespace;
- non-public or identity-unbound posts;
- unresolvable or unavailable feeds and lists;
- stale or oversized starter packs;
- unverified strong-identity target kinds;
- closed-registration instances.

This prevents unnecessary resolver or policy work for candidates whose ineligibility is already known without further identity-sensitive evaluation.

Account restrictions are deliberately **not** pre-resolution cheap gates because moved accounts require them to be checked against the resolved current account.

## Account candidates

Accounts directly reuse `evaluateRecommendationAccountEligibility`; Phase 3 does not fork the existing account gate.

That existing implementation continues to own:

- the 45-day inactivity default;
- moved-account traversal;
- move-loop and move-depth protection;
- deletion, deactivation, and suspension rejection;
- fail-closed unresolved activity state;
- cancellation before and after each moved-account resolver hop.

Phase 3 additionally requires identity binding to the resolver namespace and an `evaluateResolvedAccountPolicy` callback. After account resolution succeeds, that callback receives the resolved current account and must establish all application-relevant recommendation restrictions with complete evidence.

For example, a Mastodon-aware evaluator may translate supported account controls into:

- `discoverable: false` -> `not_discoverable`;
- `indexable: false` or an applicable noindex signal -> `noindex`;
- an explicit recommendation opt-out -> `opted_out`.

A Bluesky-aware evaluator does not manufacture `discoverable: true` or `noindex: false` because those Mastodon controls are not part of the current Bluesky profile surface. It can return an empty restriction list when all supported/observable policy mechanisms are clear and non-restrictive, or `opted_out` when an explicit supported opt-out mechanism is observed.

Malformed, unavailable, or failed resolved-account policy evidence returns `account_policy_incomplete` and fails closed.

If the account has moved, the resolved-account policy, provider-policy, and viewer-safety callbacks all receive the current `resolvedAccount` and the `moveChain`. This prevents moved-from state from bypassing policy that applies to the current identity.

If resolved-account policy rejects the account, provider and viewer-safety callbacks are not invoked.

The result retains the resolved account and move chain for later scoring-input construction.

## Other candidate kinds

### Post

A post requires:

- explicitly public visibility;
- current availability;
- identity binding.

### Feed and list

Feeds and lists require:

- successful resolution;
- current availability;
- `authority_verified` or `canonical` candidate identity.

### Starter pack

Starter packs require:

- successful resolution;
- current state;
- availability;
- `authority_verified` or `canonical` identity;
- no more than 1,000 members at this container boundary.

Container eligibility does not authorize member follows. Any later expansion must re-evaluate every member independently through account identity, activity, resolved-account policy, provider policy, and viewer-safety checks.

### Labeler

Labelers require:

- authoritative or canonical candidate identity;
- explicit identity-verification evidence;
- availability;
- policy eligibility.

Eligibility never means subscription. Subscription remains a later explicit user-confirmed provider action.

### Community

Communities require protocol-appropriate existence, availability, and policy eligibility.

### Hashtag

Hashtags require a canonical normalized public topic and must not be locally filtered.

### Topic

Topics require canonical catalog identity and policy-safe metadata.

### Instance

Instance candidates represent onboarding or signup recommendations and therefore require:

- current health;
- open registration;
- policy eligibility.

Closed-registration instances fail eligibility.

## Policy failure semantics

For account candidates, resolved-account policy runs after successful identity/activity resolution and before provider or viewer policy.

- incomplete or malformed resolved-account evidence -> `account_policy_incomplete`;
- `not_discoverable` restriction -> `account_not_discoverable`;
- `noindex` restriction -> `account_noindex`;
- `opted_out` restriction -> `account_opted_out`.

Provider-policy evaluation occurs before viewer-safety evaluation. If provider policy is denied or incomplete, viewer-safety evaluation is not invoked.

- incomplete provider evidence -> `provider_policy_incomplete`;
- provider denial -> `provider_policy_denied`;
- incomplete viewer evidence -> `viewer_safety_incomplete`;
- viewer rejection -> `viewer_safety_denied`.

Evaluator exceptions are reduced to the corresponding incomplete reason code. Exception text and raw private matches are never included in the result.

## Empty moderation state

A successfully-read empty block, mute, or filter collection is valid and should become `eligible: true, evidenceComplete: true`. Empty state is distinct from unavailable, incomplete, or failed safety evidence.

## Strong identity

The following kinds cannot pass with only `unverified_hint` or `source_asserted` identity:

- feed;
- list;
- starter pack;
- labeler.

They require `authority_verified` or `canonical` candidate identity before provider or viewer policy work.

## Protocol/application capability rule

Eligibility policy must consume application capability evidence rather than infer features from the transport protocol alone.

In particular:

- generic ActivityPub must not imply Mastodon account controls;
- generic ATProto must not imply Bluesky application features;
- ActivityPods may combine ActivityPub with Solid/ActivityPods authorization and user-owned resource semantics without implementing Mastodon or ATProto features;
- provider adapters translate supported platform controls into the generic restriction list.

See `recommendation-protocol-platform-capabilities.md` for the profile capability contract.

## Non-goals

Phase 3 does not:

- score candidates;
- convert safety decisions into positive affinity;
- execute follow, subscribe, or join actions;
- auto-subscribe labelers;
- expand starter packs into follow operations;
- expose raw moderation matches in public explanations;
- persist private viewer policy data in provider-owned recommendation state.

Phase 4 consumes **eligible** candidates and the consented profile to construct the scoring inputs expected by the existing execution orchestrator.
