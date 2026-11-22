# Phase 6 review checklist

Each item points at the code that enforces it and the test that covers it. Source is `src/recommendation/candidate-action-plan.ts`; tests are in `tests/recommendation-candidate-action-plan*.test.ts`.

- [x] Reuses normalized candidate and eligibility contracts; no parallel candidate model. The input is a `RecommendationCandidate` plus a `RecommendationCandidateEligibilityResult`, and both go through `normalizeRecommendationCandidate`.
- [x] Plans are descriptions only (`executable: false`). Asserted in the action-mapping test.
- [x] Explicit user confirmation is mandatory (`requiresExplicitUserConfirmation: true`). Asserted in the action-mapping test.
- [x] Identity, eligibility, and provider capability must be revalidated immediately before application mutation (`requiresIdentityRevalidation`, `requiresEligibilityRevalidation`, `requiresCapabilityRevalidation`). The plan only carries these flags; enforcement is the application's job.
- [x] Exact candidate snapshot is bound, including metadata and provenance (`sameCandidateSnapshot`). Covered by the snapshot test and `-metadata.test.ts`. Provenance fields are compared in code but have no dedicated test.
- [x] Contradictory eligibility evidence fails closed. Only `reasonCodes` equal to exactly `["eligible"]` passes. Covered by `-reason-codes.test.ts` and the empty-reasons case.
- [x] Plan and eligibility timestamps use strict RFC 3339 validation and ordering. Covered by `-validation.test.ts` and the "newer than the action plan" test.
- [x] Provider capability gate: matching provider ID, fresh evidence window, verified protocol binding, and `supported` capability for the candidate kind (instance needs only the verified binding). Covered by the "fresh matching verified provider capability evidence" test.
- [x] Starter-pack expansion is capped (default 100, maximum 1,000) and the cap is rejected for other kinds. This is a cap only; the plan does not list or vet members.
- [x] Post/topic mutations are unsupported rather than guessed.
- [x] Existing onboarding hashtag-plan API is retained (`createRecommendationHashtagFollowPlan` in `src/recommendation/catalog.ts`, still covered by `tests/recommendation-catalog.test.ts`).
- [x] No credentials, OAuth tokens, private moderation state, or personalization state are added to plans. The plan type has no such fields, but no test asserts this.
- [x] Regression tests cover action mapping, unsupported kinds, ineligibility, snapshot mismatch, metadata mismatch, contradictory reasons, timestamp validation and order, malformed candidates, provider capability evidence, and starter-pack bounds.

Open follow-up: the safety amendments ask starter-pack action plans to bind each included member to the resolved account identity from its eligibility result. The Phase 6 plan has no member list, so that stays an application responsibility until a later phase adds it.

CI must pass before merge.
