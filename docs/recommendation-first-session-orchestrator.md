# First-session recommendation orchestrator

Phase 5 adds `createRecommendationFirstSessionOrchestrator` (`src/recommendation/first-session-orchestrator.ts`, exported from the package root). It composes pieces that already existed. It does not add a scorer, a candidate model, or a second execution path.

```text
engine.readProfile(subjectId)
  -> generateRecommendationColdStartCandidates   (Phase 2)
  -> evaluateEligibility, once per candidate     (injected, Phase 3 evaluators plug in here)
  -> buildColdStartScoringInput                  (Phase 4)
  -> createRecommendationExecutionOrchestrator   (existing scoring, rerank, explanations, serving)
  -> candidate-bound recommendations
```

## What the caller provides

`createRecommendationFirstSessionOrchestrator(options)` takes:

| Option | Purpose |
| --- | --- |
| `engine` | Anything with `readProfile(subjectId)`. The orchestrator reads the profile once per request and reuses that snapshot for every later step. |
| `sources` | Candidate-source adapters used for cold-start discovery. |
| `candidateKinds` | Which candidate kinds to ask the sources for. |
| `evaluateEligibility` | Required callback that returns a `RecommendationCandidateEligibilityResult` for one generated candidate. The orchestrator has no provider-specific logic of its own. |
| `resolveFeatures`, `resolveExplanations`, `rerank` | Optional hooks passed through to the Phase 4 builder and the execution orchestrator. |
| `perSourceLimit`, `maxCandidates`, `sourceConcurrency`, `featureConcurrency`, `maxScoredCandidates` | Optional bounds passed through to candidate generation, the scoring-input builder, and execution. |
| `eligibilityConcurrency` | Parallel eligibility evaluations. Defaults to 8. Must be an integer from 1 to 32 or construction throws. |

`execute(request)` takes `subjectId` and `requestId` (required, trimmed, at most 512 characters, no control characters) plus optional `languages`, `limit`, `minScore`, `excludeCandidateIds`, and `signal`. The optional fields are validated by the stage that consumes them.

## Result

The result is frozen and contains `requestId`, `subjectId`, `profileUpdatedAt`, `profileSignalCount`, `discoveredCandidateCount`, `eligibleCandidateCount`, `eligibilityFailureCount`, `sourceFailures`, and `recommendations`.

Each recommendation carries the full normalized `candidate`, the `score`, `rank`, score `components`, and an `explanation` when one was resolved. The orchestrator maps every served result back to exactly one generated candidate through the scoring-input binding. If serving returns an identity that was not scored, `execute` throws instead of guessing.

The result does not include profile contents or moderation state, only the signal count and last-updated timestamp.

## Failure and cancellation behavior

- **Source failures** are reported in `sourceFailures` and do not fail the request.
- **Eligibility failures** are per candidate. If `evaluateEligibility` throws, or returns a result for a different candidate than the one it was given, that candidate is dropped and counted in `eligibilityFailureCount`. The rest of the batch continues.
- **Ineligible candidates** (a result with `eligible: false`) are dropped without being counted as failures. They show up as the gap between `discoveredCandidateCount`, `eligibleCandidateCount`, and `eligibilityFailureCount`.
- **Cancellation** is checked between stages and between eligibility evaluations. An aborted `signal` is rethrown and is never turned into an eligibility failure.
- Eligible candidates are tagged with the fingerprint of the profile snapshot read for this request, and the Phase 4 builder checks that binding before scoring.

## What this phase does not do

- It does not run onboarding bootstrap. It reads an existing profile through `engine.readProfile`, so the caller applies onboarding selections first.
- It has no per-kind caps. Limits are global (`maxCandidates`, `maxScoredCandidates`, `limit`).
- It never follows, subscribes, or joins anything. Turning a recommendation into an action plan is Phase 6 (see [`recommendation-candidate-action-plans.md`](recommendation-candidate-action-plans.md)).
- It does not refresh or invalidate results over time. That is Phase 7.

## Tests

`tests/recommendation-first-session-orchestrator.test.ts` covers the happy path through to a ranked recommendation and cancellation propagation. It also asserts each failure path: a throwing eligibility evaluator, an eligibility result for a different candidate (counted in `eligibilityFailureCount`), an ineligible result (dropped, not counted), one failing source alongside a working one, every source failing, sources that return nothing, and identical output regardless of the order sources finish in.
