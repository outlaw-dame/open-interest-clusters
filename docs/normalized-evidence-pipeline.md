# Normalized evidence pipeline

The normalized evidence pipeline is the bridge between live source adapters and the existing signal-ledger/profile engine orchestrator.

It does not own authentication, network transports, source scheduling, application storage, or semantic policy. Integrators inject those concerns.

## Flow

```text
source adapter
  -> consent-gated read
  -> normalized evidence
  -> application/provider semantic derivation
  -> evidence-bound interest signals
  -> stable ledger events
  -> existing engine orchestrator
  -> profile replacement
```

## Boundary guarantees

- Every evidence item is paired with an explicit allowed consent evaluation.
- Consent audit fields must match the normalized source protocol, visibility, access basis, private-data flag, third-party-data flag, server-processing flag, and requested data use.
- Integrators must provide a stable provider source-event identity; the pipeline hashes it with the subject, adapter, source system, and namespace before it becomes an evidence or ledger identity.
- Raw provider event identifiers are therefore not used as operation IDs or source-event IDs in persisted ledger state.
- Signal derivation remains dependency-injected. The core does not infer that an arbitrary post, label, collection, or relationship has a particular recommendation meaning.
- Every derived signal must remain bound to the evidence and consent evaluation from which it was derived.
- Evidence count and per-evidence signal fan-out are bounded before engine processing.
- Repeated reads of the same source event produce stable operation and source-event IDs, allowing the existing signal ledger to deduplicate retries and replays.

## Separation of responsibility

The source adapter obtains and normalizes provider information. The consent layer determines whether that information may be processed for the requested purpose. The evidence pipeline records the allowed fact and its provenance. An injected semantic deriver decides what recommendation signals, if any, follow from the evidence. The existing engine orchestrator owns idempotent ledger application and profile synchronization.

This preserves protocol neutrality and prevents the recommendation core from inventing provider semantics or taking ownership of application infrastructure.
