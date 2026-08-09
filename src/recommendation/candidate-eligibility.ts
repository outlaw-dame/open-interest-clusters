import {
  evaluateRecommendationAccountEligibility,
  type RecommendationAccountEligibilityReason,
  type RecommendationAccountProfile,
  type RecommendationAccountProfileResolver
} from "./account-recommendation-eligibility.js";
import {
  normalizeRecommendationCandidate,
  type RecommendationCandidate,
  type RecommendationCandidateKind
} from "./candidate-domain.js";
import { normalizeStrictRfc3339Timestamp } from "./strict-rfc3339.js";

export const RECOMMENDATION_CANDIDATE_ELIGIBILITY_REASON_CODES = [
  "eligible",
  "candidate_unavailable",
  "provider_policy_denied",
  "provider_policy_incomplete",
  "viewer_safety_denied",
  "viewer_safety_incomplete",
  "identity_verification_required",
  "account_inactive",
  "account_deactivated",
  "account_suspended",
  "account_deleted",
  "account_unresolved",
  "account_move_loop",
  "account_move_limit",
  "account_policy_incomplete",
  "account_not_discoverable",
  "account_noindex",
  "account_opted_out",
  "post_not_public",
  "post_unavailable",
  "post_identity_unbound",
  "feed_unresolvable",
  "feed_unavailable",
  "list_unresolvable",
  "list_unavailable",
  "starter_pack_unresolvable",
  "starter_pack_stale",
  "starter_pack_unavailable",
  "starter_pack_members_unbounded",
  "labeler_identity_unverified",
  "labeler_unavailable",
  "labeler_policy_ineligible",
  "community_unresolved",
  "community_unavailable",
  "community_policy_ineligible",
  "hashtag_not_public_topic",
  "hashtag_locally_filtered",
  "topic_not_canonical",
  "topic_policy_unsafe",
  "instance_unhealthy",
  "instance_registration_closed",
  "instance_policy_ineligible"
] as const;

export type RecommendationCandidateEligibilityReasonCode =
  typeof RECOMMENDATION_CANDIDATE_ELIGIBILITY_REASON_CODES[number];

export const RECOMMENDATION_RESOLVED_ACCOUNT_POLICY_RESTRICTIONS = [
  "not_discoverable",
  "noindex",
  "opted_out"
] as const;

export type RecommendationResolvedAccountPolicyRestriction =
  typeof RECOMMENDATION_RESOLVED_ACCOUNT_POLICY_RESTRICTIONS[number];

export interface RecommendationCandidatePolicyGate {
  allowed: boolean;
  evidenceComplete: boolean;
}

export interface RecommendationCandidateViewerSafetyGate {
  eligible: boolean;
  evidenceComplete: boolean;
}

export interface RecommendationResolvedAccountPolicyGate {
  restrictions: readonly RecommendationResolvedAccountPolicyRestriction[];
  evidenceComplete: boolean;
}

export interface RecommendationCandidatePolicyEvaluationContext {
  candidate: RecommendationCandidate;
  evaluatedAt: string;
  resolvedAccount?: RecommendationAccountProfile;
  moveChain?: readonly string[];
  signal?: AbortSignal;
}

export type RecommendationCandidateProviderPolicyEvaluator = (
  context: RecommendationCandidatePolicyEvaluationContext
) => RecommendationCandidatePolicyGate | Promise<RecommendationCandidatePolicyGate>;

export type RecommendationCandidateViewerSafetyEvaluator = (
  context: RecommendationCandidatePolicyEvaluationContext
) => RecommendationCandidateViewerSafetyGate | Promise<RecommendationCandidateViewerSafetyGate>;

export type RecommendationResolvedAccountPolicyEvaluator = (
  context: RecommendationCandidatePolicyEvaluationContext & { resolvedAccount: RecommendationAccountProfile }
) => RecommendationResolvedAccountPolicyGate | Promise<RecommendationResolvedAccountPolicyGate>;

export interface RecommendationAccountCandidateEligibilityEvidence {
  kind: "account";
  resolver: RecommendationAccountProfileResolver;
  identityBindingVerified: boolean;
  evaluateResolvedAccountPolicy: RecommendationResolvedAccountPolicyEvaluator;
  inactivityDays?: number;
}

export interface RecommendationPostCandidateEligibilityEvidence {
  kind: "post";
  explicitlyPublic: boolean;
  available: boolean;
  identityBound: boolean;
}

export interface RecommendationFeedCandidateEligibilityEvidence {
  kind: "feed";
  resolvable: boolean;
  available: boolean;
}

export interface RecommendationListCandidateEligibilityEvidence {
  kind: "list";
  resolvable: boolean;
  available: boolean;
}

export interface RecommendationStarterPackCandidateEligibilityEvidence {
  kind: "starter_pack";
  resolvable: boolean;
  current: boolean;
  available: boolean;
  memberCount: number;
}

export interface RecommendationLabelerCandidateEligibilityEvidence {
  kind: "labeler";
  identityVerified: boolean;
  available: boolean;
  policyEligible: boolean;
}

export interface RecommendationCommunityCandidateEligibilityEvidence {
  kind: "community";
  exists: boolean;
  available: boolean;
  policyEligible: boolean;
}

export interface RecommendationHashtagCandidateEligibilityEvidence {
  kind: "hashtag";
  normalizedValidPublicTopic: boolean;
  locallyFiltered: boolean;
}

export interface RecommendationTopicCandidateEligibilityEvidence {
  kind: "topic";
  canonicalCatalogIdentity: boolean;
  policySafeMetadata: boolean;
}

export interface RecommendationInstanceCandidateEligibilityEvidence {
  kind: "instance";
  healthy: boolean;
  registrationOpen: boolean;
  policyEligible: boolean;
}

export type RecommendationCandidateEligibilityEvidence =
  | RecommendationAccountCandidateEligibilityEvidence
  | RecommendationPostCandidateEligibilityEvidence
  | RecommendationFeedCandidateEligibilityEvidence
  | RecommendationListCandidateEligibilityEvidence
  | RecommendationStarterPackCandidateEligibilityEvidence
  | RecommendationLabelerCandidateEligibilityEvidence
  | RecommendationCommunityCandidateEligibilityEvidence
  | RecommendationHashtagCandidateEligibilityEvidence
  | RecommendationTopicCandidateEligibilityEvidence
  | RecommendationInstanceCandidateEligibilityEvidence;

export interface RecommendationCandidateEligibilityInput {
  candidate: RecommendationCandidate;
  evidence: RecommendationCandidateEligibilityEvidence;
  evaluateProviderPolicy: RecommendationCandidateProviderPolicyEvaluator;
  evaluateViewerSafety: RecommendationCandidateViewerSafetyEvaluator;
  evaluatedAt?: string;
  signal?: AbortSignal;
}

export interface RecommendationCandidateEligibilityResult {
  candidate: RecommendationCandidate;
  eligible: boolean;
  reasonCodes: readonly RecommendationCandidateEligibilityReasonCode[];
  evaluatedAt: string;
  resolvedAccount?: RecommendationAccountProfile;
  moveChain?: readonly string[];
}

const MAX_STARTER_PACK_MEMBERS = 1_000;
const INPUT_KEYS = new Set([
  "candidate",
  "evidence",
  "evaluateProviderPolicy",
  "evaluateViewerSafety",
  "evaluatedAt",
  "signal"
]);
const POLICY_GATE_KEYS = new Set(["allowed", "evidenceComplete"]);
const VIEWER_GATE_KEYS = new Set(["eligible", "evidenceComplete"]);
const RESOLVED_ACCOUNT_POLICY_KEYS = new Set(["restrictions", "evidenceComplete"]);
const RESOLVED_ACCOUNT_POLICY_RESTRICTION_SET = new Set<string>(
  RECOMMENDATION_RESOLVED_ACCOUNT_POLICY_RESTRICTIONS
);
const EVIDENCE_KEYS: Readonly<Record<RecommendationCandidateKind, ReadonlySet<string>>> = {
  account: new Set(["kind", "resolver", "identityBindingVerified", "evaluateResolvedAccountPolicy", "inactivityDays"]),
  post: new Set(["kind", "explicitlyPublic", "available", "identityBound"]),
  feed: new Set(["kind", "resolvable", "available"]),
  list: new Set(["kind", "resolvable", "available"]),
  starter_pack: new Set(["kind", "resolvable", "current", "available", "memberCount"]),
  labeler: new Set(["kind", "identityVerified", "available", "policyEligible"]),
  community: new Set(["kind", "exists", "available", "policyEligible"]),
  hashtag: new Set(["kind", "normalizedValidPublicTopic", "locallyFiltered"]),
  topic: new Set(["kind", "canonicalCatalogIdentity", "policySafeMetadata"]),
  instance: new Set(["kind", "healthy", "registrationOpen", "policyEligible"])
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function booleanField(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(message);
  return value;
}

function normalizeProviderPolicy(value: unknown): RecommendationCandidatePolicyGate {
  if (!isRecord(value) || !hasOnlyKeys(value, POLICY_GATE_KEYS)) {
    throw new TypeError("Invalid recommendation candidate provider-policy decision.");
  }
  return Object.freeze({
    allowed: booleanField(value.allowed, "Invalid recommendation candidate provider-policy decision."),
    evidenceComplete: booleanField(value.evidenceComplete, "Invalid recommendation candidate provider-policy decision.")
  });
}

function normalizeViewerSafety(value: unknown): RecommendationCandidateViewerSafetyGate {
  if (!isRecord(value) || !hasOnlyKeys(value, VIEWER_GATE_KEYS)) {
    throw new TypeError("Invalid recommendation candidate viewer-safety decision.");
  }
  return Object.freeze({
    eligible: booleanField(value.eligible, "Invalid recommendation candidate viewer-safety decision."),
    evidenceComplete: booleanField(value.evidenceComplete, "Invalid recommendation candidate viewer-safety decision.")
  });
}

function normalizeResolvedAccountPolicy(value: unknown): RecommendationResolvedAccountPolicyGate {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, RESOLVED_ACCOUNT_POLICY_KEYS) ||
    !Array.isArray(value.restrictions) ||
    value.restrictions.length > RECOMMENDATION_RESOLVED_ACCOUNT_POLICY_RESTRICTIONS.length
  ) {
    throw new TypeError("Invalid recommendation resolved-account policy decision.");
  }
  const restrictions = value.restrictions.map((entry) => {
    if (typeof entry !== "string" || !RESOLVED_ACCOUNT_POLICY_RESTRICTION_SET.has(entry)) {
      throw new TypeError("Invalid recommendation resolved-account policy decision.");
    }
    return entry as RecommendationResolvedAccountPolicyRestriction;
  });
  if (new Set(restrictions).size !== restrictions.length) {
    throw new TypeError("Invalid recommendation resolved-account policy decision.");
  }
  restrictions.sort();
  return Object.freeze({
    restrictions: Object.freeze(restrictions),
    evidenceComplete: booleanField(value.evidenceComplete, "Invalid recommendation resolved-account policy decision.")
  });
}

function normalizeEvidence(
  value: unknown,
  expectedKind: RecommendationCandidateKind
): RecommendationCandidateEligibilityEvidence {
  if (!isRecord(value) || value.kind !== expectedKind || !hasOnlyKeys(value, EVIDENCE_KEYS[expectedKind])) {
    throw new TypeError("Invalid recommendation candidate eligibility evidence.");
  }

  switch (expectedKind) {
    case "account": {
      if (
        !isRecord(value.resolver) ||
        typeof value.resolver.resolve !== "function" ||
        typeof value.evaluateResolvedAccountPolicy !== "function"
      ) {
        throw new TypeError("Invalid recommendation account eligibility evidence.");
      }
      const inactivityDays = value.inactivityDays;
      if (
        inactivityDays !== undefined &&
        (!Number.isSafeInteger(inactivityDays) || (inactivityDays as number) < 1 || (inactivityDays as number) > 365)
      ) {
        throw new TypeError("Invalid recommendation account inactivity window.");
      }
      const normalized: RecommendationAccountCandidateEligibilityEvidence = {
        kind: "account",
        resolver: value.resolver as unknown as RecommendationAccountProfileResolver,
        identityBindingVerified: booleanField(value.identityBindingVerified, "Invalid recommendation account identity binding evidence."),
        evaluateResolvedAccountPolicy: value.evaluateResolvedAccountPolicy as RecommendationResolvedAccountPolicyEvaluator
      };
      if (inactivityDays !== undefined) normalized.inactivityDays = inactivityDays as number;
      return Object.freeze(normalized);
    }
    case "post":
      return Object.freeze({
        kind: "post",
        explicitlyPublic: booleanField(value.explicitlyPublic, "Invalid recommendation post public-visibility evidence."),
        available: booleanField(value.available, "Invalid recommendation post availability evidence."),
        identityBound: booleanField(value.identityBound, "Invalid recommendation post identity-binding evidence.")
      });
    case "feed":
      return Object.freeze({
        kind: "feed",
        resolvable: booleanField(value.resolvable, "Invalid recommendation feed resolution evidence."),
        available: booleanField(value.available, "Invalid recommendation feed availability evidence.")
      });
    case "list":
      return Object.freeze({
        kind: "list",
        resolvable: booleanField(value.resolvable, "Invalid recommendation list resolution evidence."),
        available: booleanField(value.available, "Invalid recommendation list availability evidence.")
      });
    case "starter_pack": {
      if (!Number.isSafeInteger(value.memberCount) || (value.memberCount as number) < 0) {
        throw new TypeError("Invalid recommendation starter-pack member count.");
      }
      return Object.freeze({
        kind: "starter_pack",
        resolvable: booleanField(value.resolvable, "Invalid recommendation starter-pack resolution evidence."),
        current: booleanField(value.current, "Invalid recommendation starter-pack freshness evidence."),
        available: booleanField(value.available, "Invalid recommendation starter-pack availability evidence."),
        memberCount: value.memberCount as number
      });
    }
    case "labeler":
      return Object.freeze({
        kind: "labeler",
        identityVerified: booleanField(value.identityVerified, "Invalid recommendation labeler identity evidence."),
        available: booleanField(value.available, "Invalid recommendation labeler availability evidence."),
        policyEligible: booleanField(value.policyEligible, "Invalid recommendation labeler policy evidence.")
      });
    case "community":
      return Object.freeze({
        kind: "community",
        exists: booleanField(value.exists, "Invalid recommendation community existence evidence."),
        available: booleanField(value.available, "Invalid recommendation community availability evidence."),
        policyEligible: booleanField(value.policyEligible, "Invalid recommendation community policy evidence.")
      });
    case "hashtag":
      return Object.freeze({
        kind: "hashtag",
        normalizedValidPublicTopic: booleanField(value.normalizedValidPublicTopic, "Invalid recommendation hashtag public-topic evidence."),
        locallyFiltered: booleanField(value.locallyFiltered, "Invalid recommendation hashtag filter evidence.")
      });
    case "topic":
      return Object.freeze({
        kind: "topic",
        canonicalCatalogIdentity: booleanField(value.canonicalCatalogIdentity, "Invalid recommendation topic catalog evidence."),
        policySafeMetadata: booleanField(value.policySafeMetadata, "Invalid recommendation topic policy evidence.")
      });
    case "instance":
      return Object.freeze({
        kind: "instance",
        healthy: booleanField(value.healthy, "Invalid recommendation instance health evidence."),
        registrationOpen: booleanField(value.registrationOpen, "Invalid recommendation instance registration evidence."),
        policyEligible: booleanField(value.policyEligible, "Invalid recommendation instance policy evidence.")
      });
  }
}

function accountReasonCode(reason: RecommendationAccountEligibilityReason): RecommendationCandidateEligibilityReasonCode {
  switch (reason) {
    case "eligible": return "eligible";
    case "inactive": return "account_inactive";
    case "deactivated": return "account_deactivated";
    case "suspended": return "account_suspended";
    case "deleted": return "account_deleted";
    case "unresolved": return "account_unresolved";
    case "move_loop": return "account_move_loop";
    case "move_limit": return "account_move_limit";
  }
}

function accountRestrictionReasonCode(
  restriction: RecommendationResolvedAccountPolicyRestriction
): RecommendationCandidateEligibilityReasonCode {
  switch (restriction) {
    case "not_discoverable": return "account_not_discoverable";
    case "noindex": return "account_noindex";
    case "opted_out": return "account_opted_out";
  }
}

function requiresAuthorityVerification(kind: RecommendationCandidateKind): boolean {
  return kind === "feed" || kind === "list" || kind === "starter_pack" || kind === "labeler";
}

function typeSpecificReasons(
  candidate: RecommendationCandidate,
  evidence: RecommendationCandidateEligibilityEvidence
): RecommendationCandidateEligibilityReasonCode[] {
  const reasons: RecommendationCandidateEligibilityReasonCode[] = [];
  switch (evidence.kind) {
    case "account":
      if (!evidence.identityBindingVerified) reasons.push("identity_verification_required");
      break;
    case "post":
      if (!evidence.explicitlyPublic) reasons.push("post_not_public");
      if (!evidence.available) reasons.push("post_unavailable");
      if (!evidence.identityBound) reasons.push("post_identity_unbound");
      break;
    case "feed":
      if (!evidence.resolvable) reasons.push("feed_unresolvable");
      if (!evidence.available) reasons.push("feed_unavailable");
      break;
    case "list":
      if (!evidence.resolvable) reasons.push("list_unresolvable");
      if (!evidence.available) reasons.push("list_unavailable");
      break;
    case "starter_pack":
      if (!evidence.resolvable) reasons.push("starter_pack_unresolvable");
      if (!evidence.current) reasons.push("starter_pack_stale");
      if (!evidence.available) reasons.push("starter_pack_unavailable");
      if (evidence.memberCount > MAX_STARTER_PACK_MEMBERS) reasons.push("starter_pack_members_unbounded");
      break;
    case "labeler":
      if (!evidence.identityVerified) reasons.push("labeler_identity_unverified");
      if (!evidence.available) reasons.push("labeler_unavailable");
      if (!evidence.policyEligible) reasons.push("labeler_policy_ineligible");
      break;
    case "community":
      if (!evidence.exists) reasons.push("community_unresolved");
      if (!evidence.available) reasons.push("community_unavailable");
      if (!evidence.policyEligible) reasons.push("community_policy_ineligible");
      break;
    case "hashtag":
      if (!evidence.normalizedValidPublicTopic) reasons.push("hashtag_not_public_topic");
      if (evidence.locallyFiltered) reasons.push("hashtag_locally_filtered");
      break;
    case "topic":
      if (!evidence.canonicalCatalogIdentity) reasons.push("topic_not_canonical");
      if (!evidence.policySafeMetadata) reasons.push("topic_policy_unsafe");
      break;
    case "instance":
      if (!evidence.healthy) reasons.push("instance_unhealthy");
      if (!evidence.registrationOpen) reasons.push("instance_registration_closed");
      if (!evidence.policyEligible) reasons.push("instance_policy_ineligible");
      break;
  }

  if (
    requiresAuthorityVerification(candidate.kind) &&
    candidate.verification.state !== "authority_verified" &&
    candidate.verification.state !== "canonical"
  ) {
    reasons.push("identity_verification_required");
  }
  return reasons;
}

function uniqueReasons(
  reasons: readonly RecommendationCandidateEligibilityReasonCode[]
): readonly RecommendationCandidateEligibilityReasonCode[] {
  return Object.freeze([...new Set(reasons)].sort());
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

function result(
  candidate: RecommendationCandidate,
  evaluatedAt: string,
  reasons: readonly RecommendationCandidateEligibilityReasonCode[],
  resolvedAccount?: RecommendationAccountProfile,
  moveChain?: readonly string[]
): RecommendationCandidateEligibilityResult {
  const normalizedReasons = uniqueReasons(reasons);
  const eligible = normalizedReasons.length === 0;
  return Object.freeze({
    candidate,
    eligible,
    reasonCodes: eligible ? Object.freeze(["eligible"] as const) : normalizedReasons,
    evaluatedAt,
    ...(resolvedAccount === undefined ? {} : { resolvedAccount }),
    ...(moveChain === undefined ? {} : { moveChain: Object.freeze([...moveChain]) })
  });
}

function policyContext(
  candidate: RecommendationCandidate,
  evaluatedAt: string,
  signal: AbortSignal | undefined,
  resolvedAccount: RecommendationAccountProfile | undefined,
  moveChain: readonly string[] | undefined
): RecommendationCandidatePolicyEvaluationContext {
  return Object.freeze({
    candidate,
    evaluatedAt,
    ...(resolvedAccount === undefined ? {} : { resolvedAccount }),
    ...(moveChain === undefined ? {} : { moveChain: Object.freeze([...moveChain]) }),
    ...(signal === undefined ? {} : { signal })
  });
}

async function evaluateProviderPolicySafely(
  evaluator: RecommendationCandidateProviderPolicyEvaluator,
  context: RecommendationCandidatePolicyEvaluationContext
): Promise<RecommendationCandidatePolicyGate> {
  try {
    const decision = await evaluator(context);
    assertNotAborted(context.signal);
    return normalizeProviderPolicy(decision);
  } catch (error) {
    assertNotAborted(context.signal);
    void error;
    return Object.freeze({ allowed: false, evidenceComplete: false });
  }
}

async function evaluateViewerSafetySafely(
  evaluator: RecommendationCandidateViewerSafetyEvaluator,
  context: RecommendationCandidatePolicyEvaluationContext
): Promise<RecommendationCandidateViewerSafetyGate> {
  try {
    const decision = await evaluator(context);
    assertNotAborted(context.signal);
    return normalizeViewerSafety(decision);
  } catch (error) {
    assertNotAborted(context.signal);
    void error;
    return Object.freeze({ eligible: false, evidenceComplete: false });
  }
}

async function evaluateResolvedAccountPolicySafely(
  evaluator: RecommendationResolvedAccountPolicyEvaluator,
  context: RecommendationCandidatePolicyEvaluationContext & { resolvedAccount: RecommendationAccountProfile }
): Promise<RecommendationResolvedAccountPolicyGate> {
  try {
    const decision = await evaluator(context);
    assertNotAborted(context.signal);
    return normalizeResolvedAccountPolicy(decision);
  } catch (error) {
    assertNotAborted(context.signal);
    void error;
    return Object.freeze({ restrictions: Object.freeze([]), evidenceComplete: false });
  }
}

export async function evaluateRecommendationCandidateEligibility(
  input: RecommendationCandidateEligibilityInput
): Promise<RecommendationCandidateEligibilityResult> {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, INPUT_KEYS) ||
    typeof input.evaluateProviderPolicy !== "function" ||
    typeof input.evaluateViewerSafety !== "function"
  ) {
    throw new TypeError("Invalid recommendation candidate eligibility input.");
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new TypeError("Invalid recommendation candidate eligibility abort signal.");
  }
  assertNotAborted(input.signal);

  const candidate = normalizeRecommendationCandidate(input.candidate);
  const evidence = normalizeEvidence(input.evidence, candidate.kind);
  const evaluatedAt = normalizeStrictRfc3339Timestamp(
    input.evaluatedAt ?? new Date().toISOString(),
    "Invalid recommendation candidate eligibility timestamp."
  );

  const cheapReasons: RecommendationCandidateEligibilityReasonCode[] = [];
  if (candidate.availability === "unavailable") cheapReasons.push("candidate_unavailable");
  cheapReasons.push(...typeSpecificReasons(candidate, evidence));
  if (cheapReasons.length > 0) {
    return result(candidate, evaluatedAt, cheapReasons);
  }

  let resolvedAccount: RecommendationAccountProfile | undefined;
  let moveChain: readonly string[] | undefined;
  if (evidence.kind === "account") {
    try {
      const accountResult = await evaluateRecommendationAccountEligibility({
        reference: candidate.nativeId,
        resolver: evidence.resolver,
        evaluatedAt,
        ...(evidence.inactivityDays === undefined ? {} : { inactivityDays: evidence.inactivityDays }),
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      assertNotAborted(input.signal);
      if (!accountResult.eligible) {
        return result(candidate, evaluatedAt, [accountReasonCode(accountResult.reason)], accountResult.resolvedAccount, accountResult.moveChain);
      }
      if (accountResult.resolvedAccount === undefined) {
        return result(candidate, evaluatedAt, ["account_unresolved"], undefined, accountResult.moveChain);
      }
      resolvedAccount = accountResult.resolvedAccount;
      moveChain = accountResult.moveChain;
    } catch (error) {
      assertNotAborted(input.signal);
      void error;
      return result(candidate, evaluatedAt, ["account_unresolved"]);
    }

    const accountContext = policyContext(candidate, evaluatedAt, input.signal, resolvedAccount, moveChain) as
      RecommendationCandidatePolicyEvaluationContext & { resolvedAccount: RecommendationAccountProfile };
    const accountPolicy = await evaluateResolvedAccountPolicySafely(evidence.evaluateResolvedAccountPolicy, accountContext);
    if (!accountPolicy.evidenceComplete) {
      return result(candidate, evaluatedAt, ["account_policy_incomplete"], resolvedAccount, moveChain);
    }
    if (accountPolicy.restrictions.length > 0) {
      return result(
        candidate,
        evaluatedAt,
        accountPolicy.restrictions.map(accountRestrictionReasonCode),
        resolvedAccount,
        moveChain
      );
    }
  }

  const context = policyContext(candidate, evaluatedAt, input.signal, resolvedAccount, moveChain);
  const providerPolicy = await evaluateProviderPolicySafely(input.evaluateProviderPolicy, context);
  if (!providerPolicy.evidenceComplete) {
    return result(candidate, evaluatedAt, ["provider_policy_incomplete"], resolvedAccount, moveChain);
  }
  if (!providerPolicy.allowed) {
    return result(candidate, evaluatedAt, ["provider_policy_denied"], resolvedAccount, moveChain);
  }

  const viewerSafety = await evaluateViewerSafetySafely(input.evaluateViewerSafety, context);
  if (!viewerSafety.evidenceComplete) {
    return result(candidate, evaluatedAt, ["viewer_safety_incomplete"], resolvedAccount, moveChain);
  }
  if (!viewerSafety.eligible) {
    return result(candidate, evaluatedAt, ["viewer_safety_denied"], resolvedAccount, moveChain);
  }

  return result(candidate, evaluatedAt, [], resolvedAccount, moveChain);
}
