# Optional ATProto directory discovery sources

Third-party ATProto directories may be useful as **discovery inputs** for recommendation-engine integrations. They are not protocol authorities, trust anchors, consent records, or subscription evidence.

## Example directory coverage

Ecosystem directories may expose browsable indexes for starter packs, feeds, lists, labelers, profiles, and related resources. These can improve discovery coverage when protocol-native search or application-specific discovery is sparse.

The recommendation engine must treat all such results as optional, pluggable, third-party hints.

## Required trust boundary

A third-party directory result must never by itself:

- subscribe a user to a labeler, feed, list, starter pack, account, or community;
- establish consent or an allowed data use;
- prove that an endpoint, account, service, feed, list, starter pack, or labeler is controlled by the claimed DID/account/provider;
- bypass DID-document, repository-record, authorization, provider-policy, block, mute, moderation, or candidate-eligibility checks;
- become a positive-interest signal merely because it is listed, popular, featured, ranked, or recommended by the directory;
- upgrade `unverified_hint` provenance to source-asserted or authority-verified identity;
- cause browsing history, directory interactions, or profile-derived query state to be sent to the directory without an explicit disclosure/consent contract.

Generic remote `RecommendationCandidateSourceAdapter` requests remain privacy-redacted. If a future directory integration requires disclosing a search term or interest, that disclosure must use a separate explicit contract rather than attaching profile state to the generic remote discovery request.

## Verification sequence

For labelers, the intended sequence remains:

```text
third-party directory hint
  -> resolve labeler DID
  -> verify DID document/service identity
  -> optionally verify repository declaration where applicable
  -> run provider/candidate eligibility and safety checks
  -> present privacy-safe discovery metadata
  -> explicit user subscription
  -> consent and signal-policy enforcement
  -> queryLabels / subscribeLabels integration
```

Feeds, lists, starter packs, accounts, and other ATProto candidates require equivalent protocol-native identity resolution and current eligibility before they may be treated as verified recommendation candidates.

## Relationship to runtime provider discovery

Runtime provider capability discovery may help determine which protocol/application adapters are usable, but it does not transform third-party directory entries into authoritative identities. Provider/application capability evidence and candidate-native identity verification are separate trust decisions.

## Deployment rule

Third-party directory support must remain behind pluggable adapters so deployments can:

- disable third-party directories entirely;
- use one provider;
- combine several providers as independent hint sources;
- rely only on protocol-native discovery.

Multiple directory hints may corroborate discovery interest, but corroboration among untrusted sources does not itself create protocol authority.
