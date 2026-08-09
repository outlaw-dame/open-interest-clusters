# Recommendation candidate eligibility and policy composition

This document describes the Phase 3 eligibility boundary that sits between cold-start candidate generation and scoring-input construction.

## Purpose

Candidate discovery is not permission to score or serve a candidate. Every candidate must pass a kind-specific eligibility policy plus provider and viewer-safety gates before later scoring work can consume it.

The shared order is:

```text
discovery
  -> candidate normalization
  -> cheap shared availability/policy gates
  -> kind-specific eligibility evidence
  -> account identity/activity resolution when applicable
  -> eligible candidate result
```

The module is intentionally protocol-neutral. Mastodon, ActivityPub, ATProto, ActivityPods/Solid and future providers may gather policy evidence differently, but the generic eligibility result exposes only privacy-safe booleans and reason codes.

## Privacy boundary

Private moderation and curation state is filter-only input.

The generic contract accepts only:

- `providerPolicy: { allowed, evidenceComplete }`
- `viewerSafety: { eligible, evidenceComplete }`

Those gate objects are runtime-closed. Raw blocks, mutes, filter keywords, matched labels, private moderation identifiers, subject IDs, or similar private details cannot be attached to them. Kind-specific evidence is also runtime-closed.

Provider- and protocol-specific safety evaluators such as the existing Mastodon and ATProto viewer-safety modules should consume private/user-owned state locally or under the repository's permitted user-controlled storage policy, then pass only the privacy-safe gate result into this boundary.

Eligibility data must never be reinterpreted as positive affinity.

## Account candidates

Accounts reuse `evaluateRecommendationAccountEligibility`; the candidate layer does not fork the existing account logic.

The existing gate continues to provide:

- the 45-day inactivity default;
- moved-account traversal;
- move-loop and move-depth protection;
- deleted/deactivated/suspended rejection;
- fail-closed unresolved activity state.

Phase 3 adds explicit candidate-level evidence for:

- identity binding to the authoritative resolver namespace;
- discoverability;
- `noindex`;
- recommendation opt-out.

The result carries the resolved account and move chain when resolution succeeds so later phases can prefer the current identity rather than the moved-from identity.

## Other candidate kinds

### Post

A post requires:

- explicitly public visibility;
- current availability;
- identity binding.

Viewer filters remain a separate filter-only gate.

### Feed and list

Feeds and lists require:

- resolution;
- current availability;
- `authority_verified` or `canonical` candidate identity.

### Starter pack

Starter packs require:

- resolution;
- current state;
- availability;
- authoritative/canonical identity;
- a bounded member count (currently at most 1,000 at the container eligibility boundary).

This container decision does **not** authorize future member-follow actions. Every expanded member must later pass its own account identity, activity, provider-policy and viewer-safety checks as documented in the candidate roadmap safety amendments.

### Labeler

Labelers require:

- authoritative/canonical candidate identity;
- explicit labeler identity verification evidence;
- availability;
- policy eligibility.

Eligibility never means subscription. Any labeler subscription remains an explicit user-confirmed provider action in the later action-plan phase.

### Community

Communities require protocol-appropriate existence, availability and policy eligibility.

### Hashtag

Hashtags require a normalized valid public topic and must not be locally filtered.

### Topic

Topics require canonical catalog identity and policy-safe metadata.

### Instance

Instances require current health, policy eligibility, and open registration because this candidate kind represents recommending an instance for signup/onboarding. Closed-registration instances therefore fail this eligibility policy.

## Fail-closed behavior

Eligibility fails closed when required provider-policy or viewer-safety evidence is incomplete.

A candidate with `availability: unavailable` is also rejected regardless of kind-specific evidence.

Strong-identity target kinds (`feed`, `list`, `starter_pack`, `labeler`) cannot pass with an `unverified_hint` or merely `source_asserted` identity.

## Empty moderation state

An empty block/mute/filter collection is valid. Provider-specific safety code should represent a successfully-read empty state as `eligible: true, evidenceComplete: true`; it must not confuse an empty list with missing or failed evidence.

## Non-goals

This phase does not:

- score candidates;
- create affinity features from safety data;
- execute follow/subscribe/join actions;
- auto-subscribe labelers;
- expand starter-pack members into follow actions;
- persist viewer-private moderation data in provider-owned recommendation state;
- expose raw provider or viewer-safety matches in public explanation text.

The next phase converts **eligible** candidates plus the consented profile into the scoring inputs expected by the existing recommendation execution orchestrator.
