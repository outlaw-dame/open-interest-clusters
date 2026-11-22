# Phase 6 generalized action-plan status

Phase 6 implements candidate-bound, protocol-neutral, non-executable recommendation action plans.

Implemented:

- account follow plans;
- feed/list/labeler subscription plans;
- community follow plans;
- hashtag follow plans;
- bounded starter-pack expansion plans that bind each member to the resolved account identity from its eligibility result and to accepted curated-set membership consent (caller-supplied, with no proof verified, so checked for consistency only; revocation after plan creation is reported as a lifecycle event and `assessRecommendationCandidateActionPlan` marks the plan invalid, see Phase 7);
- curated account sets (Mastodon Collections and similar) as `starter_pack` candidates that reuse the `starter_packs` capability;
- eligible-instance signup navigation plans;
- exact normalized candidate-snapshot binding, including metadata and provenance;
- explicit eligible-only evidence validation;
- eligibility/plan timestamp ordering;
- mandatory explicit user confirmation;
- mandatory identity, eligibility, and provider-capability revalidation before application-side mutation;
- provider capability gating: fresh descriptor for the candidate's provider, verified protocol binding, and `supported` state for the matching capability (instance plans need only the verified binding);
- no provider mutation or credential handling in the engine;
- unsupported post/topic actions fail closed;
- public package export and regression coverage.

The older onboarding `RecommendationHashtagFollowPlan` remains supported and is not silently redefined. The generalized contract is for normalized recommendation candidates after eligibility evaluation.

Phase 7 followed this work and is documented in [`phase7-onboarding-lifecycle.md`](phase7-onboarding-lifecycle.md). Its scope was lifecycle/refresh behavior: deterministic reruns, edited/removed onboarding selections, source disappearance, moved/deleted identities, verification loss, candidate/action-plan invalidation, consent revocation/deletion propagation, and persistence-location transitions using the existing ledger and invalidation architecture.
