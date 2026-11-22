# Changelog

This project is pre-1.0, so a minor version can contain breaking changes. Each release lists them under "Breaking changes" with what to do about them.

## Unreleased

### Added

- `checkRecommendationCandidateEventStoreCompareAndSet(store)`. It tests a store's `supportsCompareAndSet` claim by trying a stale write on a throwaway probe subject, and returns `passed`, `failed` (with a fixed reason) or `inconclusive` when the store threw. The onboarding lifecycle runs it once before its first guarded write.
- `candidateEvents.setExclusionRetentionMs` on `createRecommendationOnboardingLifecycle`, and `MAX_RECOMMENDATION_CANDIDATE_SET_EXCLUSION_RETENTION_MS` (365 days). It lets set-level events outlive ordinary ones so a hidden set stays hidden longer. It defaults to `retentionMs`, so nothing changes unless you set it, and it may not be shorter than `retentionMs`. Deletion and revoked consent still clear these events immediately.

- `transitionRecommendationProfilePersistence` can now move stored candidate events along with the profile. Give both locations a `candidateEventStore` (and optionally `candidateEventLimits`). Events are copied, read back, and deleted from the source before the source profile is removed, with the same consent check, backoff and rerun behavior as the profile. The result gains an optional `candidateEvents` field (`moved`, `nothing_to_move` or `skipped_store_missing`). Callers that pass no event store see no change.

### Changed

- A candidate event store that declares `supportsCompareAndSet` but accepts stale writes (or refuses current ones) is no longer trusted. The lifecycle falls back to its per-subject queue without `expectedDigest`, the same as a store that never declared support. Before this, a store that lied let two devices overwrite each other without any signal.
- A lifecycle with `candidateEvents: { store }` built on the library's own derived-state orchestrator now clears the stored events on `derived.deleteSubject` without any extra wiring. The delete is part of the durable `candidate_cache` deletion step, so a failure is reported as pending and retried on the next call. If you already wrap an invalidator with `createRecommendationCandidateEventDeletionInvalidator`, that store is not deleted twice. A custom or wrapped `derived` port still needs the helper.
- `derived.deleteSubject` no longer races a report that is saving candidate events. Store saves and deletes share a per-subject queue keyed by the store object, so the deletion waits for the save and then clears it. Previously the save could land after the deletion and a second deletion was needed. This holds within one process using one store object.
- The candidate event store now keeps one slot per set, kind and candidate ID for set-level events (`set_deleted`, `set_not_discoverable`, `set_sensitive`). Reporting the same set again with a later time replaces the earlier event instead of adding another, so repeated reports cannot fill the cap. At the cap a report for a new set still fails and nothing is evicted. Records written earlier that hold duplicates are tidied on the next save.

### Documented

- Several processes and scheduled refresh: the library never refreshes on its own (the application calls `refresh`) and cannot lock across processes without shared storage. The Phase 7 doc now explains why there is no built-in lease and gives a concrete lock recipe with expiry, crash recovery and backoff.
- `lifecycle.refresh` can return fewer than `limit` recommendations when the first-session object ignores `excludeSourceIds` and had already cut its list to `limit`. The refresh filter only removes and does not rerun the first session. The library's own orchestrator is not affected.

## 0.3.0

Changes from PR #136, on top of 0.2.0.

### Added

- Set-level exclusion on refresh. When you report `set_deleted`, `set_not_discoverable` or `set_sensitive`, `lifecycle.refresh` passes the set's source ID to the first session as `excludeSourceIds`. Candidate generation drops every candidate whose provenance includes it, before ranking and before the candidate cap, so no candidate ID is needed. `excludeSourceIds` is also accepted on the first-session request directly.
- One onboarding queue per engine. Lifecycles built on the same engine now queue behind each other instead of racing. If the signal ledger moves underneath a write, the write is replanned against the new state. Unrelated ledger errors are not retried.
- An opt-in candidate event store. Pass `candidateEvents: { store }` to `createRecommendationOnboardingLifecycle` and reported events are kept, so `assessPlan` and `refresh` still honor them after a restart. Without it nothing is stored, as before. It comes with a new state domain, `candidate_lifecycle_events` (device-owned and user-owned placements only), an in-memory reference store, `createRecommendationCandidateEventDeletionInvalidator`, and the lifecycle methods `listReportedCandidateEvents` and `assessPlan`. When a store is configured, reporting events needs a consent `policy`.
- An evidence verifier hook. Apps can plug in a verifier that checks reported events and the consent evidence on a plan. A verifier can only make a plan less usable. If it rejects, throws, times out or returns junk, the report or assessment is blocked.
- Extension interfaces `RecommendationEngineEventHistoryReader` (`readEventHistory`) and `RecommendationCandidateStateInvalidator` (`invalidateCandidateState`). The factories return the richer types `RecommendationEngineOrchestratorWithHistory` and `RecommendationDerivedStateInvalidationOrchestratorWithCandidateState`. If you pass the lifecycle an engine or derived-state port that lacks the method, it checks at runtime and throws a `TypeError` on the first call that needs it, not when the lifecycle is created. Selection changes and event reports fail before the ledger or the event store is written. The one exception is a `consent_revoked` withdrawal, which still deletes stored candidate events before it reports the missing `readEventHistory`.
- `tests/public-api-surface.test.ts`, which pins exported names and interface member lists against `tests/fixtures/public-api-surface.json`.

### Changed

- `readEventHistory` is no longer a required member of `RecommendationEngineOrchestrator`, and `invalidateCandidateState` is no longer a required member of `RecommendationDerivedStateInvalidationOrchestrator`. Both were required in 0.2.0. Code that implements these interfaces (wrappers, test doubles) compiles again without them. Code that calls the two methods through the base types stops compiling, see "Breaking changes".
- The new lifecycle members and result fields live on extending types instead of the 0.2.0 ones. `createRecommendationOnboardingLifecycle` returns `RecommendationOnboardingLifecycleWithCandidateEvents` (adds `listReportedCandidateEvents` and `assessPlan`). `reportCandidateEvents` returns `RecommendationOnboardingCandidateReportResultWithEvidence`, `assessPlan` and the assessment functions return `RecommendationCandidatePlanAssessmentWithEvidence` (both add `evidenceVerification`, `verifierId`, `verifiedKinds` and `storedEventsNotChecked`), and `refresh` returns `RecommendationOnboardingRefreshResultWithSetExclusions` (adds `excludedSetSourceIds`). `RecommendationOnboardingLifecycle`, `RecommendationCandidatePlanAssessment`, `RecommendationOnboardingCandidateReportResult` and `RecommendationOnboardingRefreshResult` keep their 0.2.0 members, and the extended types are assignable to them. Hand-written doubles and hand-built values still compile.

### Breaking changes

Two, both type-level. Nothing changes at runtime.

- `RECOMMENDATION_STATE_DOMAINS` and `RecommendationStateDomain` gained `candidate_lifecycle_events`. An exhaustive `switch` or `Record<RecommendationStateDomain, ...>` will not compile until it handles the new value. Give those branches a default that treats an unknown domain as the least trusting one. The old union could not be kept, because this is a real domain that the placement policy and the candidate event store use, and a union without it would be wrong about what they return.
- Calling `readEventHistory` on a value typed `RecommendationEngineOrchestrator`, or `invalidateCandidateState` on a value typed `RecommendationDerivedStateInvalidationOrchestrator`, fails with TS2339, because both methods moved to extension types. Type the value as what the factory returns (`RecommendationEngineOrchestratorWithHistory`, `RecommendationDerivedStateInvalidationOrchestratorWithCandidateState`) or let inference do it. Making the methods optional on the base types would keep the call compiling but force an `undefined` check at every call site, so it would still break callers, and it would hide that a plain implementer may lack them.

Not breaking: the consent `policy` input is only needed when a candidate event store is configured. `RecommendationCandidateEventStore.save` takes an optional third argument and the interface gains the optional `supportsCompareAndSet`.

### Upgrade order

A derived-state task saved with `candidate_state_changed` is rejected by versions before 0.2.0 (`Invalid recommendation derived-state invalidation reason.`). Upgrade readers before writers. Stored candidate event records carry a `schemaVersion`, and a reader that meets a newer one throws instead of guessing.

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
