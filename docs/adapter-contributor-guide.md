# Adapter Contributor Guide

This guide defines how to add or modify adapters without violating portability, safety, privacy, or reliability constraints.

## Non-negotiable invariants

- Core remains provider-neutral and runtime-neutral.
- All untrusted inputs are validated at adapter boundaries.
- Privacy and consent checks fail closed by default.
- Retries are bounded, jittered, and cancelable.
- No duplicate business logic that diverges from core contracts.

## Where adapters belong

Adapter implementations belong in directories such as:
- src/adapters
- src/recommendation (provider record mappers and source adapter wrappers)
- src/security (optional safety providers)

Keep protocol-agnostic contracts in:
- src/ann/types.ts
- src/recommendation/source-adapter.ts
- src/embedding/types.ts

Do not embed provider SDK assumptions into neutral contracts.

## Adapter implementation checklist

### 1. Contract-first design

- Start from an existing typed interface.
- If the interface is insufficient, extend it in a backward-compatible way.
- Do not widen accepted values without explicit validation and tests.

### 2. Input validation and sanitation

- Validate every external field before use.
- Enforce bounded lengths and control-character rejection where relevant.
- Normalize URLs, identifiers, and timestamps using existing utilities or equivalent strict logic.

### 3. Error-handling and fault model

- Throw typed, deterministic errors for invalid input.
- Distinguish permanent errors (invalid schema, unsupported operation) from transient errors (timeout, network reset).
- Ensure error messages avoid leaking private identifiers.

### 4. Retry and backoff

- Use capped retries with jittered exponential backoff.
- Honor cancellation and timeout signals.
- Never retry permanent validation errors.
- Prefer idempotent retry-safe operations.

### 5. Privacy and consent safety

- Treat provider payloads as untrusted data.
- Do not bypass consent or trust-boundary fields.
- Emit only privacy-safe audit/telemetry metadata.

### 6. Determinism and reproducibility

- Keep ranking-impacting transformations deterministic.
- Avoid hidden state mutation and time-dependent behavior unless explicit.
- If randomness is used, support injection for deterministic tests.

## Required tests for new adapters

At minimum, add tests for:
- Valid input mapping to expected normalized output.
- Rejection of malformed and ambiguous inputs.
- Retry behavior under transient failures.
- Non-retry behavior under permanent failures.
- Privacy-safe error and audit output.
- Capability and authorization mismatch handling.

Test style guidance:
- Prefer behavior-focused tests over broad pass/fail smoke tests.
- Add regression tests for every fixed bug.
- Assert both result values and side effects (events, retries, fallbacks).

## Security hardening expectations

- URL and domain handling must reject unsafe protocols and control characters.
- Authentication tokens must never be logged.
- Provider responses must be size-bounded when streaming or downloading large payloads.
- Network calls should use explicit timeouts and cancellation.

## Self-healing patterns

Use self-healing where it improves safety and reliability:
- Circuit breaker on repeated provider failures.
- Cooldown before retrying failed providers.
- Fallback provider selection with explicit observability.
- Freshness-aware degrade behavior when upstream data is stale.

Do not self-heal by silently accepting invalid data.

## Anti-drift and anti-duplication rules

- Reuse existing core contracts and helpers.
- If two adapters need similar parsing/safety logic, extract shared utility logic.
- Keep provider-specific behavior in provider modules only.
- Keep test fixtures canonical and reusable.

## Branch and CI guidance

Before opening a PR:
- Rebase on latest main.
- Run npm run lint:types.
- Run npm run build.
- Run npm test.
- Ensure no unrelated file changes are included.

PR expectations:
- Explain boundary assumptions and threat model in the PR description.
- Link regression tests to the behavior changed.
- Document fallback and retry semantics.

## Suggested PR template section for adapters

- Adapter contract and scope.
- Input validation and sanitation changes.
- Retry and timeout behavior.
- Privacy and consent implications.
- Failure mode and fallback behavior.
- Tests added and risk coverage.

## Review checklist for maintainers

- No contract drift from core neutral interfaces.
- No privacy-unsafe logging.
- No unbounded retries.
- No bypass of consent/trust-boundary checks.
- No duplicate logic introduced without justification.
- All new behavior is test-covered with edge cases.
