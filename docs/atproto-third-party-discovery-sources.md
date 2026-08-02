# Optional ATProto directory discovery sources

Third-party ATProto directories may be useful as **discovery inputs** for recommendation-engine integrations. They are not protocol authorities, trust anchors, consent records, or subscription evidence.

## Bluesky Directory

As of August 2026, Bluesky Directory exposes browsable sections for:

- starter packs;
- feeds;
- lists;
- labelers;
- profiles and related ecosystem resources.

Reference: `https://blueskydirectory.com/`

This may be useful in later integration and discovery phases for:

- finding candidate labelers before DID-document verification;
- finding custom feeds and lists that may become recommendation candidates or user-selected sources;
- finding starter packs that may provide explicit onboarding or community-discovery seeds;
- improving coverage when first-party protocol discovery is sparse.

## Required trust boundary

Directory entries must always be treated as untrusted hints.

A directory result must never by itself:

- subscribe a user to a labeler, feed, list, or starter pack;
- establish consent or an allowed data use;
- prove that an endpoint is controlled by a DID;
- bypass DID-document, repository-record, authorization, block, mute, moderation, or eligibility checks;
- become a positive-interest signal merely because it is listed, popular, featured, or highly ranked;
- cause third-party browsing history or directory interactions to be collected without explicit opt-in.

For labelers, the existing sequence remains authoritative:

```text
third-party directory hint
→ resolve labeler DID
→ verify DID document and #atproto_labeler service
→ optionally verify repository declaration
→ present privacy-safe discovery metadata
→ explicit user subscription
→ consent and signal-policy enforcement
→ queryLabels / subscribeLabels integration
```

Feeds, lists, and starter packs require equivalent protocol-native verification and explicit product policy before they are admitted as sources or candidates.

## Phase placement

This belongs primarily in:

- labeler and ecosystem discovery;
- live ATProto integration slices;
- onboarding and candidate-source discovery;
- later diversity, quality, reputation, and availability evaluation.

It should remain behind a pluggable directory-source adapter so deployments can disable third-party directories, use another provider, combine several providers, or rely only on protocol-native discovery.
