// Plain-data view models. They return strings and objects, never markup, so any UI can render them.
// The copy lives in the tables at the top. Replace the tables to change or translate the wording.
// Messages are looked up by key and filled in with named values, not built by joining fragments.
import type {
  RecommendationCandidate,
  RecommendationCandidateActionPlan,
  RecommendationCandidatePlanAssessment,
  RecommendationCatalogIndex,
  RecommendationEvidenceVerification,
  RecommendationFirstSessionRecommendation,
  RecommendationFirstSessionResult,
  RecommendationOnboardingSelectionRecord
} from "../src/index.js";

export const REASON_COPY = Object.freeze({
  picked_topic_and_set: "Suggested because you picked {topic}, and this account is in a collection about it.",
  picked_topic: "Suggested because you picked {topic}.",
  directory_hint_topic: "A directory suggested this account for {topic}. We have not checked it.",
  curated_set: "This account is in a collection by {curator}.",
  directory_hint: "A directory suggested this account. We have not checked it.",
  generic: "Matches your interests."
} as const);
export type ReasonCopyKey = keyof typeof REASON_COPY;

export interface RecommendationReason {
  copyKey: ReasonCopyKey;
  /** Values for the placeholders in the copy, such as `{topic}`. */
  values: Readonly<Record<string, string>>;
  text: string;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (_match, name: string) => values[name] ?? "");
}

/** A candidate relates to a picked topic when it names the topic itself or one of the topic's tags. */
function matchesTopic(candidate: RecommendationCandidate, topicId: string, catalog: RecommendationCatalogIndex): boolean {
  if (candidate.metadata.canonicalInterestIds.includes(topicId)) return true;
  const tags = catalog.canonicalTagIdsByTopicId.get(topicId) ?? [];
  return candidate.metadata.tags.some((tag) => tags.includes(tag));
}

/**
 * Builds the reason from the candidate's provenance and the user's own picks, because the engine's
 * `explanation.summary` is generic and does not name them. If neither source gives a reason it says
 * less instead of making one up.
 */
export function explainRecommendation(
  recommendation: Pick<RecommendationFirstSessionRecommendation, "candidate">,
  selection: Pick<RecommendationOnboardingSelectionRecord, "selectedTopicIds">,
  catalog: RecommendationCatalogIndex
): RecommendationReason {
  const { candidate } = recommendation;
  const pickedTopics = selection.selectedTopicIds
    .filter((id) => matchesTopic(candidate, id, catalog))
    .map((id) => catalog.topicsById.get(id)?.label ?? id);
  const curated = candidate.provenance.find((item) => item.kind === "curated_account_set" || item.kind === "starter_pack");
  const hintOnly = candidate.provenance.length > 0 && candidate.provenance.every((item) => item.kind === "third_party_directory_hint");
  const topic = pickedTopics[0];

  let copyKey: ReasonCopyKey = "generic";
  let values: Record<string, string> = {};
  if (topic !== undefined && hintOnly) { copyKey = "directory_hint_topic"; values = { topic }; }
  else if (topic !== undefined && curated !== undefined) { copyKey = "picked_topic_and_set"; values = { topic }; }
  else if (topic !== undefined) { copyKey = "picked_topic"; values = { topic }; }
  else if (curated?.curator !== undefined) { copyKey = "curated_set"; values = { curator: curated.curator }; }
  else if (hintOnly) copyKey = "directory_hint";
  return Object.freeze({ copyKey, values: Object.freeze(values), text: fill(REASON_COPY[copyKey], values) });
}

export const EVIDENCE_COPY = Object.freeze({
  unverified: "Not checked. This comes from what the source told us.",
  app_vouched: "Included from a collection this app vouches for. It was not independently checked.",
  authority_verified: "Confirmed with {authority}.",
  canonical: "Part of the built-in catalog."
} as const);

/**
 * `checked`: the provider or the protocol confirmed it. `app_vouched`: the app itself stands behind it and
 * nothing was checked independently. `not_checked`: only what the source said.
 */
export type EvidenceLevel = "checked" | "app_vouched" | "not_checked";

export interface EvidenceDisplay {
  /** Only true when something was actually checked. A UI must not show a check mark when this is false. */
  showVerifiedBadge: boolean;
  level: EvidenceLevel;
  state: RecommendationCandidate["verification"]["state"];
  text: string;
}

/**
 * What to say about how much we know about a candidate. Default to the cautious wording.
 * `appVouched` is for candidates the app itself marked as confirmed, such as the curated-set wrapper in
 * the onboarding flow. The state on such a candidate says `authority_verified`, but nobody checked, so it
 * never gets the badge, whatever its state says.
 */
export function describeCandidateEvidence(candidate: RecommendationCandidate, options: { appVouched?: boolean } = {}): EvidenceDisplay {
  const { state, authority } = candidate.verification;
  if (options.appVouched === true) return Object.freeze({ showVerifiedBadge: false, level: "app_vouched" as const, state, text: EVIDENCE_COPY.app_vouched });
  if (state === "authority_verified" && authority !== undefined) {
    return Object.freeze({ showVerifiedBadge: true, level: "checked" as const, state, text: fill(EVIDENCE_COPY.authority_verified, { authority }) });
  }
  if (state === "canonical") return Object.freeze({ showVerifiedBadge: true, level: "checked" as const, state, text: EVIDENCE_COPY.canonical });
  return Object.freeze({ showVerifiedBadge: false, level: "not_checked" as const, state, text: EVIDENCE_COPY.unverified });
}

export const EVENT_EVIDENCE_COPY = Object.freeze({
  unverified: "This report was not checked.",
  partial: "Some of this report was checked.",
  verified: "This report was checked."
} as const);

/** The same idea for candidate events: `verified` is only claimed when the lifecycle's verifier says so. */
export function describeEventEvidence(result: Pick<RecommendationEvidenceVerification, "evidenceVerification">): { showVerifiedBadge: boolean; text: string } {
  const state = result.evidenceVerification;
  return Object.freeze({ showVerifiedBadge: state === "verified", text: EVENT_EVIDENCE_COPY[state] });
}

export const SESSION_STATE_COPY = Object.freeze({
  no_picks: "Pick a few topics to get suggestions.",
  nothing_found: "We couldn't find suggestions for these topics yet. Try another topic.",
  none_eligible: "We found some, but none are available to suggest right now.",
  partial: "Some sources didn't respond, so this list may be short. Try again later.",
  all_failed: "We couldn't reach any source. Your picks are saved.",
  ready: ""
} as const);
export type SessionStateKey = keyof typeof SESSION_STATE_COPY;

export interface SessionStateView {
  state: SessionStateKey;
  text: string;
  recommendationCount: number;
}

/** Turns the first-session counts into the state a screen should show. Order matters: the first match wins. */
export function describeSessionState(result: RecommendationFirstSessionResult): SessionStateView {
  const count = result.recommendations.length;
  const failed = result.sourceFailures.length > 0;
  let state: SessionStateKey;
  if (result.profileSignalCount === 0) state = "no_picks";
  else if (count > 0 && (failed || result.eligibilityFailureCount > 0)) state = "partial";
  else if (count > 0) state = "ready";
  else if (failed) state = "all_failed";
  else if (result.discoveredCandidateCount === 0) state = "nothing_found";
  else if (result.eligibleCandidateCount === 0) state = "none_eligible";
  else state = "nothing_found";
  return Object.freeze({ state, text: SESSION_STATE_COPY[state], recommendationCount: count });
}

export const PLAN_COPY = Object.freeze({
  follow_account: "Follow {name}",
  expand_starter_pack: "Follow these {count} accounts from {name}",
  other: "{name}"
} as const);

export interface PlanView {
  action: RecommendationCandidateActionPlan["action"];
  title: string;
  /** Account URIs the user will see and can untick before confirming. Empty for a single-item plan. */
  memberTargets: readonly string[];
  /** Always true. The plan is a proposal until the user confirms it. */
  needsConfirmation: true;
  /** Set when the plan can no longer be confirmed. The UI should offer a refresh. */
  blockedReason: string | undefined;
}

export const PLAN_BLOCKED_COPY = Object.freeze({
  stale: "This suggestion is out of date. Refresh to see what is current.",
  invalid: "Something this suggestion relied on has changed. Refresh to see what is current."
} as const);

/** What to show before the user confirms. Pass the latest assessment so a stale plan is marked. */
export function describePlan(plan: RecommendationCandidateActionPlan, assessment?: Pick<RecommendationCandidatePlanAssessment, "state">): PlanView {
  const name = plan.candidate.metadata.displayName ?? plan.candidate.nativeId;
  const memberTargets = (plan.members ?? []).map((member) => member.accountUri);
  const template = plan.action === "follow_account" ? PLAN_COPY.follow_account : plan.action === "expand_starter_pack" ? PLAN_COPY.expand_starter_pack : PLAN_COPY.other;
  const title = fill(template, { name, count: String(memberTargets.length) });
  const blockedReason = assessment === undefined || assessment.state === "valid" ? undefined : PLAN_BLOCKED_COPY[assessment.state];
  return Object.freeze({ action: plan.action, title, memberTargets: Object.freeze(memberTargets), needsConfirmation: true as const, blockedReason });
}
