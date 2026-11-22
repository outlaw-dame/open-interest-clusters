# Phase 7: onboarding lifecycle and refresh

Phase 7 keeps onboarding-derived state correct after the first session. It adds a handful of small modules (the lifecycle, candidate lifecycle assessment, profile persistence transition, an optional candidate event store, an optional evidence verifier, and a keyed serializer), one new state domain, and new lifecycle methods that sit on an extending type (`RecommendationOnboardingLifecycleWithCandidateEvents`) instead of the base lifecycle interface. The invalidation reason `candidate_state_changed` it relies on already exists in 0.2.0. The breaking changes are listed under "Public API changes". It reuses the signal ledger, the derived-state invalidation task journal, the deletion replay barrier and the hardened profile persistence. It adds no second state system.

| Concern | Where it lives |
| --- | --- |
| Edit, remove, rerun and withdraw onboarding selections | `src/recommendation/onboarding-lifecycle.ts` |
| Plan staleness after consent revocation, set deletion, moves, verification loss, source loss | `src/recommendation/candidate-lifecycle.ts` |
| Candidate and explanation cache invalidation without a profile change | `invalidateCandidateState` on the derived-state orchestrator |
| Reading accepted event history | `readEventHistory` on the engine orchestrator |
| Moving the profile record between device-owned and user-owned storage | `src/recommendation/profile-persistence-transition.ts` |
| Optional durable store for reported candidate events | `src/recommendation/candidate-event-store.ts` |
| Optional verifier for reported events and plan evidence | `src/recommendation/evidence-verifier.ts` |
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

`lifecycle.reportCandidateEvents` validates the events and then calls it. `lifecycle.refresh` finishes pending invalidation (or reports the new events), then reruns the first-session orchestrator with the reported candidate IDs added to `excludeCandidateIds`. Events that name a candidate ID exclude that candidate. Set-level events (`set_deleted`, `set_not_discoverable`, `set_sensitive`) usually carry only a set source ID, so refresh also passes those IDs to the first session as `excludeSourceIds`. Candidate generation then drops every candidate whose provenance includes one of them, before ranking and before the candidate cap. Member and `starter_pack` candidates from a curated set carry the set's `createRecommendationCuratedAccountSetSourceId` in their `curated_account_set` provenance, so no candidate ID is needed. A candidate listed in two sets is dropped when either set is reported, which errs toward less usable. Member consent events also name a set, but they concern one member, so they exclude only the named candidate and not the rest of the set. The result lists what was left out in `excludedSetSourceIds`. `refresh` also filters the first-session result itself by the same source IDs, so a first-session object written before `excludeSourceIds` existed (one that ignores the field) cannot bring a reported set back. Remaining recommendations are renumbered from rank 1. This filter only removes and never reruns the first session, so an old object that ignores `excludeSourceIds` and had already cut its list to `limit` can return fewer than `limit` results. The library's own orchestrator applies the exclusion before the cut and does not have this gap. The discovered and eligible counts still describe what the first session saw. Without a candidate event store, events are not remembered, so the exclusion covers only the refresh that reports them, and a caller that keeps the set out must keep reporting it or stop returning it from its source. With a store (see "Persisted candidate events"), stored events are merged into the exclusions on every refresh until they expire. Set events also still invalidate any plan that relied on that set when the plan is assessed. If pending invalidation cannot be finished, `refresh` throws and does not rerun, so stale cache state is never served.

### 5. Consent revocation and deletion

- `withdrawSelections({ reason: "consent_revoked" })` retracts every live onboarding signal with the ledger's `consent_revoked` reason. `applySelection` enforces consent on every call, so a policy that no longer allows personalization (or belongs to another subject) stops a change before the ledger is touched.
- Full deletion stays `derivedOrchestrator.deleteSubject`. The engine's deletion barrier already blocks `process`, and `readEventHistory` throws behind it too, so onboarding writes and withdrawals fail after deletion. No new deletion path was added.
- The lifecycle does not watch the consent policy. The application calls `withdrawSelections` when consent changes.

### 6. Persistence-location transitions

`transitionRecommendationProfilePersistence` moves the profile record between `local_app` (device-owned) and `user_pod` (user-owned). Order is fixed: read source, write destination (consent enforced for the remote side, verified by reading back), delete source last. A crash at any point leaves at least one complete copy, and rerunning is safe:

- a destination write that fails or fails verification leaves the source untouched;
- if only the source delete fails, the error is `source_cleanup_pending`, and the same call finishes it;
- if the source is already gone and the destination has the record, the result is `already_moved`;
- a destination copy with a newer `updatedAt` is kept and only the stale source is removed.

Adapter and verification failures are retried with exponential backoff and full jitter (default 3 attempts, 200 ms base, doubling, capped at 30 s). Consent and placement denials are never retried. Provider-hosted, server-profile, ephemeral and operator placements are refused twice: by target and by the adapter placement manifest. A transition whose two sides resolve to the same adapter and key is rejected so a record cannot delete itself. Per-subject calls are serialized in process. An abort signal also interrupts a backoff wait, so a pending retry delay does not hold the call open.

Stored candidate events move in the same call when both locations set `candidateEventStore`. They are the same kind of private, subject-level data, so the same rules apply:

- Consent for a remote destination is checked before anything is touched, so a denial leaves the profile and the events where they were.
- The source events are read and validated first. A record that names another subject, fails its digest or holds an invalid event stops the move with nothing written. Events are merged into whatever the destination already holds and keep their original recording times, so a move does not restart retention. Pass the same `candidateEventLimits` the lifecycle uses, otherwise set-level exclusions older than the default retention would be dropped on the way.
- The destination is read back and checked against the digest of what was written. A compare-and-set store is written with `expectedDigest`, and a conflict is retried with the same backoff.
- Source events are deleted after the destination is verified and before the source profile, so the profile stays as the marker for a rerun. If the delete fails the error is `source_cleanup_pending` and the same call finishes it without a second write.
- With a store on only one side, events are left alone and the result carries `candidateEvents: "skipped_store_missing"`. Without any event store the field is absent.
- The move runs inside both stores' per-subject queues, so a report that is mid-save finishes first. Store methods must not call back into the lifecycle for the same subject, because that waits on the same queue. Passing one store object on both sides is refused.

Only profile records and candidate events move. The engine's event-history store and derived caches have their own placement.

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
| Reported events survive restart, are bounded, subject-bound, tamper-evident, consent-gated and deleted with the subject | `recommendation-candidate-event-store.test.ts` |
| Deletion racing an in-flight report | same file: a deletion during a slow save waits for it and then clears the events |
| A verifier that rejects, throws, times out or returns junk blocks the report or assessment | `recommendation-evidence-verifier.test.ts` |
| Two lifecycles on one engine queue behind each other, a racing direct write converges, and an unrelated ledger error is not retried | same file: lifecycle instances queue, direct write racing, ledger error |

## Public API changes

New exports are additive. Compared with 0.2.0, interfaces that an application implements by hand (engine and derived-state ports, stores, verifiers) have no required Phase 7 members. Where Phase 7 needs a new capability from such a port, it lives on a separate extension interface that the lifecycle looks for at runtime:

- `readEventHistory(subjectId)` is on `RecommendationEngineEventHistoryReader`, not on `RecommendationEngineOrchestrator`. `createRecommendationEngineOrchestrator` returns `RecommendationEngineOrchestratorWithHistory`, so code using the package's engine sees it. A wrapper or test double that lacks it still compiles. A lifecycle built on an engine without it is created normally and throws a `TypeError` on the first `applySelection` or `withdrawSelections`. `applySelection` and non-revoking withdrawals fail before the ledger is touched. A `consent_revoked` withdrawal still deletes stored candidate events before it fails, because revoked consent should remove them either way. Event reports, `assessPlan` and `refresh` do not need it.
- `invalidateCandidateState(input)` is on `RecommendationCandidateStateInvalidator`, not on `RecommendationDerivedStateInvalidationOrchestrator`. The factory returns `RecommendationDerivedStateInvalidationOrchestratorWithCandidateState`. A lifecycle built on a derived-state port without it throws a `TypeError` from `reportCandidateEvents` (and from a `refresh` that reports events) before consent is read or anything is stored, because the candidate caches could not be cleared. Selections, `assessPlan` and a `refresh` with no events still work.

The same applies to the lifecycle and its results. The base types keep their 0.2.0 members, and the new members sit on interfaces that extend them. The factories and functions return the extended types, which are assignable to the base ones:

- `RecommendationOnboardingLifecycle` is unchanged (`applySelection`, `withdrawSelections`, `reportCandidateEvents`, `refresh`). `createRecommendationOnboardingLifecycle` returns `RecommendationOnboardingLifecycleWithCandidateEvents`, which adds `listReportedCandidateEvents` and `assessPlan` and accepts the optional `policy` on event reports. A hand-written lifecycle double still compiles.
- `RecommendationCandidatePlanAssessment` is unchanged. The assessment functions and `assessPlan` return `RecommendationCandidatePlanAssessmentWithEvidence`, which adds `evidenceVerification`, `verifierId`, `verifiedKinds` and `storedEventsNotChecked`.
- `RecommendationOnboardingCandidateReportResult` is unchanged. `reportCandidateEvents` returns `RecommendationOnboardingCandidateReportResultWithEvidence` with the same four evidence fields.
- `RecommendationOnboardingRefreshResult` is unchanged. `refresh` returns `RecommendationOnboardingRefreshResultWithSetExclusions`, which adds `excludedSetSourceIds`.

`tests/public-api-surface.test.ts` holds a hand-written lifecycle and hand-built result values written against the 0.2.0 shapes, so they stop compiling if a required member is ever added to a base type again.

Two type-level changes still break existing code. First: `RECOMMENDATION_STATE_DOMAINS` (and with it `RecommendationStateDomain`) gains `candidate_lifecycle_events`. An exhaustive `switch` or `Record<RecommendationStateDomain, ...>` fails to compile until it handles the new value. The old union could not be kept. The value is a real state domain: `isRecommendationStateDomain` accepts it, the placement policy returns metadata for it, and the candidate event store's manifest declares it. A union that left it out would make those types describe values the code does not produce. See "Open unions" below.

Second, `readEventHistory` and `invalidateCandidateState` are no longer on the base port types. Calling `engine.readEventHistory(...)` on a value typed `RecommendationEngineOrchestrator`, or `derived.invalidateCandidateState(...)` on a value typed `RecommendationDerivedStateInvalidationOrchestrator`, fails with TS2339. Type the value as the factory's return type (`RecommendationEngineOrchestratorWithHistory` or `RecommendationDerivedStateInvalidationOrchestratorWithCandidateState`) or let inference do it. Optional members on the base types would still force an `undefined` check at each call, so they would not avoid the break.

Two things that looked like breaks are not. `candidate_state_changed` was already in `RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS` in 0.2.0. `RecommendationEvidenceVerificationState` (and its `partial` value) is new in this release, so nothing existed to widen.

Not breaking: the consent `policy` input. It is only required when a candidate event store is configured, and a lifecycle without a store never asks for it. `RecommendationCandidateEventStore.save` takes an optional third argument and the interface gains the optional `supportsCompareAndSet`. The candidate event store and its in-memory reference implementation are new in this release, so its `ephemeral` default manifest (adapter ID `in-memory-candidate-events-ephemeral`) does not change anything that existed before.

Callers that only use the orchestrators the package builds are not affected. Tasks stored by older versions still load. The reverse does not hold: a version before 0.2.0 reading a task saved with `candidate_state_changed` will reject it with `Invalid recommendation derived-state invalidation reason.` (these task records have no version tag and are short-lived), so roll readers forward before writers. Stored candidate event records carry `schemaVersion`. A reader that meets a later `recommendation-candidate-event-record.vN` throws `Unsupported recommendation candidate event record schema version. Upgrade this library to read it.` instead of a parse error, and never guesses at the contents.

### Open unions

These lists can grow in a minor release, so code that branches on them needs a default case that fails safe (treat an unknown value as the least trusting one):

- derived-state invalidation reasons (`RECOMMENDATION_DERIVED_STATE_INVALIDATION_REASONS`) and targets
- state domains (`RECOMMENDATION_STATE_DOMAINS`) and persistence modes
- evidence verification states (`unverified`, `partial`, `verified`) and evidence kinds
- provider capability names and other capability enums

`tests/public-api-surface.test.ts` pins the exported names and the member lists of the interfaces above against `tests/fixtures/public-api-surface.json`. After an intentional API change, run `pnpm build && UPDATE_API_SURFACE=1 node --test dist/tests/public-api-surface.test.js`, review the fixture diff and commit it with the change.

Version 0.2.0 shipped with `readEventHistory` and `invalidateCandidateState` as required members of the engine and derived-state orchestrator interfaces. The extension interfaces above relax that for implementers. Code that only implements these interfaces keeps compiling, but code that calls the two methods through the base types does not (see above). The full list of breaking changes per release, with migration notes, is in [CHANGELOG.md](../CHANGELOG.md).

## Clocks

The lifecycle reads its own clock (`now` option, defaulting to the system time). A `now` passed to `applySelection`, `withdrawSelections`, `reportCandidateEvents` or `refresh` that is more than five minutes ahead of that clock is rejected with a `RangeError`. Expiry and event timestamps depend on this value, and trusting a far-future one would make live signals look expired. The profile move applies the same bound to its `now` against the system time.

The seed's `observedAt` and the lifecycle's `now` are separate clocks. `observedAt` defaults to `selection.selectedAt` and records when the user made the choice. `now` is when the lifecycle runs and stamps `occurredAt` on the events it writes. A selection made well before `now` therefore has signals whose evidence time is older than their event time. That is intended, and expiry is judged against `now`.

## Persisted candidate events

By default `reportCandidateEvents` only clears caches. Pass `candidateEvents: { store }` to `createRecommendationOnboardingLifecycle` and the events are also kept, so `assessPlan` and `refresh` still honor them after a restart. Leaving the option out keeps the old behavior exactly.

- **Placement.** The store declares a manifest. It is checked against the new `candidate_lifecycle_events` state domain, so device-owned and user-owned placements are accepted and provider-owned, non-deletable or non-exportable ones are refused when the lifecycle is created. `createInMemoryRecommendationCandidateEventStore` is the reference implementation. It keeps records in process memory, so its default manifest says `persistence: "ephemeral"` and a restart loses everything; use it for tests and as a model, and give a real store its own manifest. A real store needs `load`, `save` and `delete` by subject.
- **Consent.** When a store is configured, `reportCandidateEvents` needs a `policy`, and so does `refresh` when it reports events. `refresh` and `assessPlan` also take an optional `policy`: when given, consent is checked before stored events are read, and denied consent deletes them. When it is left out, stored events are still read. That can only exclude more, but it means a consent revoked outside the lifecycle is not noticed by a call that passes no policy. A policy that does not allow local personalization (or names another subject) refuses the call and deletes what was kept. `withdrawSelections` with `consent_revoked` deletes the stored events before it retracts signals, and `applySelection` does the same when consent is denied. If a delete fails, the call fails and the events stay, so a retry finishes the job.
- **Deletion.** When `derived` is the library's own orchestrator (from `createRecommendationDerivedStateInvalidationOrchestrator`), the lifecycle registers its store with it, and `derived.deleteSubject` clears the subject's events as part of the `candidate_cache` target. That runs inside the durable deletion task, before your own `candidate_cache` invalidator, so a failed or interrupted delete leaves the target pending (the call throws `RecommendationDerivedStateInvalidationPendingError`) and the next call for the subject finishes it. Several lifecycles sharing one store delete it once. If `derived` is your own port or a wrapper around the library's, the lifecycle cannot reach it: wrap one invalidator with `createRecommendationCandidateEventDeletionInvalidator(store, inner)`, for example the `candidate_cache` one. A store you already wrapped that way is recognized and not deleted a second time. Recovery after a restart clears the store only once a lifecycle with that store has been created again, so build the lifecycle at startup. Other invalidation reasons do not touch the events.
- **Bounds.** At most 1000 events per subject (configurable lower with `maxEvents`). Past the cap the oldest ordinary events (by recording time) are compacted away first. Set-level events (`set_deleted`, `set_not_discoverable`, `set_sensitive`) are never evicted for room, and neither is an event being added in the same report. If the cap leaves no other choice, the report fails with a `TypeError` and nothing is stored or cleared, so a flood of unrelated events cannot make a deleted set eligible again. Set-level events are also coalesced: a set holds one slot per kind and candidate ID, and reporting it again with a later `occurredAt` replaces the earlier event in place instead of taking another slot. An older or identical report is already covered and writes nothing. A different candidate ID on a set-level event stays its own entry, because that candidate is excluded everywhere and dropping it would let it back in. Set-level events leave only by expiring, so a "never show this set" lasts `setExclusionRetentionMs` from its latest report. That defaults to `retentionMs` (30 days by default, 90 at most), may be set longer up to 365 days, and may not be shorter than `retentionMs`. Re-reporting the set restarts its clock. Deletion and revoked or denied consent still remove set-level events at once, whatever their retention. The library does not re-derive set exclusions from the ledger or from fresh source reads, because it has no record of which sets the user hid other than these events. If the set should stay hidden for good, the application keeps that preference in its own user-owned settings and either passes it as `excludeSourceIds` on every refresh or reports the set again before the exclusion expires. Events expire after 30 days by default (`retentionMs`, 1 minute to 90 days) and are dropped on read. Compaction of ordinary events and expiry can make a plan look usable again, so keep the retention at least as long as the longest plan eligibility age you allow (30 days at most).
- **Isolation and integrity.** A record is bound to its subject and carries a digest over its content. A record that names another subject, has unknown fields, bad events, wrong order or a failed digest is rejected with a `TypeError`. It is never read as empty and never overwritten, because treating it as empty would make plans usable again. The digest catches damage and swapped records, not a deliberate rewrite by someone who can write the store. Fix such a record by deleting the subject's events.
- **Failure handling.** The events are saved before caches are cleared, and the call fails if the save fails, so success never claims more than was kept. Store reads, writes and deletes retry with exponential backoff and jitter (4 attempts from 25 ms, capped at 400 ms, tunable through `retry`). Reporting the same event again is a no-op: the first recording time is kept and nothing is written.
- **Concurrent writers.** The in-process queue covers one engine. For several processes or devices on one user-owned store, the store can opt into compare-and-set: set `supportsCompareAndSet: true` and make `save(subjectId, record, { expectedDigest })` write only when the held record's digest equals `expectedDigest` (`null` means no record), otherwise throw `RecommendationCandidateEventConflictError` without writing. The lifecycle then reloads, merges and saves again, up to 6 attempts with backoff and jitter, and surfaces the conflict error if they run out. A store that does not declare support is single-writer: with two writers the last save wins and the other's new events can be lost, and nothing detects it. The lifecycle does not take the declaration on faith. Before its first guarded write it runs `checkRecommendationCandidateEventStoreCompareAndSet` against the store, which saves and deletes a few empty records under a random `cas-conformance-probe-` subject id and confirms that a stale `expectedDigest` is refused and a current one is accepted. If the store fails (it accepted a stale write, or refused a current one), the lifecycle treats it as single-writer from then on: writes from this process are still queued per subject, but it stops sending `expectedDigest`. If the store throws during the check, nothing is learned, that write goes out unguarded, and the check runs again on the next write. You can call the same function yourself at startup and refuse to run when it does not return `{ status: "passed" }`. Run it against the real store, not a mock. The reference in-memory store supports compare-and-set. The third `save` argument is optional, so existing stores keep working unchanged.
- **Read API.** `listReportedCandidateEvents({ subjectId })` returns the live events. `assessPlan({ subjectId, plan, events? })` assesses a plan against the stored events plus any extra ones. Both throw if no store is configured, so a missing store is never mistaken for "no events". Stored events are validated against their own recording time, and `refresh` merges them into the candidate and set-level exclusions. The merged lists (stored events plus the request's own `excludeCandidateIds` and `excludeSourceIds`) are checked against the 5000 entry limit before the first session runs. Over it, `refresh` throws `Too many recommendation exclusions for one refresh.` instead of dropping entries, because dropping would show withdrawn candidates again.

Race note: saves and deletes against the event store go through one in-process queue per subject, keyed by the store object. The lifecycle's saves and deletes and the deletion invalidator all use it. A `derived.deleteSubject` that arrives while a report is saving waits for that save and then deletes, so the report's events do not come back after the deletion. A test interleaves a slow save with a deletion and checks the order. This covers one process sharing one store object. Another process, or a second store client object over the same data, has its own queue, so a deletion there can still be followed by a late save from here; repeat the deletion, or route deletes and reports for a subject through one process. Store methods must not call back into the lifecycle or the deletion invalidator for the same subject, because that call would wait behind itself.

Compatibility: the `candidateEvents` option and the `policy` field on report and refresh input are additive. Without a store, `listReportedCandidateEvents` and `assessPlan` throw. The interface and state domain changes are in "Public API changes".

## Residual limits

State after the limit-reduction work, with what each item does and does not cover.

1. **No proof is verified by default.** Candidate lifecycle events and the consent and provenance inside plans are caller-supplied. Nothing in the repository verifies the protocol proofs behind them (see "What is and is not verified today"). The optional `evidenceVerifier` hook (see "Evidence verification") lets the application reject evidence, and a rejection or failure blocks the report or assessment. Without a verifier, results say `evidenceVerification: "unverified"`, and a consistent fabrication of plan evidence is not detectable. Plan assessment also rejects malformed provenance, identity fields and timestamps, but a well-formed forgery passes. Evidence can only make a plan less usable, with or without a verifier.
2. **Reported events are lost on restart: fixed when a store is configured, opt-in.** With `candidateEvents: { store }` events are kept (see "Persisted candidate events"). With no store, only the cache invalidation they cause is durable, as before.
3. **Write interleaving: fixed in process per engine, cross-process remains.** Writes for one subject are serialized in process, and every lifecycle built on the same engine object shares that queue, so two lifecycle instances cannot interleave their read-then-write steps. The engine and derived orchestrators keep their own queues, so a direct `derived.process` or engine call is not in this queue, and neither is another process. If such a writer slips in between the lifecycle's history read and its write, the ledger may reject the write with a conflict error. The lifecycle then re-reads the history and plans again, up to 5 attempts with exponential backoff and jitter (5 ms base, 100 ms cap). The ledger raises its conflict as a plain `TypeError` and has no dedicated error class, so a `TypeError` is only treated as a conflict when the operation IDs in the history changed since it was read. An unrelated ledger error is returned on the first failure; a validation `TypeError` that coincides with an outside write costs at most the 5 attempts before it is returned. If the outside write raised no conflict (for example it added a signal the lifecycle was about to withdraw), nothing is detected and the outside write stays until the next lifecycle call. There is no cross-process lock. An application that runs several processes against one subject's ledger must route all of that subject's writes through one process or hold its own per-subject lock (a database advisory lock or a lease), and must not write onboarding-shaped events (`onboarding:v1:` source IDs) outside the lifecycle.
4. **Set-level events needing candidate IDs: fixed.** Set events exclude by source ID on refresh (see decision 4).

Gaps that remain by design or by scope:

- The profile transition moves the profile record and, when both sides pass a `candidateEventStore`, reported candidate events. It does not move the engine's event-history store or derived caches. Each has its own placement, owned by the application.
- A profile that holds `local_only` signals can be written to a user-owned store, the same as existing onboarding bootstrap with `storageTarget: "user_pod"`. The transition does not rewrite privacy boundaries.
- Deletion waits for an in-flight save only within one process and one store object (see the race note above).
- Event stores that do not implement compare-and-set, or that fail `checkRecommendationCandidateEventStoreCompareAndSet`, stay single-writer. There is no lease or lock across processes (see "Several processes and scheduled refresh").
- Verification outcomes are not cached, so a failed save followed by a retry verifies again (see "Retries" under evidence verification).
- No per-kind caps and no automatic periodic refresh. `refresh` runs only when the application calls it (see "Several processes and scheduled refresh").
- Set-level exclusions are bounded by `setExclusionRetentionMs` (365 days at most). A permanent "never show this set" is an application setting, passed as `excludeSourceIds`.

## Several processes and scheduled refresh

**Refresh is owned by the application.** The library never starts a timer, a job or a background loop. Nothing refreshes a plan or expires a hidden candidate until your code calls `lifecycle.refresh`. Pick the trigger that suits the app: when the user opens the onboarding screen, after `reportCandidateEvents`, or from your own scheduler (a cron job, a service worker alarm, a queue). Because stored events expire on read, a refresh that runs late still gives the right answer.

**The library cannot lock across processes by itself.** The per-subject queue lives in one process's memory. Two processes or devices only coordinate through whatever storage they share, so any cross-process guarantee has to come from that storage. The library offers one thing there: compare-and-set on the candidate event store, with a conformance check (see "Concurrent writers"). It protects the stored events. It does not stop two processes from both running `refresh` or `applySelection` for the same subject at the same time, which can double the work but does not corrupt the event record.

**Why there is no built-in lease.** A lease needs a shared record that holds an owner and an expiry, and a clock that every process trusts. The store interface has neither a place for an owner nor a shared clock, and a lease checked against local clocks can be wrong in both directions: two holders after clock skew, or a dead holder blocking everyone until the expiry. Compare-and-set already gives the safe part (no lost events) with the bounded retry described above, so adding a lease to the library would add risk without removing a case that matters for correctness.

**A recipe if you want one refresher per subject.** Use a store that has atomic conditional writes (a database row, an object store with `If-Match`, a Redis key with `SET NX PX`):

1. Before refreshing, try to create a lock record for the subject with a random owner ID and an expiry (`now + 2 * expected refresh time`), only if no unexpired record exists. If that fails, skip this run. The next trigger will try again.
2. Run `lifecycle.refresh`. Renew the lease if it takes longer than half the expiry.
3. Release by deleting the record only if it still carries your owner ID.
4. If the process crashes, nobody releases it. The expiry frees it, so a crashed holder blocks others for one lease length at most. Use the lock store's own clock for expiry (the database `now()`, the Redis TTL) rather than each process's clock.
5. When a lock attempt fails, wait with exponential backoff and jitter (for example 1s, 2s, 4s up to a cap, each scaled by a random factor between 0.5 and 1) before trying again, and give up after a handful of attempts.

Treat the lock as an efficiency measure only. Refresh stays safe without it, because every stored write is still guarded by compare-and-set when the store supports it.

## Evidence verification

Pass `evidenceVerifier: { verifier, timeoutMs? }` to `createRecommendationOnboardingLifecycle`. The verifier is `{ id, verify(evidence, { subjectId, kind, now, signal }) }`. `kind` is `lifecycle_event`, `starter_pack_consent` or `starter_pack_provenance`.

- **Where it runs.** `reportCandidateEvents` (and `refresh`, which reports) asks the verifier about each normalized event that is not already in the store, after the consent check, before anything is stored and before any cache is cleared. Events the store already holds are skipped, so a retry after the events were stored (for example when clearing the cache failed) does not re-verify them and a replay-detecting verifier does not reject it. `assessPlan` asks about the extra events passed in, each starter-pack member's consent binding, and the candidate's `curated_account_set` provenance. Events read back from the candidate event store are not checked again, because they were checked (or not) when they were reported. A plan that has no starter-pack members or curated-set provenance has nothing for the verifier to look at on that side.
- **Fail closed.** Accepting means returning exactly `{ verified: true }`. A `false` result, a throw, a rejected promise, a result that is not that shape, or no answer within `timeoutMs` (default 5 seconds, at most 30; the `signal` is aborted at that point, and also when another item in the same call fails, so a verifier that honors it stops promptly) throws `RecommendationEvidenceVerificationError` with `kind` and `failure` (`rejected`, `error`, `timeout`, `malformed`). The verifier's own error text is kept as `cause` and left out of the message.
- **Cost limits.** Items of one kind are checked up to `maxConcurrency` at a time (default 4, at most 16) and one call spends at most `totalTimeoutMs` on each kind (default 30 seconds, at most 120), on top of the per-item `timeoutMs`. Running out of time fails the call with a `timeout`, and after the first failure no new items start and the `signal` of every call still running is aborted. The subject's queue is held meanwhile, so the three kinds in one assessment can take up to three totals in the worst case. Keep batches small and verifiers quick.
- **Retries.** If verification passes and the save then fails, nothing was stored, so a retry verifies the same events again. A verifier that implements replay detection must therefore accept the identical evidence for the same subject a second time, and reject only evidence that conflicts with what it saw (a reused nonce on different content, for example). The library does not cache verification outcomes.
- **Labels.** Report results and plan assessments carry `evidenceVerification`, `verifiedKinds`, `storedEventsNotChecked` and, unless it is `unverified`, the `verifierId`. `verified` means a verifier accepted every item this call used and at least one was checked. `partial` means it accepted what it was asked about but the call also relied on stored events it did not check (`storedEventsNotChecked` says how many, including events a report skipped because they were already stored). `unverified` means nothing was checked, either because no verifier is configured or because there was nothing new to check. `verifiedKinds` lists which of `lifecycle_event`, `starter_pack_consent` and `starter_pack_provenance` were accepted, so a result with only `starter_pack_consent` says the extra events were not part of it. `evidenceVerification` gained the `partial` value, so a `switch` over it needs a new case. Verification can only reject, so the assessed state and `usable` are the same as the unverified path.
- **Subject binding and replay.** The context carries `subjectId`, so a verifier that signs over the subject refuses evidence issued for another subject. Replay detection (a nonce or event ID seen before) belongs in the verifier, because only it knows what its proof covers. The library does not keep a seen-ID window of its own: it would duplicate the event store, and a replayed event only repeats a fact that can already only make a plan less usable.
- **The event itself carries no proof field.** The verifier receives the normalized event, so it has to find its proof another way, for example by looking up the record the event was derived from. Carrying an attestation on the event would need a new optional field (see below).

### What is and is not verified today

Nothing in this repository verifies protocol proofs. No code checks an ATProto repository commit signature, a label signature, a DID document signing key, an ActivityPub HTTP signature or object proof, or a Solid/ActivityPods ACL. With no verifier configured, every result is labelled `unverified`, and a verifier you supply only checks what you give it. `docs/canonical-status.md` keeps HTTP signatures, credentials and transports outside the core on purpose.

The gap is that the engine receives normalized adapter output with no proof attached. By the time an event reaches the verifier, the commit, signature or response that vouched for it has been dropped or reduced to a string the library does not check. What each adapter keeps:

| Adapter | Proof or authority material kept | Dropped or unchecked |
| --- | --- | --- |
| `atproto-query-labels-client`, `atproto-subscribe-labels-client`, `atproto-labels` | The label `sig` is kept as a bounded string on the label signal (`signature`). The subscribe client re-encodes binary `sig` as base64. `ver` is kept. | The signature is never checked against the labeler key. The labeler evidence built by `labeler-signal-policy` has no signature field, so it is gone before the event reaches a plan. |
| `labeler-discovery` | The labeler DID, the `AtprotoLabeler` service endpoint and, if given, the `app.bsky.labeler.service` declaration. The `did_document` and `did_document_and_declaration` values describe which inputs were present and well formed. | The DID document and declaration are supplied by the caller. Nothing fetches or authenticates them, and the labeler signing key is not read. |
| `protocol-source-*` (ATProto records) | The repository DID, AT URI and `cid`. Authority and repository mismatches in the AT URI are rejected. | The repository commit and its signature are never seen. The `cid` is kept as an identifier and is not checked against the record. |
| `activitypub-public-outbox-source-adapter`, `mastodon-timeline-source-adapter` | The access basis (`public`, `oauth_scope`, `authenticated_api`) and origin checks. | HTTP signatures and object proofs. The transport is injected, so authenticated fetch is the host's job. |
| `activitypub-curated-account-sets` | Whether the read needed authentication, the origin, and a `same_provider` or `remote_provider` trust boundary. | Nothing per item. A Mastodon 4.6.0 Collection REST read has no per-item signature, so authenticity rests on the HTTPS origin and the authenticated fetch only. |
| `activitypods-*` | WebID and actor binding (WebID equals actor, same-origin inbox and outbox, public-key owner equals WebID), owner Pod authority checks, and resource authorization evidence. | The actor's public key is not used to verify anything, and ACL documents are not fetched or evaluated here. |
| `provider-discovery` | The one place authority is modelled: `provider_probe`, `protocol_native`, `authenticated_registration`, `explicit_integration`, as `applicationAuthority` and per-capability authority. | These describe where a claim came from. They do not carry evidence that a claim was checked. |

### Where authenticity belongs

Each protocol already has its own way to prove who said what, and the evidence verifier should lean on it instead of a second scheme:

- **ATProto.** Repository commits are signed by the account's DID signing key. Labels are signed by the labeler's key. Both are checked against the signing key in the DID document.
- **ActivityPub and Mastodon.** Authenticity is the HTTPS origin plus an authenticated fetch, and sometimes HTTP signatures or object proofs. A Mastodon 4.6.0 Collection REST read has no per-item signature.
- **Solid and ActivityPods.** The WebID identifies the owner, and the ACL decides who may read or write.

The intended shape is that an adapter verifies the protocol proof at fetch time, while it still holds the commit, signature or response. It then attaches an attestation to what it hands to the engine, recording how it was checked. The attestation should use the same authority ordering as `docs/recommendation-provider-discovery.md`, with `provider_probe` weakest and `explicit_integration` strongest. The evidence verifier then checks the attestation against the subject and kind, and applies replay rules. The attestation shape exists (see below), but no adapter issues one yet. Until they do, a verifier cannot tell protocol-verified data from data the adapter merely parsed.

Application-owned signatures are a narrow case. They make sense only for evidence the application creates itself, such as a consent receipt or an imported event it signs on its own device or server. For that, a detached Ed25519 signature over canonical JSON (for example RFC 8785) of `{ subjectId, eventId, kind, payload, issuedAt, expiresAt, nonce }`, checked against a key the application controls, is reasonable. It is not a way to vouch for provider evidence. The library ships no keys and issues none, and no maintainer or app owner is positioned to sign what a remote provider said.

Residual limit, exactly: the library checks that evidence is well formed, bounded, internally consistent and (with a verifier) accepted by application code, and it can check that an attestation matches the subject, sources, age and strength you require. It does not check protocol proofs, and it does not know whether anyone trustworthy produced the evidence.

### Attestation foundation (built) and what remains

`createRecommendationEvidenceAttestation` records that a check ran: the subject, the source ids it covered, the evidence kind, a short claim, the mechanism, an authority from the provider-discovery vocabulary, when it ran and which step ran it. The result is validated, frozen and bounded (ids 512 characters, claim 256, at most 32 sources). Strings with control characters or surrounding whitespace are rejected and not cleaned, because quietly changing an id would change what it is bound to.

`createRecommendationAttestationEvidenceVerifier` turns that into a verifier for the existing `evidenceVerifier` hook. It returns `{ verified: true }` only when the application's lookup finds an attestation that:

- was issued by `createRecommendationEvidenceAttestation` in this process (a literal, a JSON copy or a structured clone is refused, so data that merely looks like an attestation never counts),
- names the same subject and kind, and covers exactly the source ids taken from the evidence itself,
- has a `verifiedAt` that is not in the future and is no older than `maxAgeMs` (default 15 minutes, at most 7 days),
- has the required proof class (`origin` or `signature`) and at least the minimum authority.

Anything else, including a lookup that throws or hangs, is rejected by the hook's normal fail-closed rules. The mechanisms are `https_origin` and `authenticated_fetch` (proof class `origin`) and `protocol_signature` and `application_signature` (proof class `signature`). The class is derived from the mechanism and cannot be passed in. Origin mechanisms cannot claim more than `protocol_native` authority. A Mastodon Collection read over REST is therefore an `https_origin` or `authenticated_fetch` attestation, and a verifier configured with `requiredProof: "signature"` refuses it.

What this does not do: it verifies no signature. The issuing function is public, so whoever calls it is vouching that the check happened. It stops forged or copied data and mix-ups between subjects and sources. It does not make an unchecked claim true. No crypto or CBOR dependency was added.

Which adapter would issue which attestation, and what is left to build:

| Adapter | Attestation it could issue today | Needed for `signature` proof |
| --- | --- | --- |
| `activitypub-curated-account-sets` (Mastodon Collection REST) | `https_origin`, or `authenticated_fetch` when the read needed auth. Never `signature`. | Nothing. The protocol has no per-item signature here. |
| `activitypub-public-outbox-source-adapter`, `mastodon-timeline-source-adapter` | `https_origin` or `authenticated_fetch` from the access basis. | HTTP signature or object proof checking, which needs a key fetch and a signature verifier in the host. |
| `atproto-*-labels` | None yet. | Labels are DAG-CBOR encoded and signed with secp256k1 or P-256 keys. Checking one needs a CBOR encoder, the labeler key from the DID document and a key type Node's built-ins do not cover for secp256k1. This needs a dependency decision. |
| `protocol-source-*` (ATProto records) | None yet. | Repository commit verification needs CAR and CBOR parsing, MST proof checking and the DID signing key. Same dependency decision. |
| `activitypods-*` | None yet. | Fetching and evaluating ACLs and verifying with the actor key. |
| Application-owned receipts | `application_signature` once an app signs and checks its own receipts. | The Ed25519 over canonical JSON recipe above, which Node can do with `node:crypto`, but the key handling belongs to the application. |

Open decisions before protocol verification can be built: the attestation shape and where it travels (an optional field on the event type, or a side channel keyed by event ID), which adapters verify first (ATProto labels and commits are the most self-contained), how DID documents and signing keys are fetched and cached without making the core do network I/O, and how a failed or missing proof maps onto the existing fail-closed behavior.
