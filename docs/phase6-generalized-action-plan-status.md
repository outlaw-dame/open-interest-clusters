# Phase 6 generalized action-plan status

Phase 6 implements candidate-bound, protocol-neutral, non-executable recommendation action plans.

Implemented:

- account follow plans;
- feed/list/labeler subscription plans;
- community follow plans;
- hashtag follow plans;
- bounded starter-pack expansion plans;
- eligible-instance signup navigation plans;
- exact normalized candidate-snapshot binding, including metadata and provenance;
- explicit eligible-only evidence validation;
- eligibility/plan timestamp ordering;
- mandatory explicit user confirmation;
- mandatory identity and eligibility revalidation before application-side mutation;
- no provider mutation or credential handling in the engine;
- unsupported post/topic actions fail closed;
- public package export and regression coverage.

The older onboarding `RecommendationHashtagFollowPlan` remains supported and is not silently redefined. The generalized contract is for normalized recommendation candidates after eligibility evaluation.

Phase 7 follows this work and is responsible for lifecycle/refresh behavior: deterministic reruns, edited/removed onboarding selections, source disappearance, moved/deleted identities, verification loss, candidate/action-plan invalidation, consent revocation/deletion propagation, and persistence-location transitions using the existing ledger and invalidation architecture.
