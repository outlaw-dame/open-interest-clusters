# Changelog

This project is pre-1.0, so a minor version can contain breaking changes. Each release lists them under "Breaking changes" with what to do about them.

## Unreleased

Changes from PR #136, on top of 0.2.0.

### Added

- Set-level exclusion on refresh. When you report `set_deleted`, `set_not_discoverable` or `set_sensitive`, `lifecycle.refresh` passes the set's source ID to the first session as `excludeSourceIds`. Candidate generation drops every candidate whose provenance includes it, before ranking and before the candidate cap, so no candidate ID is needed. `excludeSourceIds` is also accepted on the first-session request directly.
- One onboarding queue per engine. Lifecycles built on the same engine now queue behind each other instead of racing. If the signal ledger moves underneath a write, the write is replanned against the new state. Unrelated ledger errors are not retried.
- An opt-in candidate event store. Pass `candidateEvents: { store }` to `createRecommendationOnboardingLifecycle` and reported events are kept, so `assessPlan` and `refresh` still honor them after a restart. Without it nothing is stored, as before. It comes with a new state domain, `candidate_lifecycle_events` (device-owned and user-owned placements only), an in-memory reference store, `createRecommendationCandidateEventDeletionInvalidator`, and the lifecycle methods `listReportedCandidateEvents` and `assessPlan`. When a store is configured, reporting events needs a consent `policy`.
- An evidence verifier hook. Apps can plug in a verifier that checks reported events and the consent evidence on a plan. A verifier can only make a plan less usable. If it rejects, throws, times out or returns junk, the report or assessment is blocked.
- Extension interfaces `RecommendationEngineEventHistoryReader` (`readEventHistory`) and `RecommendationCandidateStateInvalidator` (`invalidateCandidateState`). The factories return the richer types `RecommendationEngineOrchestratorWithHistory` and `RecommendationDerivedStateInvalidationOrchestratorWithCandidateState`. If you pass the lifecycle an engine or derived-state port that lacks the method, it checks at runtime and throws a `TypeError` on the first call that needs it, not when the lifecycle is created. Selection changes and event reports fail before the ledger or the event store is written. The one exception is a `consent_revoked` withdrawal, which still deletes stored candidate events before it reports the missing `readEventHistory`.
- `tests/public-api-surface.test.ts`, which pins exported names and interface member lists against `tests/fixtures/public-api-surface.json`.

### Changed

- `readEventHistory` is no longer a required member of `RecommendationEngineOrchestrator`, and `invalidateCandidateState` is no longer a required member of `RecommendationDerivedStateInvalidationOrchestrator`. Both were required in 0.2.0. Wrappers and test doubles written before 0.2.0 compile again, and code written against 0.2.0 keeps working.

### Breaking changes

All of these are type-level. Nothing changes at runtime for code that only uses the orchestrators this package builds.

- `RecommendationOnboardingLifecycle` has two new required methods, `listReportedCandidateEvents` and `assessPlan`. The library builds this object, so only a hand-written double stops compiling. Add the two methods to it.
- `RecommendationCandidatePlanAssessment` and the report result have three new required fields: `evidenceVerification`, `verifiedKinds` and `storedEventsNotChecked`. Code that builds one by hand must set them. Code that only reads them is fine.
- Three unions grew: `RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS` gained `candidate_state_changed`, `RECOMMENDATION_STATE_DOMAINS` gained `candidate_lifecycle_events`, and `RecommendationEvidenceVerificationState` gained `partial`. An exhaustive `switch` or `Record<..., ...>` over any of them will not compile until it handles the new value. Give those branches a default that treats an unknown value as the least trusting one.

Not breaking: the consent `policy` input is only needed when a candidate event store is configured. `RecommendationCandidateEventStore.save` takes an optional third argument and the interface gains the optional `supportsCompareAndSet`.

### Upgrade order

A derived-state task saved with `candidate_state_changed` is rejected by older versions (`Invalid recommendation derived-state invalidation reason.`). Upgrade readers before writers. Stored candidate event records carry a `schemaVersion`, and a reader that meets a newer one throws instead of guessing.

## 0.2.0

Covers PRs #128 to #135. Phase 6 follow-ups and Phase 7 (onboarding lifecycle).

### Breaking changes

- **New required members on the engine and derived-state orchestrators.** `RecommendationEngineOrchestrator` gained `readEventHistory(subjectId)`, and `RecommendationDerivedStateInvalidationOrchestrator` gained `invalidateCandidateState({ subjectId, occurredAt? })`. Anything you implement by hand has to add them. (Relaxed again in Unreleased.)
- **Wider invalidation reason union.** `RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS` gained `candidate_state_changed`. Exhaustive switches over it need a new case.
- **`collections` is now `communities`.** The provider capability that gates community candidates was renamed because it collided with Mastodon Collections. There is no alias. A descriptor or observation that still says `collections` is treated as an unknown capability, so normalization throws `Invalid recommendation provider capability observation.` Report `communities` instead.
- **`starterPackMembers` takes wrappers.** Each member is now `{ eligibility, consent }` instead of a bare eligibility result, and consent must show an accepted membership. Plans built without `starterPackMembers` throw, and a member whose consent is not `accepted` is rejected. Wrap each member and supply consent evidence.
- **Starter-pack member candidates need `curated_account_set` provenance.** When building a starter-pack plan, each member candidate must carry a `curated_account_set` provenance entry whose source ID (set provider and set ID), observation time and item ID match the member's consent. Otherwise plan building throws `Recommendation starter-pack member consent must match curated-set provenance on the candidate.` Make sure your source attaches it.
- **Curated-set source emits `starter_pack` candidates.** When a caller asks for the `starter_pack` kind, the curated account set source now returns the set itself as a candidate, gated by the `starter_packs` capability. Callers that assumed only members would come back need to handle the new kind.

### Added

- The start-of-lifecycle APIs: `createRecommendationOnboardingLifecycle` with selection edit, remove, rerun and withdrawal (`source_retracted`, `consent_revoked`), candidate lifecycle assessment of action plans against reported events, and a crash-safe profile move between device-owned and user-owned storage.
- Starter-pack plans bind each member to the resolved account identity from its eligibility result.
- Backoff waits can be aborted, and lifecycle times that run more than five minutes ahead of the clock are rejected with a `RangeError`.
- The engine and invalidation orchestrators share one keyed serializer.

See `docs/phase7-onboarding-lifecycle.md` for the lifecycle and `docs/recommendation-provider-discovery.md` for the capability rename.
