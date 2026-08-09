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
  -> provider policy against the effective identity
  -> viewer safety against the effective identity
  -> eligibility result
```

The ordering matters for moved accounts: provider and viewer policy must see the resolved current account, not merely the moved-from candidate that was initially discovered.

## Privacy boundary

Viewer-private moderation state remains filter-only.

The generic layer does not accept raw blocks, mutes, domain blocks, filter keywords, matched labels, subject-private moderation identifiers, or similar data. Instead, callers provide policy evaluator callbacks. Those callbacks may close over private/user-owned state, but they receive only the normalized candidate plus the resolved current account when one exists and must return a runtime-closed privacy-safe decision:

```ts
{ allowed: boolean, evidenceComplete: boolean }
{ eligible: boolean, evidenceComplete: boolean }
```

Unexpected properties on those decisions are rejected and converted to incomplete evidence. Provider/viewer evaluator exceptions likewise fail closed without exposing private error details.

Private policy inputs must remain local or within the repository's permitted user-controlled storage boundary. They must never become affinity features or provider-owned subject-level recommendation state.

## Cheap rejection before expensive work

The compositor rejects candidates before account resolution or policy callbacks when it already knows they cannot be eligible. Examples include:

- candidate-level `unavailable` state;
- discoverability/noindex/opt-out rejection;
- non-public or identity-unbound posts;
- unresolvable/unavailable feeds or lists;
- stale or oversized starter packs;
- unverified strong-identity target kinds;
- closed-registration instances.

This prevents unnecessary resolver or policy work for already-ineligible candidates.

## Account candidates

Accounts directly reuse `evaluateRecommendationAccountEligibility`; Phase 3 does not fork the existing account gate.

That existing implementation continues to own:

- the 45-day inactivity default;
- moved-account traversal;
- move-loop and move-depth protection;
- deletion, deactivation and suspension rejection;
- fail-closed unresolved activity state.

Phase 3 additionally requires explicit evidence for:

- identity binding to the resolver namespace;
- discoverability;
- `noindex`;
- recommendation opt-out.

If the resolver follows a moved account, the provider-policy and viewer-safety callbacks receive `resolvedAccount` and `moveChain`. This prevents a moved-from account's safety state from being mistaken for the current identity's state.

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

Container eligibility does not authorize member follows. Any later expansion must re-evaluate every member independently through account identity, activity, provider-policy and viewer-safety checks.

### Labeler

Labelers require:

- authoritative/canonical candidate identity;
- explicit identity-verification evidence;
- availability;
- policy eligibility.

Eligibility never means subscription. Subscription remains a later explicit user-confirmed provider action.

### Community

Communities require protocol-appropriate existence, availability and policy eligibility.

### Hashtag

Hashtags require a normalized valid public topic and must not be locally filtered.

### Topic

Topics require canonical catalog identity and policy-safe metadata.

### Instance

Instance candidates represent onboarding/signup recommendations and therefore require:

- current health;
- open registration;
- policy eligibility.

Closed-registration instances fail eligibility.

## Provider and viewer policy failure semantics

Provider-policy evaluation occurs before viewer-safety evaluation. If provider policy is denied or incomplete, viewer-safety evaluation is not invoked.

Both policy evaluators fail closed:

- incomplete provider evidence -> `provider_policy_incomplete`;
- provider denial -> `provider_policy_denied`;
- incomplete viewer evidence -> `viewer_safety_incomplete`;
- viewer rejection -> `viewer_safety_denied`.

Evaluator exceptions are reduced to the corresponding incomplete reason code. Exception text is never included in the result.

## Empty moderation state

A successfully-read empty block/mute/filter collection is valid and should become `eligible: true, evidenceComplete: true`. Empty state is distinct from unavailable, incomplete, or failed safety evidence.

## Strong identity

The following kinds cannot pass with only `unverified_hint` or `source_asserted` identity:

- feed;
- list;
- starter pack;
- labeler.

They require `authority_verified` or `canonical` candidate identity before provider/viewer policy work.

## Non-goals

Phase 3 does not:

- score candidates;
- convert safety decisions into positive affinity;
- execute follow/subscribe/join actions;
- auto-subscribe labelers;
- expand starter packs into follow operations;
- expose raw moderation matches in public explanations;
- persist private viewer policy data in provider-owned recommendation state.

Phase 4 consumes **eligible** candidates and the consented profile to construct the scoring inputs expected by the existing execution orchestrator.
