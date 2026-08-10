# Runtime provider discovery and capability resolution

This phase adds a thin runtime layer above protocol/provider adapters. It does not replace adapter-specific network clients, authorization, consent, source normalization, or profile-feature capability contracts.

## Purpose

The resolver answers a bounded question: given a known provider identity and optional application identity, what protocol bindings, application compatibility profiles, and feature surfaces are currently supported by trustworthy observations?

It intentionally does **not** treat a protocol as an application. ActivityPub does not imply Mastodon, ATProto does not imply Bluesky, and ActivityPods does not imply ATProto.

## Trust and privacy boundaries

`discoverRecommendationProviderCapabilities` accepts probe callbacks implemented by hardened adapters. The generic resolver never fetches arbitrary URLs. Network-facing adapters remain responsible for SSRF protection, redirect limits, response-size limits, content-type validation, authentication, OAuth/ACL checks, and protocol-native identity validation.

Provider capability discovery is not authorization. In particular:

- `user_owned_storage: supported` means the provider/application surface can support user-owned storage; it does not prove that the current user granted access.
- `acl_authorization: supported` means an ACL/grant mechanism can be observed; it does not substitute for ActivityPods/Solid grant validation.
- OAuth scopes, AccessNeeds, AccessGrants, moderation state, private profile data, subject IDs, or user-interest state are not accepted as generic discovery fields.
- Existing consent, source-authorization, public-signal, state-placement, and ActivityPods grant checks remain mandatory at their existing boundaries.

The discovery observation schema is closed and bounded so a caller cannot smuggle personalized state or arbitrary authorization context into the provider descriptor.

## Identity separation

A provider/server identity and an application/client identity are separate.

The resolver is keyed by `providerId` plus optional `applicationId`. Observations returning another provider identity are rejected. Conflicting strong application identity evidence fails closed.

Application identity/profile claims carry their **own** `applicationAuthority`; they do not inherit authority from protocol bindings in the same observation. The authority ordering is:

1. explicit integration declaration and authenticated registration;
2. protocol-native application identity;
3. unauthenticated provider probing.

For backward compatibility, an observation that supplies `applicationId` without `applicationAuthority` is treated as weak `provider_probe` application evidence. Weak server branding may coexist with a strong protocol binding without being promoted to a strong application identity or compatibility profile.

Application profiles require a bound application identity. Provider-only observations and provider-only cached descriptors cannot publish application compatibility profiles.

## Multi-protocol providers

Protocol bindings are additive. A provider may expose:

- ActivityPub only;
- ATProto only;
- ActivityPods + ActivityPub;
- ActivityPub + ATProto;
- another supported combination.

Each downstream evidence item still retains its exact native protocol, visibility, access basis, provider, and provenance. Discovery never flattens an ActivityPub object and an ATProto record into a single privacy model.

Cross-protocol object equivalence is deliberately outside this layer. A future equivalence mechanism must require independently verified identity/object bindings before deduplication or score combination.

## Capability resolution

Capabilities use `supported`, `unsupported`, or `unknown`.

For the same capability/protocol pair, the highest-authority observation wins. Conflicting observations at the same highest authority resolve to `unknown`, which is the fail-closed state. Missing capability evidence is also `unknown`.

Capability authority is independent of application-claim authority. A strong capability or protocol binding does not automatically strengthen unrelated application branding.

## Caching and staleness

The optional cache is scoped by provider and application identity. Cached descriptors are runtime-normalized before use.

- fresh valid cache entries are reused;
- provider-only cached descriptors containing application profiles are rejected;
- stale or malformed entries are deleted when possible and rediscovered;
- cache freshness is rechecked after asynchronous cache reads;
- probe freshness is checked after asynchronous probe/retry work;
- descriptor freshness is checked again immediately before final return;
- no stale capability fallback is used when every current probe fails.

This favors privacy and correctness over availability when capabilities may have changed.

## Retries, cancellation, and partial failures

Discovery supports bounded concurrent probes. A failed independent probe does not prevent other valid probes from contributing.

Only errors explicitly classified as `RecommendationProviderProbeError(..., retryable: true)` are retried. Retry delay is bounded exponential backoff. Authentication failures, malformed data, identity mismatches, arbitrary exceptions, and validation failures are not automatically retried.

Abort signals are checked before cache use, probe execution, retry waits, and final resolution.

## Application profiles

The current normalized application profiles are convenience classifications, not authorization grants:

- `generic_activitypub`
- `mastodon_compatible`
- `generic_atproto`
- `bluesky_compatible`
- `activitypods`

A provider may expose multiple profiles only when the application identity itself has sufficient authority. For example, an ActivityPods deployment may expose `activitypods` and `generic_activitypub` while having no ATProto binding at all.

## Relationship to candidate discovery

`RecommendationCandidateSourceAdapter` already supports multiple declared protocols. Runtime provider discovery sits above it and can be used by integration orchestration to select only adapters whose protocol/application capabilities have been established.

The candidate adapter remains authoritative for its own candidate kinds, transport/privacy declaration, provider-policy evaluation, redacted remote query construction, and returned-candidate verification limits.

## Security invariants

The following are intentional invariants:

- no automatic protocol-to-application promotion;
- no protocol-binding-authority to application-claim-authority promotion;
- no provider-only cached application profiles;
- no capability-to-consent promotion;
- no capability-to-ACL/OAuth grant promotion;
- no provider identity mismatch merging;
- no conflicting strong application identity fallback;
- no stale capability resurrection across asynchronous cache/probe work;
- no retry of arbitrary/adversarial failures;
- no unbounded probes, concurrency, retries, identifiers, endpoints, or capability lists;
- no unknown protocol binding published as usable;
- unknown/missing capability support remains fail-closed.
