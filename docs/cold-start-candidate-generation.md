# Cold-start candidate generation

This document describes the Phase 2 implementation from `candidate-cold-start-onboarding-roadmap.md`.

## Purpose

Cold-start generation bridges an existing consented recommendation profile to the normalized candidate domain before behavioral history or bandit learning exists.

```text
consented profile
  -> bounded candidate-source fan-out
  -> source-level candidate validation
  -> local profile/candidate matching
  -> duplicate collapse + provenance merge
  -> bounded cold-start candidate features
  -> Phase 3 eligibility/policy
  -> later scoring-input construction
```

It is intentionally not a final ranking algorithm and does not execute protocol actions.

## Privacy boundary

Profile-derived matching remains local or in explicitly user-controlled storage.

Remote candidate-source adapters continue to use the Phase 1 redacted query boundary:

- no raw profile;
- no subject/account identifier;
- no blocks, mutes, domain blocks, keyword filters, or moderation preferences;
- no canonical-interest IDs;
- no language preferences;
- no arbitrary unknown context.

Local adapters may receive the bounded canonical-interest and language fields declared by the candidate-source contract. Candidate matching is still performed after source reads so public candidates can be compared against local profile evidence without disclosing that evidence to remote providers.

## Positive affinity evidence

The generic Phase 2 matcher admits only positive profile entries with at least one positive signal. It currently maps profile targets to public candidate metadata as follows:

| Profile target | Candidate metadata |
| --- | --- |
| `canonical_interest` | `canonicalInterestIds` |
| `hashtag` | `tags` |
| `keyword` | `tags` |
| `entity` | `entityIds` |

`moderation_label` is never treated as positive affinity evidence. Negative or zero-score entries are also excluded. `domain`, `creator`, and `collection` targets are not guessed into unrelated metadata fields; later candidate-type-specific matching can add explicit semantics where justified.

Language compatibility is emitted as a feature (`not_requested`, `unknown`, `compatible`, or `incompatible`) rather than being mistaken for user affinity.

## Source fan-out

Cold-start generation:

- accepts at most 64 source adapters per request;
- limits source concurrency;
- caps each source read and final output;
- validates every adapter through the Phase 1 source contract;
- avoids sending an abort signal to adapters that did not declare abort support;
- stops scheduling new work when cancellation is observed;
- waits for already-started non-cancellable reads before returning cancellation;
- isolates ordinary source failures so one unavailable provider does not erase healthy results.

Public failure results contain only the source ID and a bounded reason code. Provider exception messages are not surfaced.

## Duplicate collapse and trust

Candidates discovered from several sources are grouped by canonical `candidateId`.

Merging:

- requires the identity tuple to remain identical;
- retains bounded multi-source provenance;
- unions bounded public metadata;
- uses the strongest verification state that was already valid at an individual source boundary;
- does not allow an untrusted source to create authoritative verification;
- uses current observation timestamps deterministically;
- bounds merged provenance and metadata to the candidate-domain limits.

A lone third-party hint therefore remains `unverified_hint`. It can become authority-verified only when another candidate source independently returns the same canonical identity with verification permitted by that source's authority/capability contract.

## Existing curated Fediverse bridge

`createRecommendationCuratedAccountSetCandidateSourceAdapter` connects the existing Mastodon Collection / Loops starter-kit / Pixelfed starter-kit model to Phase 2 without duplicating those clients.

The bridge:

- reads already-normalized curated account sets locally;
- admits only discoverable, non-sensitive sets;
- admits only `accepted` members with an HTTPS actor URI;
- represents membership as `source_asserted`, not authoritative identity verification;
- preserves curator/set provenance;
- uses public set hashtags as candidate tags;
- collapses duplicate members from several sets while preserving bounded provenance;
- also emits the set itself as one `starter_pack` candidate (see below).

Members without a canonical actor URI remain outside the candidate domain rather than creating unstable handle-based candidate identities.

### Curated sets as starter-pack candidates

A qualifying set (discoverable, not sensitive, with 1 to 150 accepted members that have an actor URI) also becomes one `starter_pack` candidate. It reuses the existing starter-pack candidate and the existing `starter_packs` provider capability. No separate capability was added for curated sets.

- Identity: protocol `activitypub`, `nativeId` and `uri` are the set URL, `provider` is the set URL's host.
- Provenance: one `curated_account_set` entry with the hashed provider and set ID as `sourceId`, the set ID as `sourceItemId`, the curator, the set URL, and the set's trust boundary.
- Verification: always `source_asserted`. Eligibility refuses a starter pack until the app has verified it with the hosting provider (`identity_verification_required`), and the source never does that itself.
- Metadata: name, description, and hashtags. The member list is not copied. Accepted members are still emitted as separate account candidates, which is what the plan's `starterPackMembers` binds to.
- Sets with no accepted member, or more than 150, produce no pack. A set URL or set ID that is malformed throws instead of being skipped, the same as a malformed member URI does.
- `membershipComplete: false` does not block a pack. The plan binds an explicit member list, so a partial read only means fewer members.
- The adapter now declares `account` and `starter_pack` and returns only the kinds a query asks for. Callers that asked for `["account"]` see no change. A caller that passes both kinds will see packs and their members in one result.

The same account candidates and pack come from one read, so there is no duplicate identity: they have different kinds and different candidate IDs.

Mastodon tailors a Collection per viewer. Blocked items are left out by the server and `pending` items are only visible to the owner, so the same set can read differently for different viewers. A set read is a snapshot for the viewer who read it and should not be shared across viewers. Mastodon's create limits (name 40, description 100) are not enforced when reading, because other servers and the adapter accept longer text. The 150-item cap is.

A curated set is discovery provenance. It does not mean the viewer endorses it, and a set from a third party stays an unverified hint until the hosting provider verifies it.

#### Why `starter_packs` is reused

A provider capability says what a user can do on that provider (follow a curated bundle of accounts), not which product offers it. The repo already treats `mastodon_collection`, `loops_starter_kit` and `pixelfed_starter_kit` as one curated-account-set type, so one capability and one plan type cover them. The cost is that the capability alone cannot tell a Bluesky starter pack from a Mastodon Collection. An app that needs the difference should read the candidate: `curated_account_set` provenance (with its set ID) and an `activitypub` protocol identify a curated set, while ATProto starter packs come from other sources. A provider that does not report `starter_packs` as `supported` cannot get a plan for one of these candidates.

## Deliberate non-goals

Phase 2 does not:

- run the Phase 3 account/type-specific eligibility gates;
- turn blocks, mutes, filters, moderation labels, or other private safety state into positive affinity;
- auto-follow accounts or starter-pack members;
- subscribe to labelers, feeds, lists, or communities;
- treat third-party ATProto directories as protocol authorities;
- duplicate live provider clients merely to populate the new interface;
- change the existing hybrid scorer or execution orchestrator.

ATProto feeds/lists/starter packs/labelers and additional ActivityPub discovery sources plug into the same candidate-source contract. Third-party directory entries remain unverified hints until protocol-native verification, as documented in `atproto-third-party-discovery-sources.md`.

## Phase boundary

Phase 2 output is a bounded set of `{ candidate, match }` records. `match` contains deterministic local features sufficient for Phase 3 eligibility and later scoring-input construction:

- matched canonical interests;
- matched tags;
- matched entities;
- matched positive profile targets and weights;
- language compatibility.

The next dependency-ordered phase is **Phase 3 — Candidate eligibility and policy composition**. It must reuse the existing account eligibility and viewer-safety machinery rather than fork it.