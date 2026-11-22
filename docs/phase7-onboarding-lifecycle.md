# Phase 7: onboarding lifecycle and refresh

Phase 7 keeps onboarding-derived state correct after the first session. It adds four small modules, one required method on each of two existing orchestrator interfaces, and one new invalidation reason. It reuses the signal ledger, the derived-state invalidation task journal, the deletion replay barrier and the hardened profile persistence. It adds no second state system.

| Concern | Where it lives |
| --- | --- |
| Edit, remove, rerun and withdraw onboarding selections | `src/recommendation/onboarding-lifecycle.ts` |
| Plan staleness after consent revocation, set deletion, moves, verification loss, source loss | `src/recommendation/candidate-lifecycle.ts` |
| Candidate and explanation cache invalidation without a profile change | `invalidateCandidateState` on the derived-state orchestrator |
| Reading accepted event history | `readEventHistory` on the engine orchestrator |
| Moving the profile record between device-owned and user-owned storage | `src/recommendation/profile-persistence-transition.ts` |
| Per-key serialization shared by the new modules | `src/recommendation/keyed-serializer.ts` |

## Decisions

### 1. Selections are ledger events, and edits are retractions

Phase 7 writes onboarding signals through the engine as ordinary ledger events, so removal is a retraction, not a new snapshot. `createRecommendationOnboardingLifecycle(...).applySelection` runs the existing onboarding seed checks (catalog, sensitivity opt-in and consent) through `buildRecommendationOnboardingSignals`, which builds the signals without creating a profile store, then reconciles the result against the live onboarding events in the engine's accepted history:

`applySelection` rejects any input that carries a `profileStore`, so the ledger stays the only write path.

- a target that is no longer selected gets a `retract` event (`source_retracted`);
- a target whose signal changed (strength, confidence, boundary, expiry) gets a `retract` (`corrected`) and a new `apply`;
- a target that already matches is not written again;
- a target that is new, or was withdrawn or expired earlier, gets a new `apply`.

Everything goes through `derivedOrchestrator.process`, so profile replacement, invalidation of embeddings, candidate cache and explanation cache, checkpointing and crash recovery are the existing ones. `process` is called even when there is nothing to write, so a pending invalidation left by an earlier crash is finished by a plain rerun.

### 2. Event IDs carry a generation, because tombstones are permanent

The ledger never lets a retracted source event ID be applied again. A selection that is removed and later chosen again therefore needs a new ID. Onboarding source event IDs have the form `onboarding:v1:g<generation>:<sha256(kind NUL key)>`. The generation is computed from the accepted history (one more than the highest generation seen for that target), so it is deterministic and needs no stored counter. Operation IDs are derived from the source event ID. Replaying the same call produces the same events or none, and a changed call never collides with an old operation.

The history reader only treats an event as onboarding when the ID has exactly this shape and the hash matches the signal's own target. An unrelated event that happens to start with `onboarding:` is neither counted nor retracted.

"Same selection" is decided on target, action, polarity, strength, confidence, data use, privacy boundary and expiry. Audit fields and the observation timestamp are ignored, so rerunning at a later time with the same selection writes nothing.

### 3. Candidate facts are reported as events, plans are assessed, never mutated

Action plans are frozen and non-executable. When something they relied on changes, the caller reports a `RecommendationCandidateLifecycleEvent`, and `assessRecommendationCandidateActionPlan` returns a frozen assessment:

| State | Meaning | Reasons |
| --- | --- | --- |
| `invalid` | A relied-on fact was withdrawn. Discard the plan. | `member_consent_revoked`, `member_consent_rejected`, `set_deleted`, `set_not_discoverable`, `set_sensitive`, `account_moved`, `account_deleted`, `verification_lost` |
| `stale` | The plan aged out or lost support. Rebuild from fresh evidence. | `source_disappeared` (only when no provenance source is left), `provider_capability_lost`, `capability_expired`, `eligibility_aged` |
| `valid` | No known problem. Not permission to act. | none |

The assessment always has `executable: false` and `requiresRevalidation: true`. Nothing in Phase 7 performs or schedules a provider mutation. An event only counts against evidence that is not newer than it, and an event at exactly the same instant counts, because the order is unknowable. Future-dated events (more than five minutes ahead of the supplied clock) are rejected, not trusted. Eligibility evidence older than 24 hours (configurable from one minute to 30 days) makes a plan stale.

A rebuilt plan reuses the existing path: rerun candidate eligibility, which already resolves moved identities, applies the 45-day activity default and fails closed on missing state. For starter packs the assessment names the affected and unaffected members. The unaffected list only says that nothing was reported for them. They still need fresh consent and eligibility evidence.

### 4. Cache invalidation without a profile change

The derived-state orchestrator's checkpoint is a digest of the profile, so a candidate fact cannot trigger it. `invalidateCandidateState({ subjectId })` adds a durable task with reason `candidate_state_changed` and only the `candidate_cache` and `explanation_cache` targets. It first settles any pending or out-of-date profile invalidation, so the checkpoint written at the end can never claim embeddings are current when they are not. It uses the same task store, per-subject serialization and `repair` recovery. Each report is a new fact, so it is not deduplicated.

`lifecycle.reportCandidateEvents` validates the events and then calls it. `lifecycle.refresh` finishes pending invalidation (or reports the new events), then reruns the first-session orchestrator with the reported candidate IDs added to `excludeCandidateIds`. Events that name a candidate ID exclude that candidate. Set-level events (`set_deleted`, `set_not_discoverable`, `set_sensitive`) usually carry only a set source ID, so refresh also passes those IDs to the first session as `excludeSourceIds`. Candidate generation then drops every candidate whose provenance includes one of them, before ranking and before the candidate cap. Member and `starter_pack` candidates from a curated set carry the set's `createRecommendationCuratedAccountSetSourceId` in their `curated_account_set` provenance, so no candidate ID is needed. A candidate listed in two sets is dropped when either set is reported, which errs toward less usable. Member consent events also name a set, but they concern one member, so they exclude only the named candidate and not the rest of the set. The result lists what was left out in `excludedSetSourceIds`. Events are not remembered, so the exclusion covers the refresh that reports them. A caller that keeps the set out must keep reporting it, or stop returning it from its source. Set events also still invalidate any plan that relied on that set when the plan is assessed. If pending invalidation cannot be finished, `refresh` throws and does not rerun, so stale cache state is never served.

### 5. Consent revocation and deletion

- `withdrawSelections({ reason: "consent_revoked" })` retracts every live onboarding signal with the ledger's `consent_revoked` reason. `applySelection` enforces consent on every call, so a policy that no longer allows personalization (or belongs to another subject) stops a change before anything is written.
- Full deletion stays `derivedOrchestrator.deleteSubject`. The engine's deletion barrier already blocks `process`, and `readEventHistory` throws behind it too, so onboarding writes and withdrawals fail after deletion. No new deletion path was added.
- The lifecycle does not watch the consent policy. The application calls `withdrawSelections` when consent changes.

### 6. Persistence-location transitions

`transitionRecommendationProfilePersistence` moves the profile record between `local_app` (device-owned) and `user_pod` (user-owned). Order is fixed: read source, write destination (consent enforced for the remote side, verified by reading back), delete source last. A crash at any point leaves at least one complete copy, and rerunning is safe:

- a destination write that fails or fails verification leaves the source untouched;
- if only the source delete fails, the error is `source_cleanup_pending`, and the same call finishes it;
- if the source is already gone and the destination has the record, the result is `already_moved`;
- a destination copy with a newer `updatedAt` is kept and only the stale source is removed.

Adapter and verification failures are retried with exponential backoff and full jitter (default 3 attempts, 200 ms base, doubling, capped at 30 s). Consent and placement denials are never retried. Provider-hosted, server-profile, ephemeral and operator placements are refused twice: by target and by the adapter placement manifest. A transition whose two sides resolve to the same adapter and key is rejected so a record cannot delete itself. Per-subject calls are serialized in process. An abort signal also interrupts a backoff wait, so a pending retry delay does not hold the call open.

### 7. Scoring bindings

No change was needed. The Phase 4 builder already rejects a candidate bound to a different profile fingerprint, and any retraction or edit changes the profile digest. A test covers a binding made before a removal being rejected afterward.

## Acceptance criteria and where they are tested

| Criterion | Test |
| --- | --- |
| Removing a selection retracts its contribution | `recommendation-onboarding-lifecycle.test.ts`: removal, withdrawal |
| Reruns are idempotent and do not duplicate signals | same file: rerun at later times, crash resume, concurrent calls |
| A selection added back after removal works | same file: re-add (generation increments, nothing suppressed) |
| Derived state is invalidated through the existing machinery | same file and `recommendation-candidate-state-invalidation.test.ts` |
| Correct after crash and retry | partial invalidation resumes; pending profile task is finished before a candidate task |
| Deletion and consent revocation keep replay barriers | deletion barrier test; consent-denied test writes nothing |
| Plans go stale or invalid on consent revocation, set loss, moves, verification loss, source loss | `recommendation-candidate-lifecycle.test.ts` |
| Plans never become executable, malformed or future events are rejected | same file |
| Persistence moves are crash-safe and provider-owned placement is refused | `recommendation-profile-persistence-transition.test.ts` |

## Public API changes

New exports are additive. Three changes to existing exported types are not, and they break code that implements or switches over those types by hand:

- `RecommendationEngineOrchestrator` gains a required `readEventHistory(subjectId)`. A hand-written implementation or test double stops compiling until it adds the method.
- `RecommendationDerivedStateInvalidationOrchestrator` gains a required `invalidateCandidateState(input)`. Same effect for implementers.
- `RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS` gains `candidate_state_changed`. A `switch` over the reason that has no default branch fails to compile until it handles the new case.

Callers that only use the orchestrators the package builds are not affected. Tasks stored by older versions still load. The reverse does not hold: an older version reading a task saved with `candidate_state_changed` will reject it, so roll readers forward before writers.

Because of the three items above this ships as 0.2.0, a minor bump in the pre-1.0 range.

### 0.2.0 breaking changes

Everything below breaks existing callers, not only the Phase 7 interface additions:

- `RecommendationEngineOrchestrator` and `RecommendationDerivedStateInvalidationOrchestrator` have the new required methods described above, and the reason union is wider.
- The `collections` capability is now `communities`. There is no alias, so callers have to rename it.
- `starterPackMembers` takes `{ eligibility, consent }` wrappers instead of bare members.
- Member candidates must carry `curated_account_set` provenance.
- The curated-set source also emits `starter_pack` candidates when asked for that kind.

## Clocks

The lifecycle reads its own clock (`now` option, defaulting to the system time). A `now` passed to `applySelection`, `withdrawSelections`, `reportCandidateEvents` or `refresh` that is more than five minutes ahead of that clock is rejected with a `RangeError`. Expiry and event timestamps depend on this value, and trusting a far-future one would make live signals look expired. The profile move applies the same bound to its `now` against the system time.

The seed's `observedAt` and the lifecycle's `now` are separate clocks. `observedAt` defaults to `selection.selectedAt` and records when the user made the choice. `now` is when the lifecycle runs and stamps `occurredAt` on the events it writes. A selection made well before `now` therefore has signals whose evidence time is older than their event time. That is intended, and expiry is judged against `now`.

## Persisted candidate events

By default `reportCandidateEvents` only clears caches. Pass `candidateEvents: { store }` to `createRecommendationOnboardingLifecycle` and the events are also kept, so `assessPlan` and `refresh` still honor them after a restart. Leaving the option out keeps the old behavior exactly.

- **Placement.** The store declares a manifest. It is checked against the new `candidate_lifecycle_events` state domain, so device-owned and user-owned placements are accepted and provider-owned, non-deletable or non-exportable ones are refused when the lifecycle is created. `createInMemoryRecommendationCandidateEventStore` is the reference implementation; a real store only needs `load`, `save` and `delete` by subject.
- **Consent.** When a store is configured, `reportCandidateEvents` and `refresh` need a `policy`. A policy that does not allow local personalization (or names another subject) refuses the report and deletes what was kept. `withdrawSelections` with `consent_revoked` deletes the stored events before it retracts signals, and `applySelection` does the same when consent is denied. If a delete fails, the call fails and the events stay, so a retry finishes the job.
- **Deletion.** Wrap one invalidator with `createRecommendationCandidateEventDeletionInvalidator(store, inner)`, for example the `candidate_cache` one. `derived.deleteSubject` then clears the subject's events through the same durable deletion task, so a crash mid-delete resumes. Other invalidation reasons do not touch them.
- **Bounds.** At most 1000 events per subject (configurable lower with `maxEvents`). Past the cap the oldest by recording time are compacted away. Events expire after 30 days by default (`retentionMs`, 1 minute to 90 days) and are dropped on read. Compaction and expiry can make a plan look usable again, so keep the retention at least as long as the longest plan eligibility age you allow (30 days at most).
- **Isolation and integrity.** A record is bound to its subject and carries a digest over its content. A record that names another subject, has unknown fields, bad events, wrong order or a failed digest is rejected with a `TypeError`. It is never read as empty and never overwritten, because treating it as empty would make plans usable again. The digest catches damage and swapped records, not a deliberate rewrite by someone who can write the store. Fix such a record by deleting the subject's events.
- **Failure handling.** The events are saved before caches are cleared, and the call fails if the save fails, so success never claims more than was kept. Store reads, writes and deletes retry with exponential backoff and jitter (4 attempts from 25 ms, capped at 400 ms, tunable through `retry`). Reporting the same event again is a no-op: the first recording time is kept and nothing is written.
- **Read API.** `listReportedCandidateEvents({ subjectId })` returns the live events. `assessPlan({ subjectId, plan, events? })` assesses a plan against the stored events plus any extra ones. Both throw if no store is configured, so a missing store is never mistaken for "no events". Stored events are validated against their own recording time, and `refresh` merges them into the candidate and set-level exclusions.
- **Persistence transition.** `profile-persistence-transition.ts` moves the profile record only. The event store has its own placement, so it is not part of that move.

Race note: deletion goes through the derived orchestrator's own queue, not the lifecycle's. A report running at the same moment as a deletion for the same subject could save events after the delete. Avoid reporting while a deletion is in flight, or repeat the deletion afterward.

Compatibility: the new option, the `policy` field on report and refresh input, `listReportedCandidateEvents` and `assessPlan` are additive. `RecommendationOnboardingLifecycle` gains two required methods, so a hand-written implementation of that interface stops compiling until it adds them. `RECOMMENDATION_STATE_DOMAINS` gains `candidate_lifecycle_events`, which breaks exhaustive `Record<RecommendationStateDomain, ...>` maps in caller code.

## Residual limits

- Candidate lifecycle events and the consent and provenance inside plans are caller-supplied and unsigned. They can only make a plan less usable; they cannot make one more usable, and a consistent fabrication of plan evidence is still not detectable.
- Reported events are only persisted when a candidate event store is configured (see "Persisted candidate events" below). With no store, only the cache invalidation they cause is durable, as before.
- Writes for one subject are serialized in process, and every lifecycle built on the same engine object shares that queue, so two lifecycle instances cannot interleave their read-then-write steps. The engine and derived orchestrators keep their own queues, so a direct `derived.process` or engine call is not in this queue, and neither is another process. If such a writer slips in between the lifecycle's history read and its write, the ledger may reject the write with a conflict error. The lifecycle then re-reads the history and plans again, up to 5 attempts with exponential backoff and jitter (5 ms base, 100 ms cap). It only retries when the history actually changed, so an unrelated ledger error is returned on the first failure. If the outside write raised no conflict (for example it added a signal the lifecycle was about to withdraw), nothing is detected and the outside write stays until the next lifecycle call.
- Nothing here provides a cross-process lock. An application that runs several processes against one subject's ledger must route all of that subject's writes through one process or hold its own per-subject lock (a database advisory lock or a lease), and must not write onboarding-shaped events (`onboarding:v1:` source IDs) outside the lifecycle.
- Plan assessment rejects a plan whose provenance, identity fields or timestamps are malformed. A plan that is well formed but forged is still not detectable.
- The profile transition moves the profile record only. The engine's event-history store and derived caches have their own placement, owned by the application.
- A profile that holds `local_only` signals can be written to a user-owned store, the same as existing onboarding bootstrap with `storageTarget: "user_pod"`. The transition does not rewrite privacy boundaries.
- No per-kind caps or automatic periodic refresh were added. `refresh` runs when the application calls it.
