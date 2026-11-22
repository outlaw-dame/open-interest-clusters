import {
  createRecommendationEvidenceAttestation,
  recommendationEvidenceContentDigest,
  type RecommendationEvidenceAttestation
} from "./evidence-attestation.js";
import type { RecommendationEvidenceKind } from "./evidence-verifier.js";
import {
  verifyRecommendationAtprotoLabelSignature,
  type RecommendationAtprotoLabelVerificationFailure
} from "./atproto-label-verification.js";

// Turns a verified label signature into an evidence attestation. Nothing here fetches a DID document
// or a label. The caller does that and passes both in. See docs/atproto-label-verification.md.

export const RECOMMENDATION_ATPROTO_LABEL_ATTESTATION_REFUSALS = [
  "negated_label",
  "invalid_attestation_input"
] as const;

export type RecommendationAtprotoLabelAttestationRefusal =
  | RecommendationAtprotoLabelVerificationFailure
  | typeof RECOMMENDATION_ATPROTO_LABEL_ATTESTATION_REFUSALS[number];

export type RecommendationAtprotoLabelAttestationResult =
  | { readonly issued: true; readonly attestation: RecommendationEvidenceAttestation }
  | { readonly issued: false; readonly reason: RecommendationAtprotoLabelAttestationRefusal };

export interface RecommendationAtprotoLabelAttestationInput {
  label: unknown;
  /** The labeler's current DID document, resolved by the caller. */
  didDocument: unknown;
  /** The caller's clock, RFC 3339. It is also the attestation's `verifiedAt`. */
  now: string;
  subjectId: string;
  /** The sources the evidence relies on. Needs to match what the evidence verifier derives from the evidence. */
  sourceIds: readonly string[];
  kind: RecommendationEvidenceKind;
  /** Short plain statement of what the label was used to establish. */
  claim: string;
  verifierId: string;
  /**
   * What the evidence verifier hook will be handed, when that is not the label itself. The digest
   * binds this value. The caller vouches that it was derived from the verified label, since the
   * library cannot see how it was derived. Leave out to bind the label.
   */
  evidence?: unknown;
}

const fail = (reason: RecommendationAtprotoLabelAttestationRefusal): RecommendationAtprotoLabelAttestationResult =>
  Object.freeze({ issued: false as const, reason });

/**
 * Issues an `atproto_label_signature` attestation (authority `protocol_native`) only when the
 * label's signature verifies against the labeler's `#atproto_label` key and the label is a positive,
 * unexpired claim. A signed retraction (`neg: true`) is refused, because an attestation reads as a
 * positive claim. Every failure comes back as a fixed reason and nothing is marked verified. The
 * attestation expires when the label does. Does not throw for bad label or DID document input.
 */
export function createRecommendationAtprotoLabelAttestation(
  input: RecommendationAtprotoLabelAttestationInput
): RecommendationAtprotoLabelAttestationResult {
  let contentDigest: string;
  try {
    // Also rejects getters and non-plain data, so what is checked is what gets digested.
    const labelDigest = recommendationEvidenceContentDigest(input.label);
    contentDigest = input.evidence === undefined ? labelDigest : recommendationEvidenceContentDigest(input.evidence);
  } catch {
    return fail("malformed_label");
  }
  const result = verifyRecommendationAtprotoLabelSignature({ label: input.label, didDocument: input.didDocument, now: input.now });
  if (!result.verified) return fail(result.reason);
  if (result.negated) return fail("negated_label");
  try {
    const exp = result.hasExpiry ? (input.label as { exp: string }).exp : undefined;
    const attestation = createRecommendationEvidenceAttestation({
      subjectId: input.subjectId,
      sourceIds: input.sourceIds,
      kind: input.kind,
      claim: input.claim,
      mechanism: "atproto_label_signature",
      authority: "protocol_native",
      verifiedAt: input.now,
      verifierId: input.verifierId,
      contentDigest,
      ...(exp === undefined ? {} : { expiresAt: exp })
    });
    return Object.freeze({ issued: true as const, attestation });
  } catch {
    return fail("invalid_attestation_input");
  }
}
