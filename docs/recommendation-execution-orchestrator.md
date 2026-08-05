# Recommendation execution orchestrator

The recommendation execution orchestrator composes the existing profile, scoring, reranking, explanation, and candidate-serving primitives without taking ownership of application infrastructure.

## Flow

```text
existing recommendation profile
  -> injected scoring-input builder
  -> hybrid scoring
  -> optional injected candidate metadata
  -> optional diversity/novelty reranking
  -> optional injected explanations
  -> bounded candidate serving
```

## Separation of responsibility

The engine reads the profile through the existing engine contract and performs deterministic composition. The adopting application or deployment supplies the inputs needed by the scoring layer, including any embedding retrieval, graph state, entity matches, bandit state, or deterministic scores.

The orchestrator does not:

- fetch protocol records;
- authenticate to providers;
- select or own a database;
- schedule refresh jobs;
- create embeddings;
- choose an ANN provider;
- infer provider-specific semantics;
- expose profile entries in the serving response.

## Runtime boundaries

- Subject, request, cluster, category, and explanation identifiers are bounded and control-character safe.
- Scored candidates must have unique cluster IDs and finite aggregate and component scores.
- Optional metadata may reference only scored candidates and may not contain duplicate cluster IDs.
- Optional explanations must be bound to the exact scored candidate and contain bounded finite components.
- Candidate volume is bounded before reranking, explanation generation, and serving.
- The response exposes only profile freshness and signal-count metadata, not the private profile contents.

This completes the reusable profile-to-results composition while preserving dependency injection for retrieval, storage, model execution, and application policy.
