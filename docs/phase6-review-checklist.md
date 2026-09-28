# Phase 6 review checklist

- [x] Reuses normalized candidate and eligibility contracts; no parallel candidate model.
- [x] Plans are descriptions only (`executable: false`).
- [x] Explicit user confirmation is mandatory.
- [x] Identity and eligibility must be revalidated immediately before application mutation.
- [x] Exact candidate snapshot is bound, including metadata and provenance.
- [x] Contradictory eligibility evidence fails closed.
- [x] Plan and eligibility timestamps use strict RFC 3339 validation and ordering.
- [x] Starter-pack expansion is bounded.
- [x] Post/topic mutations are unsupported rather than guessed.
- [x] Existing onboarding hashtag-plan API is retained.
- [x] No credentials, OAuth tokens, private moderation state, or personalization state are added to plans.
- [x] Regression tests cover action mapping, unsupported kinds, ineligibility, snapshot mismatch, metadata mismatch, contradictory reasons, timestamp validation/order, malformed candidates, and starter-pack bounds.

CI must pass before merge.
