# Recommendation candidate domain

Phase 1 makes recommendation targets first-class without overloading the existing evidence-ingestion `RecommendationSourceAdapter`.

## Candidate model

`RecommendationCandidate` supports `account`, `post`, `feed`, `list`, `starter_pack`, `labeler`, `community`, `hashtag`, `topic`, and `instance` targets. Stable identity is separated from mutable presentation metadata.

`createRecommendationCandidateId` derives a bounded `candidate:v1:<sha256>` ID from candidate kind, protocol, optional provider namespace, and canonical provider-native identity. `normalizeRecommendationCandidate` recomputes that ID and rejects mismatches.

Provider adapters must canonicalize native identities before constructing candidate IDs. The generic layer does not guess equivalence between ActivityPub actor URIs, DIDs, AT URIs, hashtags, or provider-specific identifiers.

## Verification and provenance

Verification states are `unverified_hint`, `source_asserted`, `authority_verified`, and `canonical`. Authority-verified/canonical identities require explicit authority and verification time and cannot be supported only by third-party/unknown provenance.

Provenance records why a candidate was discovered, including onboarding matches, curated sets, follow packs, starter packs, public metadata/trends/graphs, labeler or provider discovery, directory hints, instance metadata, and local catalog entries.

Discovery provenance is not viewer endorsement. Third-party directory hints must retain the `third_party` trust boundary.

## Candidate-source adapters

`RecommendationCandidateSourceAdapter` declares candidate kinds, protocols, authority, and capabilities. Authorities are `untrusted_hint`, `curated_public`, `provider_native`, `protocol_native`, and `local_canonical`.

The generic read wrapper enforces those declarations. It rejects:

- verification stronger than the source authority/capabilities;
- undeclared or unrequested candidate kinds;
- undeclared protocols;
- duplicate candidate IDs in one page;
- result pages beyond the request/default bound;
- cursors without pagination capability;
- abort signals supplied to adapters that did not declare abort support.

This means a third-party directory can help discover a candidate but cannot make itself the authority that verifies that candidate.

## Privacy boundary

Candidate metadata contains bounded public/generic fields such as canonical-interest associations, tags, entity IDs, languages, display name, and summary. Private blocks, mutes, domain blocks, keyword filters, and other moderation state do not belong in candidate metadata and remain filtering-only inputs for the later eligibility phase.

The candidate layer performs no follow, subscribe, join, registration, or labeler-subscription action. Provider actions remain application-owned and user-confirmed.
