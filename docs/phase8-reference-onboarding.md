# Phase 8: reference onboarding integration

Phase 8 shows how an application wires the engine contracts that already exist into a first-run onboarding flow. It adds no engine behavior. This page is the design for that work. It records what the reference will be, what it will not be, and what the code does today, so the examples and the UX guidance have a fixed target.

Each section is tagged so you can tell what is real:

- **Code** means it exists in `src/` or `examples/` and I checked it there.
- **Guidance** means advice with no code behind it. The library will not enforce it.

Nothing in this page changes the public API, so `tests/fixtures/public-api-surface.json` stays as it is.

## What the reference is

A small set of TypeScript examples under `examples/`, plus tests that run them. The examples drive the real engine through the public entrypoint with in-memory stores, a fake clock and fake candidate sources. They are not a UI, not an app template and not a recommendation of any provider. The roadmap's non-goals still hold: no mandatory navigation framework, no bundled design system, no single required flow.

The flow the examples cover, in order:

1. Topic and tag selection from the global catalog, with the sensitive-topic opt-in.
2. Consent policy creation, then `applySelection` on the onboarding lifecycle.
3. First-session recommendations for accounts, feeds, lists, starter packs, labelers and topics.
4. An explanation for each recommendation, built from candidate provenance.
5. Action plan creation, then confirmation by the user.
6. Edit, remove and withdraw selections, and refresh after candidate facts change.
7. Moving the stored profile between the device and a user-owned pod.
8. Empty and partial source states.

## Decisions

### 1. Examples live in `examples/` and import only the public entrypoint

**Decision.** `examples/*.ts` import from `../src/index.js` and nothing else from the package. A test fails if an example imports any other path under `src/`.

**Why.** `src/index.ts` is the barrel that `package.json` exports as `.` (through `dist/src/index.js`). Importing it from source is the same surface a consumer gets, without needing a built `dist/` to exist before `tsc` runs. Importing the package by name would need `dist` to be present and current while it is being rebuilt, which breaks a clean build. A deep import would let an example lean on something that is not exported, so the example would stop proving the public contract. Existing tests already import `../src/index.js`, so this matches repo convention.

### 2. Examples are type-checked through `tsconfig.json` and run from `tests/`

**Decision.** Add `examples/**/*.ts` to the tsconfig `include` list. `pnpm lint:types` and `pnpm build` then check them under the same strict flags as `src/` (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). Each example exports functions, and a top-level `tests/phase8-reference-onboarding*.test.ts` imports and runs them. `pnpm test` only runs `dist/tests/*.test.js`, so an example that nothing in `tests/` calls would never execute. The test is what keeps an example from rotting.

**Consequence.** `rootDir` is `.`, so the build also emits `dist/examples/`. `.gitignore` covers `dist/`, and only a few older files in it are tracked, so the new compiled files are not committed. Nothing in the diff but source.

### 3. Examples stay out of the npm tarball

**Decision.** Add `"!dist/examples"` to the `files` list in `package.json`. The source folder `examples/` is already outside the list, so only the compiled copy needs excluding.

**Why.** `files` contains `"dist"`, which would otherwise pull `dist/examples/*.js` and `*.d.ts` into the package. Consumers do not need example code, and shipping it makes it look supported. I checked the mechanism in a scratch package with `npm pack --dry-run`, then again with `pnpm pack --dry-run`, which is what CI runs: `dist/src/*` is listed and `dist/examples/*` is not. `tests/phase8-reference-boundaries.test.ts` asserts both the `files` entry and the pack listing. Separately, `dist/tests/` already ships in the tarball today. That predates Phase 8 and is not changed here.

This doc ships (the package includes `docs`). The examples do not. The doc should be written so it makes sense without the example files next to it.

### 4. Reference stores are in-memory, and the device-store shape is guidance

**Decision.** The examples use in-memory implementations of two interfaces that exist today:

- `RecommendationProfilePersistenceAdapter`: `readProfileRecord(subjectKey)`, `writeProfileRecord(record)`, `deleteProfileRecord(subjectKey)`, plus a `storageManifest`.
- `RecommendationCandidateEventStore`: `manifest`, `load`, `save`, `delete`, and an optional `supportsCompareAndSet`.

Both are **Code**. The existing tests already build such adapters, for example `MemoryAdapter` in `tests/recommendation-profile-persistence-transition.test.ts`. A device-owned manifest uses `authority: "device_owned"` and `processingBoundary: "local_only"`. A pod manifest uses `authority: "user_owned"` and `processingBoundary: "server_allowed"`. Any other pairing is refused.

**IndexedDB and SQLite are guidance only.** The package has no runtime dependency for either, and Node has no IndexedDB. A real backend cannot be written, run or tested here without adding a dependency or a browser harness, and a fake would claim more than it proves. This doc describes the shape and the examples do not implement it:

- One object store or table keyed by the `subjectKey` string the engine hands to the adapter. Store the record as the engine gives it. Do not reshape it.
- `readProfileRecord` returns `null` when nothing is stored. The engine validates whatever comes back, so a damaged row is rejected, not trusted.
- `writeProfileRecord` should be atomic. In IndexedDB that is one `readwrite` transaction. In SQLite it is one `INSERT OR REPLACE` inside a transaction.
- `deleteProfileRecord` must really delete. Deletion is part of the consent contract.
- For the candidate event store, set `supportsCompareAndSet: true` only if `save` can check `expectedDigest` against the stored digest and throw `RecommendationCandidateEventConflictError` on a mismatch. Without that, two tabs or devices can overwrite each other's events, and the library says so in the interface docs.
- A browser store runs in the user's browser, so it is `device_owned`. Keep it out of any sync service the app operates itself.
- Set `encryptedAtRest` honestly. It is a declaration, and the library cannot check it.

### 5. User-pod placement is shown through the existing transition

**Decision.** The pod example calls `transitionRecommendationProfilePersistence` (**Code**, `src/recommendation/profile-persistence-transition.ts`) between two in-memory adapters, one with the device manifest and one with the pod manifest. It does not use the ActivityPods adapter, because that needs a live pod and an authorization setup the examples should not fake.

What the code does, and what the example shows:

- Order is read source, write destination (consent enforced and read-back verified), delete source last. A crash leaves at least one full copy and a rerun is safe.
- Moving to the pod needs `policy` with `serverSideDataUses`. Moving back to the device does not.
- The destination decides the label: `server_allowed` in the pod, `local_only` on the device. The example does not pass `privacyBoundary`, and a value that does not fit the destination is refused.
- If only the source delete fails, the call throws `source_cleanup_pending` and the same call finishes the job.
- Pass the same `storageTarget` when selecting and when persisting. The library does not compare them.

The example should show the failure path as well as the success path, since that is the part people get wrong.

### 6. The reference stays out of the confirmation step

The engine returns frozen, non-executable plans (`executable: false`, `requiresExplicitUserConfirmation: true`, and the three revalidation flags). The example's "execute" step is a stub that records the user's confirmation and calls a fake provider. It does not call a real follow or subscribe API. This is deliberate. The engine never follows, subscribes or joins on its own, and the reference must not suggest otherwise.

## What the code gives an application today

### First session (**Code**)

`createRecommendationFirstSessionOrchestrator` takes:

- `engine`: needs `readProfile`.
- `sources`: `RecommendationCandidateSourceAdapter[]`.
- `candidateKinds`: any of `account`, `post`, `feed`, `list`, `starter_pack`, `labeler`, `community`, `hashtag`, `topic`, `instance`.
- `evaluateEligibility`: the application's eligibility function. It is required, so the engine never decides eligibility on its own.
- optional `resolveFeatures`, `resolveExplanations`, `rerank` and concurrency and size limits.

`execute({ subjectId, requestId, languages?, limit?, minScore?, excludeCandidateIds?, excludeSourceIds?, signal? })` returns `recommendations`, each with `candidate`, `score`, `rank`, `components` and an optional `explanation`. It also returns `discoveredCandidateCount`, `eligibleCandidateCount`, `eligibilityFailureCount` and `sourceFailures`. Those four are what the empty and partial states below are built from.

An eligibility check that throws is counted in `eligibilityFailureCount` and the candidate is dropped. A source that fails is listed in `sourceFailures`. Neither fails the whole call.

### Explanations (**Code** for the inputs, **Guidance** for the wording)

The `explanation` on a recommendation is a `RecommendationExplanation` with a generic `summary` such as "Ranked using explicit local interests", a list of numeric components and a confidence. It does not name the topic the user chose or the pack the account came from.

The structured facts for a wording like the roadmap's examples are on `recommendation.candidate`:

- `candidate.provenance[]`: each entry has `kind` (for example `onboarding_interest_match`, `curated_account_set`, `starter_pack`, `labeler_discovery`, `featured_hashtag`), `sourceId`, `observedAt`, `trustBoundary`, and optionally `sourceItemId`, `curator` and `sourceUrl`.
- `candidate.metadata`: `displayName`, `summary`, `canonicalInterestIds`, `tags`, `languages`.
- the candidate's verification state: `unverified_hint`, `source_asserted`, `authority_verified` or `canonical`.

The application turns those into a sentence and localizes it. The library does not generate user-facing text, which matches the roadmap ("applications remain responsible for final wording and localization"). The reference has a small `explainRecommendation(recommendation, selection, catalog)` function (`examples/view-models.ts`) that maps provenance and the user's picks to a copy key, and keeps the copy in a plain table so it is easy to replace.

### Lifecycle (**Code**)

`createRecommendationOnboardingLifecycle({ derived, engine, firstSession?, now?, subjectLock?, evidenceVerifier?, candidateEvents? })` returns the extended lifecycle with:

| Method | What it does |
| --- | --- |
| `applySelection` | Makes live onboarding signals match the given selection. Removed items are retracted, edited ones replaced, unchanged ones are not rewritten, so repeating a call changes nothing. |
| `withdrawSelections` | Retracts every live onboarding signal. `consent_revoked` also clears stored candidate events. |
| `reportCandidateEvents` | Records changed candidate facts and clears candidate and explanation caches. |
| `listReportedCandidateEvents` | Lists stored events that have not expired. Needs a candidate event store. |
| `assessPlan` | Returns `valid`, `stale` or `invalid` for a frozen plan, with reasons. Always `executable: false` and `requiresRevalidation: true`. Needs a candidate event store. |
| `refresh` | Settles pending invalidation, reports any new events, then reruns the first session without withdrawn candidates and sets. |

`applySelection` rejects an input that carries a `profileStore`. Full deletion stays `derived.deleteSubject`, and the lifecycle does not watch consent for you, so the application calls `withdrawSelections` when consent changes.

### Action plans (**Code**)

`createRecommendationCandidateActionPlan({ candidate, eligibility, provider, createdAt, ... })` returns a frozen plan with one of eight actions: `follow_account`, `subscribe_feed`, `subscribe_list`, `expand_starter_pack`, `subscribe_labeler`, `follow_community`, `follow_hashtag`, `open_instance_signup`. A starter pack plan carries per-member bindings, each with accepted consent, and a cap of `maxStarterPackMembers`. Curated account sets are capped at 150 members (`MAX_RECOMMENDATION_CURATED_ACCOUNT_SET_MEMBERS`).

## Compatibility matrix

This is what the engine and its shipped adapters can say about each source family. It is not a claim that any provider supports the action. Provider capability comes from `RecommendationProviderDescriptor.capabilities` (`supported`, `unsupported`, `unknown`), and the engine does not infer it from the protocol name. `unknown` is treated as not supported.

Evidence is `unverified` unless the application plugs in an `evidenceVerifier`. `minimumAttestation` is opt-in. The only protocol proof the library checks is the ATProto label signature, through `createRecommendationAtprotoLabelAttestation`. Attestation mechanisms `https_origin` and `authenticated_fetch` establish where data came from and nothing more, and `protocol_signature` and `application_signature` are issued by the caller, who is the one vouching that a check ran.

| Source family | What ships (**Code**) | Candidate kinds it can feed | Strongest evidence the library can check | Notes |
| --- | --- | --- | --- | --- |
| Mastodon Collections, Loops starter kits, Pixelfed starter kits | REST clients: `createRecommendationMastodonCollectionClient`, `createRecommendationLoopsStarterKitClient`, `createRecommendationPixelfedStarterKitClient`, and a curated-set candidate source adapter | `account`, `starter_pack` | Origin attestation only (`https_origin`) | A Collection is a curated set of accounts, not a feed or a list. A REST read says the origin served it. It does not prove the curator or the members agreed. Member consent state is `accepted`, `pending`, `rejected`, `revoked` or `unknown`, and only `accepted` can go into a plan. |
| Mastodon timelines | `createRecommendationMastodonTimelineSourceAdapter` for `public`, `home` and `list` timelines | Feeds interest signals, not a candidate list | Origin attestation only | The adapter reads `public`, `home` and `list` timelines. Authorization for the user's own timelines is supplied by the application. |
| Generic ActivityPub | Provider record adapter, public outbox adapter | Not mapped here | Origin attestation only | These read provider records and public outboxes. No HTTP signature verification exists in the library. |
| ActivityPods / Solid | Live outbox reader, resource authorization, profile persistence adapter | profile placement and own-pod signals | Declared ACL evidence, not verified by the library | The profile adapter is the user-owned storage path. The examples do not use it. |
| ATProto labelers | Label query and subscribe clients, label signature verification, attestation | `labeler` discovery, label-based safety | **Signature verified** for labels | The only signature the library checks. The caller supplies the DID document and decides how fresh it must be. A signed negation is refused as an attestation. |
| ATProto feeds, lists, starter packs, repo records | Provider record adapter for ATProto records | `feed`, `list`, `starter_pack`, `account` | None | No repo or MST proof is checked. A record read is an assertion by whoever served it. |
| ATProto private spaces | Not shipped | none | none | See the privacy model. The library has no spaces adapter and cannot check what one writes. |
| Local catalog and onboarding matches | Global catalog, onboarding seed | `topic`, `hashtag`, `account` | Not applicable | Provenance kind `onboarding_interest_match` or `local_catalog`. |
| Third-party directories | Hint-level provenance | any | None | Provenance `third_party_directory_hint` keeps third-party trust and is never promoted. |

Where the table says the library ships a client or adapter, the Phase 8 examples will not call it against a live service. They use fake `RecommendationCandidateSourceAdapter` implementations that return fixed candidates.

## Storage placement summary (**Code**)

| Data | Device (`device_owned`, `local_only`) | User pod (`user_owned`, `server_allowed`) | Provider-owned or shared-operator | Public ATProto repo |
| --- | --- | --- | --- | --- |
| Interest profile and signals | Yes, the default | Yes, with the user's server-side consent | Never | Never |
| Candidate events | Yes | Yes | Never | Never |

A private ATProto space on the user's own PDS counts as user-owned, but no adapter ships and it gives access control, not confidentiality. The privacy model has the details. The library cannot verify a manifest's `publiclyReadable` declaration, so an adapter author has to get it right.

## UX guidance and copy (**Guidance**)

None of this is enforced by the library, and none of the wording ships in `src/`. The strings are examples for the reference to carry and for adopters to replace.

### Consent

Ask before the first write, in plain terms, and make the default the safe one.

- Default placement is this device. Say so: "Your interests stay on this device."
- Offer the pod as an explicit choice for people who have one: "Keep your interests in your own pod so they follow you between devices. Only you and the apps you allow can read them."
- Do not describe a pod as private from the pod host. The library cannot check that.
- Sensitive topics are off by default and need their own opt-in. Do not pre-tick them, and do not hide the choice inside a general "accept" button.
- Offer a "Skip" that leaves no signals behind. Skipping is a valid outcome, and the empty state below covers it.
- Never let selecting a topic imply following a hashtag. The reference passes `allowAutoFollowHashtags: false`.

### Showing recommendations and the reason

- Show the reason next to each item, not behind a link. Example copy: "Suggested because you picked Basketball, and this account is in a Basketball starter pack."
- Build the sentence from `candidate.provenance` and the user's own selection. If you cannot name a reason from those, say less: "Matches your interest in Open source." Do not invent a reason.
- Name the curator when `provenance.curator` is set: "Collected by @name". Do not imply the curator endorsed this person unless the member's consent state is `accepted`.
- Keep the generic engine `summary` out of the main line. It says nothing about the user's choices.

### Unverified evidence

Evidence is `unverified` by default, and the interface should not hide that.

- Do not show a badge, check mark or "verified" label unless a verifier ran and the result says so. `verified` in the UI should mean what the verifier result means and nothing wider.
- For the default case, wording like "From the account's own server" is accurate for an origin read. "Verified" is not.
- Label-signature checks are real. If you show one, say what was checked: "Signed by this labeler".
- Show the age of the evidence when it matters. Eligibility evidence older than a day makes a plan stale by default.

### Confirming an action

An action plan is a proposal. The user's confirmation is a separate step.

- Show exactly what will happen, per item: "Follow @name", "Add this feed to your home", "Follow these 12 accounts".
- For a starter pack, list the members and let the user untick some before confirming. Only members with accepted consent appear in the plan. Say so if some members were left out: "3 people in this pack asked not to be suggested, so they are not shown."
- Run `assessPlan` and the application's own revalidation right before the call, not when the screen opens. A plan that is `stale` or `invalid` must not be confirmed. Offer a refresh.
- Never run the action on a timer, on a swipe past the card, or on screen load.
- Report what happened afterwards, including a partial result: "Followed 9 of 12. 3 could not be followed."

### Editing, removing and withdrawing

- Let people change their picks at any time. Call `applySelection` with the full new selection. Repeating the same selection is harmless.
- Say what removal does: "Removing Basketball stops new suggestions based on it."
- Provide "Clear my interests" (`withdrawSelections` with `source_retracted`) and, separately, "I no longer agree to personalization" (`consent_revoked`). The second one also clears stored candidate events.
- Provide a deletion path that calls `deleteSubject`, and say what it removes: the profile and everything derived from it, on this device and in the pod if one is in use.
- Offer "Don't suggest this again" and "Don't suggest this pack" on each card. These map to candidate and set-level events passed to `reportCandidateEvents`, which the lifecycle then keeps out of later results.
- After a withdrawal, show the empty state, not an error.

### Refresh

- Rerun on user request ("Find more") and when the app has new facts to report. Do not poll.
- If a refresh drops items, say so briefly: "Some suggestions were removed because they changed."
- `refresh` throws if pending invalidation cannot be finished, rather than serving stale results. Show a retry, and keep what is on screen marked as possibly out of date.

### Empty and partial states

Build these from the first-session counts.

| Situation | Signal in the result | Suggested copy |
| --- | --- | --- |
| No picks yet | no signals, `profileSignalCount` is 0 | "Pick a few topics to get suggestions." |
| Nothing found | `discoveredCandidateCount` is 0 and `sourceFailures` is empty | "We couldn't find suggestions for these topics yet. Try another topic." |
| Found but none eligible | `discoveredCandidateCount > 0`, `eligibleCandidateCount` is 0 | "We found some, but none are available to suggest right now." |
| Some sources failed | `sourceFailures` not empty, some recommendations | "Some sources didn't respond, so this list may be short. Try again later." |
| All sources failed | `sourceFailures` not empty, no recommendations | "We couldn't reach any source. Your picks are saved." |
| Some eligibility checks failed | `eligibilityFailureCount > 0` | Same as partial. Do not name the count to the user. |

Do not show a spinner for ever. Give a timeout and a retry. The first-session call accepts an `AbortSignal` for this.

## Accessibility guidance (**Guidance**)

The reference has no UI, so this is advice for adopters, not something the examples check.

- Every selectable topic is a real control with a visible text label, a checked state exposed to assistive technology, and a hit area large enough for touch. Do not rely on color alone for selected state.
- Group topics with a labelled group (for example a `fieldset` with a `legend`) and announce the selection count when it changes.
- The reason text is part of the card's accessible name or description, so a screen reader reads it with the item. It must not live only in a tooltip or hover.
- Confirmation is a focus-managed step. Move focus to the confirmation dialog, trap it while open, return it to the trigger on close, and make Escape cancel.
- Report results (follow succeeded, partly failed, plan went stale) in a polite live region. Do not rely on a toast that disappears.
- Respect reduced motion. Do not animate cards in a way that hides the reason text or the confirm button.
- Keep contrast at WCAG AA or better for reason text, the unverified note and error messages.
- Write short sentences, avoid jargon such as "attestation", "provenance" and "boundary" in user copy, and make every message localizable. Do not build sentences by concatenating fragments, since word order differs between languages.
- Test with keyboard only and with at least one screen reader before shipping an adaptation of this flow.

## Acceptance criteria for the implementation

1. `examples/` exists with an end-to-end onboarding example and the pod transition example, plus the stores and fake sources they need.
2. Examples import only `../src/index.js`. A test enforces it.
3. `tsconfig.json` includes `examples/**/*.ts`, and `pnpm lint:types` and `pnpm build` pass.
4. `tests/phase8-reference-onboarding*.test.ts` runs every exported example function. It covers at least: select, first session with explanations from provenance, plan, confirm stub, edit, remove, withdraw, refresh after a set-level event, device to pod and back, a failed destination write, a failed source delete followed by a successful rerun, and each empty and partial state in the table above.
5. The tests assert the privacy facts, not just success: a pod write without server-side consent is refused, a `local_only` label for a pod destination is refused, and a provider-owned manifest is refused.
6. `"!dist/examples"` is in `package.json` `files`, and `pnpm pack --dry-run` output has no `dist/examples` entry. The test or a script checks it.
7. No new runtime dependency. No change to `src/index.ts` exports or to `tests/fixtures/public-api-surface.json`.
8. Examples never contact the network, and never call a real provider.
9. `CHANGELOG.md` gets an entry under `## Unreleased`, and `docs/current-roadmap-status.md` and `docs/canonical-status.md` are updated to say what landed.

## Out of scope

- Real provider adapters or live calls to Mastodon, Pixelfed, Loops, Bluesky or ActivityPods servers from the examples.
- Real device persistence backends (IndexedDB, SQLite, OPFS, file storage). Guidance only.
- ATProto spaces adapters, including any private-space store.
- ATProto repo or MST proof checking.
- HTTP signature verification for ActivityPub.
- A UI framework, components, styling or a design system.
- Executing actions. The engine never auto-follows, subscribes or joins, and the example's confirm step is a stub.
- Changes to the engine, the public API, consent semantics or the placement policy.
- Shipping the examples to npm users.

## Known gaps and risks

- The explanation object does not carry the user's selected topic by name. The reference joins it from the selection record itself. If that proves clumsy, a richer explanation type would be a separate engine change and is not part of this phase.
- `pnpm pack` and `npm pack` could treat the `files` negation differently. Both were checked, and a test runs `pnpm pack --dry-run` where `pnpm` is available.
- The IndexedDB and SQLite notes are untested guidance. An adopter who follows them still has to test their own store, particularly compare-and-set and delete.

## What was built, and what it showed about the public API

The code is in `examples/` (`fakes.ts`, `view-models.ts`, `onboarding-flow.ts`, `device-to-pod.ts`, plus a README) and is run by `tests/phase8-reference-*.test.ts`. It needed no new export and no change to `tests/fixtures/public-api-surface.json`. Nothing blocked the work. These are the places where the public API was awkward, in the order an integrator would hit them. None is fixed here, because the briefing for this phase was to leave the engine alone.

1. **Selection targets and transition targets are different lists.** `createRecommendationOnboardingSelection` takes `local_app`, `activitypods_pod`, `solid_pod` and others. `transitionRecommendationProfilePersistence` takes `local_app` and `user_pod`. An app has to map between them (`markMoved` in the reference does it by hand). Option: accept `user_pod` as an alias on the selection side, or export one mapping helper.
2. **The engine's profile store refuses `server_allowed` labels unless it was created to allow them.** `createInMemoryRecommendationProfileSignalReplacementStore()` defaults to `local_only` only, so the first edit after a move to a pod fails with "privacy boundary is not allowed". The reference creates the store with both labels. Consent still decides whether a server label may be written. Option: say so in the lifecycle docs, or derive the allowed labels from the selection's target.
3. **A curated-set source cannot return confirmed candidates.** Its authority is `curated_public`, which only allows `source_asserted`, and eligibility requires `authority_verified` for packs. The reference wraps the source and re-declares it as `provider_native` after the app's own decision that the provider confirmed the collection. That works, but it moves a trust decision into glue code that the library cannot check. Option: a documented helper for "this app vouches for these candidates".

   **Do not copy this wrapper unless you have the same safeguards.** Calling the curated source `provider_native` and stamping its candidates `authority_verified` is the app vouching for them. Nothing in the library checks that claim. In the reference it is acceptable only because every account is still resolved through the provider's resolver at plan time and again at confirm time, so an account that has gone away is refused. In an app with no such resolver check, the same wrapper would let unverified candidates through as verified.
4. **Account eligibility treats `identityBindingVerified` as a caller-supplied boolean.** Together with the resolver lookup it makes an account eligible even when the candidate itself is only `source_asserted`. Only packs and labelers need `authority_verified` on the candidate. The evidence display therefore has to look at the candidate, not at the eligibility result, to avoid showing a badge that was never earned.
5. **The transition reads the destination before it checks consent**, so a refused move to a pod still makes one read request to it. Nothing is written, sent or deleted. Also, a revoked policy passed for a move back to the device is refused. The reference passes `null` for that direction.
6. **A `remote` candidate source must declare `serverSideProcessing: true`.** That is correct for the privacy model, but the name reads as if the source processes the user's data. The engine does redact the query it sends to a remote source: no interests, no languages, and a hashed request ID. The privacy test asserts this.
7. **The generic explanation is unchanged** (see the first item under "Known gaps and risks"). Reasons come from provenance and the user's picks, and the engine's `summary` is not shown.

Two other results are worth knowing:

- The plan assessment already reports `capability_expired`, so a plan whose provider window ran out is `stale` before the reference's own revalidation sees it. The reference still asks the provider descriptor again on confirm, because a provider can drop a capability inside the window.
- A failed provider mutation is not retried by the reference. A follow is usually idempotent, but the user should choose whether to try again, and a partial result needs to be shown as one.


## Confirming a plan twice

`confirm` in the reference keeps track of plans it has already carried out (or is carrying out) and refuses a second call with `already_confirmed`, so a double tap sends one request. If an attempt fails for any reason, the plan is released and the user can confirm it again. This only protects one running instance. A real app that can restart, or run on two devices, should also rely on the provider treating a repeated follow or subscribe as a no-op.
