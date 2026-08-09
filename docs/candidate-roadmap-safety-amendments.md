# Candidate roadmap safety amendments

These requirements are normative amendments to `candidate-cold-start-onboarding-roadmap.md` following late review of PR #112. Later candidate, cold-start, action-plan, and onboarding phases must satisfy them even where the original roadmap text is less explicit.

## Remote candidate discovery query boundary

A remote `RecommendationCandidateSourceAdapter` must never receive the user's raw recommendation profile, subject identifier, private moderation/filter state, or other arbitrary caller context.

The engine must construct a closed, purpose-limited adapter query at the transport boundary. For remote adapters:

- the caller request ID is replaced with a one-way opaque query identifier;
- canonical-interest IDs are not transmitted;
- language preferences are not transmitted;
- raw profile objects are not transmitted;
- subject/account identifiers are not transmitted;
- blocks, mutes, domain blocks, keyword filters, safety preferences, and other viewer-private state are not transmitted;
- unknown request properties fail closed instead of being silently ignored.

Remote discovery should fetch bounded public/provider-authorized candidate material and perform profile-to-candidate matching locally or in explicitly user-controlled storage. If a future provider requires a disclosed search term, that must be represented by a separate explicit disclosure/consent contract rather than smuggling profile state through the generic candidate-source request.

Candidate-source adapters must also declare privacy and provider-policy context. Remote adapters are eligible only for public or ATProto-public-repository discovery data, must not expose provider-private data to candidate generation, and must fail closed when provider policy does not allow processing. Optional dynamic provider-policy evaluation must happen before adapter I/O.

## Starter-pack expansion safety

A `starter_pack` candidate passing container-level eligibility does not make each member eligible for a follow action.

Before emitting or executing any future `follow_starter_pack_members` plan, the application/engine composition must independently process every expanded account member through:

1. authoritative identity resolution;
2. moved-account resolution and loop protection;
3. current account availability/activity checks;
4. existing account recommendation eligibility;
5. provider policy;
6. discoverability/noindex/opt-out checks;
7. viewer block, mute, and domain-block checks;
8. any other applicable viewer-safety policy.

Members that are blocked, muted, inactive beyond policy, deleted, suspended, unresolved, opted out, provider-denied, or otherwise ineligible must be omitted. A failure to establish required member safety/eligibility fails closed for that member.

The action plan must be bounded and bind each included member to the resolved current account identity used by the eligibility result. The application must revalidate stale identities immediately before execution where provider state may have changed.

This requirement also applies to any future collection/list/community action that expands one recommended container into mutating actions against multiple accounts or entities.
