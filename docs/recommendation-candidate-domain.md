# Recommendation candidate domain

This document defines the first-class candidate and candidate-source boundary introduced by Phase 1 of the candidate/cold-start/onboarding roadmap.

The purpose of this layer is to distinguish recommendation targets from recommendation evidence. Existing `RecommendationSourceAdapter` contracts normalize evidence used to derive interests. Candidate-source adapters discover entities that may be recommended. A curated-set membership, directory listing, provider discovery result, or starter-pack entry therefore explains why a target was discovered; it does not mean that the viewer endorses the target.

## Candidate kinds

The generic domain initially supports:

- `account`
- `post`
- `feed`
- `list`
- `starter_pack`
- `labeler`
- `community`
- `hashtag`
- `topic`
- `instance`

Provider-specific objects must normalize to these generic kinds before entering generic cold-start, scoring, or serving composition. A provider collection used only to discover members remains provenance rather than becoming a candidate automatically.

## Stable identity

A `RecommendationCandidate` separates stable identity from presentation metadata.

Stable identity consists of:

- candidate kind;
- protocol family;
- canonical provider/native identity where applicable.

`createRecommendationCandidateId` hashes that tuple into a bounded `candidate:v1:<sha256>` identifier. Display names, descriptions, tags, current availability, provenance, and observation timestamps do not change candidate identity.

Provider adapters are responsible for canonicalizing provider-native identities before calling the helper. The generic candidate layer deliberately does not guess whether two differently formatted ActivityPub actors, AT URIs, DIDs, hashtags, or instance identifiers are equivalent.

`normalizeRecommendationCandidate` recomputes the candidate ID and rejects records whose claimed ID is not bound to the supplied native identity.

## Verification states

Candidate identity confidence is explicit:

- `unverified_hint` — useful only as a discovery hint;
- `source_asserted` — asserted by a source that is not authoritative for the identity;
- `authority_verified` — verified against a provider/protocol authority;
- `canonical` — canonical engine/local-catalog identity.

`authority_verified` and `canonical` candidates require a bounded verification authority and timestamp. A candidate supported only by `third_party` or `unknown` provenance cannot be normalized as authority-verified.

This prevents optional directories from silently becoming trust authorities.

## Provenance

Candidate provenance records how an entity entered the candidate set. Supported provenance includes onboarding-interest matches, curated account sets, legacy follow packs, starter packs, featured hashtags, public trends, public profile metadata, public interaction graphs, labeler discovery, provider discovery, third-party directory hints, instance-directory metadata, and the local catalog.

Each provenance record carries:

- provenance kind;
- source ID;
- observation time;
- existing repository source trust boundary;
- optional source item ID;
- optional curator;
- optional HTTPS source URL.

Provenance is bounded and duplicate provenance records are rejected. Third-party directory hints are required to retain the `third_party` trust boundary.

## Public candidate metadata

Candidate metadata is deliberately bounded and generic:

- display name and summary;
- canonical-interest IDs;
- tags;
- entity IDs;
- languages.

Metadata arrays are duplicate-free, bounded, sorted during normalization, and frozen. Private moderation state does not belong in candidate metadata. Blocks, mutes, keyword filters, and equivalent viewer-private controls enter the later eligibility/filtering phase only.

## Candidate-source authority

`RecommendationCandidateSourceAdapter` declares its authority separately from its capabilities.

Authority classes are:

- `untrusted_hint`
- `curated_public`
- `provider_native`
- `protocol_native`
- `local_canonical`

Capabilities declare discovery, pagination, abort propagation, public metadata, untrusted hints, and authority-verified identity behavior.

The read wrapper checks the returned candidate against both declarations. In particular:

- an untrusted-hint adapter may return only `unverified_hint` identities;
- curated public sources may return hints or source assertions but cannot become an identity authority;
- provider/protocol-native sources may return authority-verified identities only when they explicitly declare that capability;
- local canonical sources may return canonical identities;
- returned candidate kinds and protocols must be declared by the adapter;
- returned candidate kinds must also have been requested;
- duplicate candidate IDs in one page are rejected;
- cursors are rejected unless pagination was declared;
- result counts are bounded by the request/default limit;
- passing an abort signal to an adapter that did not declare abort support fails closed.

This makes adapter authority executable rather than advisory.

## Separation from evidence ingestion

The candidate-source layer does not replace or modify `RecommendationSourceAdapter`.

```text
interest evidence path
provider record
  -> RecommendationSourceAdapter
  -> consent/public-signal policy
  -> interest signal
  -> profile

candidate discovery path
public/local discovery source
  -> RecommendationCandidateSourceAdapter
  -> normalized RecommendationCandidate
  -> later eligibility/policy
  -> later scoring-input construction
```

The two paths may consume some of the same public provider resources, but their semantics are different and should not be conflated.

## Non-goals of Phase 1

Phase 1 does not:

- discover or rank candidates by itself;
- resolve protocol-native identities automatically;
- change the hybrid scorer;
- execute follows, subscriptions, joins, or registrations;
- convert private moderation settings into affinity;
- auto-subscribe to labelers;
- add provider-specific network clients merely to populate the generic contract.

Those responsibilities remain in later roadmap phases or application/provider adapters.
