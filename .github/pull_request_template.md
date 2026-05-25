## Summary
- What changed and why

## Risk and Threat Model
- Boundary assumptions
- Potential adversarial inputs considered
- Why this change is safe

## Adapter Hardening Checklist
- [ ] Contract-first: change aligns with existing neutral interfaces or explicitly justifies extension
- [ ] Input validation/sanitation: all external fields are validated and normalized
- [ ] Error handling: permanent vs transient failures are classified correctly
- [ ] Retry/backoff: bounded exponential backoff with jitter, cancellation support, and no unbounded loops
- [ ] Privacy/consent: no bypass of consent/trust-boundary checks; no privacy-unsafe logging
- [ ] Self-healing: fallback/circuit behavior is explicit and observable where applicable
- [ ] Anti-duplication: no duplicate logic introduced; shared helpers reused

## Test Plan
- [ ] Added behavior-focused tests for new logic (not only pass/fail smoke tests)
- [ ] Added regression tests for fixed bugs/edge cases
- [ ] Verified side effects (retries, events, fallback transitions) where applicable
- [ ] Ran local checks:
  - [ ] npm run lint:types
  - [ ] npm run build
  - [ ] npm test

## Notes for Reviewers
- Areas that need close review
- Backward-compatibility considerations
