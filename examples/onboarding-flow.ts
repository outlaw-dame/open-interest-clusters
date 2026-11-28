// The onboarding flow, wired from the public API only. Each method is one step an app screen would call.
// Nothing here follows, subscribes or joins on its own: `confirm` is the only place a provider is
// contacted, it needs an explicit yes, and it checks the plan again first.
import {
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  createInMemoryRecommendationCandidateEventStore,
  createInMemoryRecommendationProfileSignalReplacementStore,
  createRecommendationCandidateActionPlan,
  createRecommendationCatalogIndex,
  createRecommendationCuratedAccountSetCandidateSourceAdapter,
  createRecommendationDerivedStateInvalidationOrchestrator,
  createRecommendationEngineOrchestrator,
  createRecommendationFirstSessionOrchestrator,
  createRecommendationOnboardingLifecycle,
  createRecommendationOnboardingSelection,
  deleteRecommendationProfileStoreRecord,
  diffRecommendationCuratedAccountSet,
  evaluateRecommendationCandidateEligibility,
  readRecommendationCandidateSourceAdapter,
  recommendationProviderCapabilityState,
  writeRecommendationProfileStoreRecord,
  type RecommendationAccountProfileResolver,
  type RecommendationCandidate,
  type RecommendationCandidateActionPlan,
  type RecommendationCandidateEligibilityResult,
  type RecommendationCandidateEventStore,
  type RecommendationCandidateKind,
  type RecommendationCandidateSourceAdapter,
  type RecommendationConsentPolicy,
  type RecommendationCuratedAccountSet,
  type RecommendationCuratedAccountSetFreshRead,
  type RecommendationDerivedStateInvalidationTask,
  type RecommendationDerivedStateTarget,
  type RecommendationFirstSessionRecommendation,
  type RecommendationFirstSessionResult,
  type RecommendationOnboardingLifecycleWithCandidateEvents,
  type RecommendationOnboardingSelectionRecord,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProviderDescriptor,
  type RecommendationStarterPackMemberInput
} from "../src/index.js";
import type { ReferenceClock, ReferenceProviderService } from "./fakes.js";
import {
  describeCandidateEvidence,
  describePlan,
  describeSessionState,
  explainRecommendation,
  type EvidenceDisplay,
  type PlanView,
  type RecommendationReason,
  type SessionStateView
} from "./view-models.js";

export type ReferenceConfirmationFailure =
  | "not_confirmed"
  | "plan_stale"
  | "plan_invalid"
  | "capability_expired"
  | "eligibility_changed"
  | "no_consent"
  | "already_confirmed"
  | "provider_failed";

/** Thrown when a plan is not carried out. `reason` says why, and for everything but `provider_failed` nothing was sent. */
export class ReferenceConfirmationError extends Error {
  constructor(readonly reason: ReferenceConfirmationFailure, options?: { cause?: unknown }) {
    super(`The plan was not carried out: ${reason}.`, options);
    this.name = "ReferenceConfirmationError";
  }
}

/** Where a selection says it is kept. This is a different list from the `local_app` and `user_pod` the persistence transition takes. */
export type ReferenceSelectionTarget = "local_app" | "activitypods_pod";

export interface ReferenceOnboardingOptions {
  subjectId: string;
  clock: ReferenceClock;
  /** The candidate sources the app trusts to read from. */
  sources?: readonly RecommendationCandidateSourceAdapter[];
  /** Curated sets (for example Mastodon Collections) the app has read and accepted. Their members are only suggested if they accepted. */
  curatedSets?: readonly RecommendationCuratedAccountSet[];
  /** The app's own lookup of an account at its provider. The fake one records what it is asked. */
  resolver: RecommendationAccountProfileResolver;
  provider: ReferenceProviderService;
  /** Called each time a plan is made or revalidated, so a test can expire it. */
  describeProvider: () => RecommendationProviderDescriptor;
  candidateEventStore?: RecommendationCandidateEventStore;
  /** Device by default. Use `markMoved` after the profile has been moved to a pod. */
  storageTarget?: ReferenceSelectionTarget;
}

export interface ReferenceRecommendationItem {
  recommendation: RecommendationFirstSessionRecommendation;
  reason: RecommendationReason;
  evidence: EvidenceDisplay;
}

export interface ReferenceRecommendationView {
  result: RecommendationFirstSessionResult;
  session: SessionStateView;
  items: readonly ReferenceRecommendationItem[];
  excludedCandidateIds: readonly string[];
  excludedSetSourceIds: readonly string[];
}

export interface ReferencePlan {
  plan: RecommendationCandidateActionPlan;
  view: PlanView;
  /** Pack members left out because they are not eligible right now. */
  leftOutCandidateIds: readonly string[];
}

export interface ReferenceConfirmationResult {
  requested: readonly string[];
  applied: readonly string[];
}

const NO_OP_INVALIDATOR = { async invalidate() { /* This reference keeps no candidate or embedding caches to clear. */ } };
const INVALIDATORS: Record<RecommendationDerivedStateTarget, typeof NO_OP_INVALIDATOR> = {
  embeddings: NO_OP_INVALIDATOR,
  candidate_cache: NO_OP_INVALIDATOR,
  explanation_cache: NO_OP_INVALIDATOR
};
const CANDIDATE_KINDS: readonly RecommendationCandidateKind[] = ["account", "starter_pack"];
const PACK_READ_LIMIT = 500;
const NO_SELECTION = Object.freeze({ selectedTopicIds: Object.freeze([]) });

/**
 * The app's decision that a candidate read from its own provider's collections counts as confirmed by
 * that provider. The library does not check this. The eligibility step still resolves every account.
 */
function confirmedByProvider(candidate: RecommendationCandidate, at: string): RecommendationCandidate {
  if (candidate.provider === undefined) return candidate;
  return { ...candidate, verification: { state: "authority_verified", authority: candidate.provider, verifiedAt: at }, availability: "available" };
}

export function createReferenceOnboarding(options: ReferenceOnboardingOptions) {
  const { subjectId, clock, resolver, provider } = options;
  const catalog = createRecommendationCatalogIndex(RECOMMENDATION_GLOBAL_CATALOG_V1);
  const curatedSets = options.curatedSets ?? [];
  let storageTarget: ReferenceSelectionTarget = options.storageTarget ?? "local_app";
  let policy: RecommendationConsentPolicy = { subjectId, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"] };
  let selection: RecommendationOnboardingSelectionRecord | undefined;
  const eventStore = options.candidateEventStore ?? createInMemoryRecommendationCandidateEventStore();

  // The store has to accept `server_allowed` labels for edits after a move to a pod. Consent still decides
  // whether such a label may be written: the lifecycle refuses it without the user's server-side consent.
  const engine = createRecommendationEngineOrchestrator({ profileStore: createInMemoryRecommendationProfileSignalReplacementStore({ allowedPrivacyBoundaries: ["local_only", "server_allowed"] }), allowEmptySubjectInitialization: true, now: clock.now });
  const tasks = new Map<string, RecommendationDerivedStateInvalidationTask>();
  const derived = createRecommendationDerivedStateInvalidationOrchestrator({
    engine,
    taskStore: { async load(id) { return tasks.get(id); }, async save(task) { tasks.set(task.subjectId, task); }, async delete(id) { tasks.delete(id); } },
    now: clock.now,
    invalidators: INVALIDATORS
  });

  // Curated-set accounts and packs are read as `source_asserted`. Eligibility refuses those, so the app
  // marks them confirmed first. See `confirmedByProvider`. A curated source may not return confirmed
  // candidates, so the wrapper is declared as the provider's own source: that is the app vouching.
  const curatedAdapter = createRecommendationCuratedAccountSetCandidateSourceAdapter({ id: "reference.curated-sets", sets: curatedSets });
  const confirmedCurated: RecommendationCandidateSourceAdapter = {
    ...curatedAdapter,
    authority: "provider_native",
    capabilities: [...curatedAdapter.capabilities, "returns_authority_verified_identity"],
    async read(query) {
      const read = await curatedAdapter.read(query);
      return { ...read, candidates: read.candidates.map((candidate) => confirmedByProvider(candidate, clock.now())) };
    }
  };

  function acceptedMemberCount(candidate: RecommendationCandidate): number {
    const set = curatedSets.find((item) => item.url === candidate.nativeId);
    return set === undefined ? 0 : set.members.filter((member) => member.state === "accepted").length;
  }

  /** The one eligibility function used for the first session, for plans and for revalidating a plan. */
  async function evaluateEligibility(candidate: RecommendationCandidate, signal?: AbortSignal): Promise<RecommendationCandidateEligibilityResult> {
    const common = {
      candidate,
      evaluatedAt: clock.now(),
      evaluateProviderPolicy: () => ({ allowed: true, evidenceComplete: true }),
      evaluateViewerSafety: () => ({ eligible: true, evidenceComplete: true }),
      ...(signal === undefined ? {} : { signal })
    };
    if (candidate.kind === "starter_pack") {
      return evaluateRecommendationCandidateEligibility({ ...common, evidence: { kind: "starter_pack", resolvable: true, current: true, available: true, memberCount: acceptedMemberCount(candidate) } });
    }
    if (candidate.kind === "account") {
      return evaluateRecommendationCandidateEligibility({
        ...common,
        evidence: { kind: "account", resolver, identityBindingVerified: true, evaluateResolvedAccountPolicy: () => ({ restrictions: [], evidenceComplete: true }) }
      });
    }
    throw new TypeError(`The reference does not evaluate ${candidate.kind} candidates.`);
  }

  const sources = [...(options.sources ?? []), confirmedCurated];
  const firstSession = createRecommendationFirstSessionOrchestrator({
    engine,
    sources,
    candidateKinds: CANDIDATE_KINDS,
    evaluateEligibility: ({ candidate, signal }) => evaluateEligibility(candidate.candidate, signal)
  });
  const lifecycle: RecommendationOnboardingLifecycleWithCandidateEvents = createRecommendationOnboardingLifecycle({
    derived,
    engine,
    firstSession,
    now: clock.now,
    candidateEvents: { store: eventStore }
  });

  /** Plans already carried out, or being carried out right now. */
  const claimedPlans = new WeakSet<RecommendationCandidateActionPlan>();

  async function carryOut(plan: RecommendationCandidateActionPlan, answer: { excludeMemberCandidateIds?: readonly string[] }): Promise<ReferenceConfirmationResult> {
    if (policy.revokedAt !== undefined || policy.allowedDataUses.length === 0) throw new ReferenceConfirmationError("no_consent");
    const assessment = await lifecycle.assessPlan({ subjectId, plan, policy, now: clock.now() });
    if (assessment.state === "stale") throw new ReferenceConfirmationError("plan_stale");
    if (assessment.state === "invalid") throw new ReferenceConfirmationError("plan_invalid");
    await revalidate(plan);
    const skipped = new Set(answer.excludeMemberCandidateIds ?? []);
    const members = (plan.members ?? []).filter((member) => !skipped.has(member.candidateId));
    const request = plan.members === undefined
      ? { action: plan.action, providerId: plan.candidate.provider ?? "", candidateIds: [plan.candidate.candidateId], targets: [plan.candidate.nativeId] }
      : { action: plan.action, providerId: plan.candidate.provider ?? "", candidateIds: members.map((member) => member.candidateId), targets: members.map((member) => member.accountUri) };
    try {
      const { applied } = await provider.mutate(request);
      return { requested: request.targets, applied };
    } catch (error) {
      throw new ReferenceConfirmationError("provider_failed", { cause: error });
    }
  }

  async function revalidate(plan: RecommendationCandidateActionPlan): Promise<void> {
    if (Date.parse(plan.providerCapabilitiesExpireAt) <= Date.parse(clock.now())) throw new ReferenceConfirmationError("capability_expired");
    // Ask again what the provider can do now. The plan only remembers what it could do when it was made.
    const current = options.describeProvider();
    const capability = plan.candidate.kind === "starter_pack" ? "starter_packs" : "follows";
    if (current.providerId !== plan.candidate.provider || Date.parse(current.expiresAt) <= Date.parse(clock.now()) || recommendationProviderCapabilityState(current, capability, plan.candidate.protocol) !== "supported") {
      throw new ReferenceConfirmationError("capability_expired");
    }
    // The candidates are checked again at the provider, not taken from the plan.
    const targets = plan.members === undefined ? [plan.candidate] : await membersFor(plan);
    for (const candidate of targets) {
      const result = await evaluateEligibility(candidate);
      if (!result.eligible) throw new ReferenceConfirmationError("eligibility_changed");
    }
  }

  async function curatedCandidates(): Promise<readonly RecommendationCandidate[]> {
    const read = await readRecommendationCandidateSourceAdapter(confirmedCurated, { requestId: "reference-plan", candidateKinds: CANDIDATE_KINDS, canonicalInterestIds: [], limit: PACK_READ_LIMIT });
    return read.candidates;
  }

  async function membersFor(plan: RecommendationCandidateActionPlan): Promise<readonly RecommendationCandidate[]> {
    const wanted = new Set((plan.members ?? []).map((member) => member.candidateId));
    return (await curatedCandidates()).filter((candidate) => wanted.has(candidate.candidateId));
  }

  async function starterPackMembers(pack: RecommendationCandidate): Promise<{ members: RecommendationStarterPackMemberInput[]; leftOut: string[] }> {
    const set = curatedSets.find((item) => item.url === pack.nativeId);
    if (set === undefined) throw new Error("The reference has no curated set for this pack.");
    const accepted = new Set(set.members.filter((member) => member.state === "accepted").map((member) => member.accountUri));
    const members: RecommendationStarterPackMemberInput[] = [];
    const leftOut: string[] = [];
    for (const account of (await curatedCandidates()).filter((candidate) => candidate.kind === "account" && accepted.has(candidate.nativeId))) {
      const eligibility = await evaluateEligibility(account);
      if (!eligibility.eligible) { leftOut.push(account.candidateId); continue; }
      members.push({ eligibility, consent: { state: "accepted", setProvider: set.provider, setId: set.id, observedAt: set.observedAt } });
    }
    return { members, leftOut };
  }

  return {
    subjectId,
    lifecycle,
    engine,
    derived,
    catalog,
    eventStore,
    /** The consent the app holds for this subject right now. */
    policy: (): RecommendationConsentPolicy => policy,
    /** Adds the user's server-side consent. Needed before the profile may go to a pod. */
    allowServerSideProcessing(): void {
      policy = { ...policy, serverSideDataUses: ["local_personalization"] };
    },
    /** Call after the profile has been moved, so later edits use the matching target. */
    markMoved(target: ReferenceSelectionTarget): void { storageTarget = target; },

    /** Steps 1 and 2: the user's picks become live onboarding signals. Repeating the same picks writes nothing. */
    async select(topicIds: readonly string[], extra: { tagIds?: readonly string[]; allowSensitiveTopics?: boolean } = {}) {
      selection = createRecommendationOnboardingSelection({
        catalog: RECOMMENDATION_GLOBAL_CATALOG_V1,
        selectedTopicIds: topicIds,
        selectedCanonicalTagIds: extra.tagIds ?? [],
        allowAutoFollowHashtags: false,
        selectedAt: clock.now(),
        storageTarget
      });
      return lifecycle.applySelection({
        subjectId,
        catalogIndex: catalog,
        selection,
        policy,
        now: clock.now(),
        ...(extra.allowSensitiveTopics === true ? { allowSensitiveSelections: true } : {})
      });
    },

    /** Steps 3 and 4: first-session recommendations, each with a reason built from provenance. */
    async recommend(requestId: string, extra: { candidateEvents?: Parameters<typeof lifecycle.refresh>[0]["candidateEvents"]; excludeCandidateIds?: readonly string[]; signal?: AbortSignal } = {}): Promise<ReferenceRecommendationView> {
      const refreshed = await lifecycle.refresh({
        request: { subjectId, requestId, languages: ["en"], limit: 20, ...(extra.excludeCandidateIds === undefined ? {} : { excludeCandidateIds: extra.excludeCandidateIds }), ...(extra.signal === undefined ? {} : { signal: extra.signal }) },
        policy,
        now: clock.now(),
        ...(extra.candidateEvents === undefined ? {} : { candidateEvents: extra.candidateEvents })
      });
      const current = selection;
      const items = refreshed.result.recommendations.map((recommendation) => ({
        recommendation,
        reason: explainRecommendation(recommendation, current ?? NO_SELECTION, catalog),
        evidence: describeCandidateEvidence(recommendation.candidate)
      }));
      return { result: refreshed.result, session: describeSessionState(refreshed.result), items, excludedCandidateIds: refreshed.excludedCandidateIds, excludedSetSourceIds: refreshed.excludedSetSourceIds };
    },

    /** Step 5: a frozen plan for one candidate. It cannot run by itself. */
    async plan(candidate: RecommendationCandidate): Promise<ReferencePlan> {
      const createdAt = clock.now();
      const eligibility = await evaluateEligibility(candidate);
      const base = { candidate, eligibility, provider: options.describeProvider(), createdAt };
      const pack = candidate.kind === "starter_pack" ? await starterPackMembers(candidate) : undefined;
      const plan = createRecommendationCandidateActionPlan(pack === undefined ? base : { ...base, starterPackMembers: pack.members });
      const assessment = await lifecycle.assessPlan({ subjectId, plan, policy, now: clock.now() });
      return { plan, view: describePlan(plan, assessment), leftOutCandidateIds: pack?.leftOut ?? [] };
    },

    /**
     * Step 5, the other half. Without `confirmed: true` nothing happens. With it, the plan is assessed
     * against reported events, the capability window and eligibility are checked again, and only then
     * does the provider get a request. A failed mutation is reported, not retried, because the user
     * should decide whether to try again.
     */
    async confirm(plan: RecommendationCandidateActionPlan, answer: { confirmed: boolean; excludeMemberCandidateIds?: readonly string[] }): Promise<ReferenceConfirmationResult> {
      if (answer.confirmed !== true) throw new ReferenceConfirmationError("not_confirmed");
      // A plan is carried out once. It is claimed before any await so a double tap cannot slip through,
      // and released again if the attempt fails, so the user can choose to try again.
      if (claimedPlans.has(plan)) throw new ReferenceConfirmationError("already_confirmed");
      claimedPlans.add(plan);
      try {
        return await carryOut(plan, answer);
      } catch (error) {
        claimedPlans.delete(plan);
        throw error;
      }
    },


    /** Step 6: compare the set as last accepted with a fresh read, and report anything that got worse. */
    async reportSetChange(previous: RecommendationCuratedAccountSet, fresh: RecommendationCuratedAccountSetFreshRead) {
      const report = diffRecommendationCuratedAccountSet({ subjectId, previous, fresh });
      const reported = await lifecycle.reportCandidateEvents({ subjectId, events: report.events, policy, now: clock.now() });
      return { report, reported };
    },

    /** "Clear my interests" or "I no longer agree". The second one also clears stored candidate events. */
    withdraw(reason: "source_retracted" | "consent_revoked") {
      if (reason === "consent_revoked") policy = { ...policy, allowedDataUses: [], privateDataUses: [], serverSideDataUses: [], revokedAt: clock.now() };
      selection = undefined;
      return lifecycle.withdrawSelections({ subjectId, reason, now: clock.now() });
    },

    /** Saves the profile through a persistence adapter. Use the one for the placement the user chose. */
    async persistProfile(adapter: RecommendationProfilePersistenceAdapter) {
      return writeRecommendationProfileStoreRecord(adapter, { subjectId, profile: await engine.readProfile(subjectId), writtenAt: clock.now() });
    },

    /** "Delete everything": the derived profile, history and stored events, plus the copy in each adapter given. */
    async deleteEverything(adapters: readonly RecommendationProfilePersistenceAdapter[]) {
      const requestedAt = clock.now();
      const deletion = await derived.deleteSubject({ subjectId, requestedAt, scope: "recommendation_derived_data", targets: ["profile", "event_history"] });
      for (const adapter of adapters) {
        await deleteRecommendationProfileStoreRecord(adapter, { intent: { subjectId, requestedAt, scope: "recommendation_derived_data", targets: ["profile"] } });
      }
      selection = undefined;
      return deletion;
    }
  };
}

export type ReferenceOnboarding = ReturnType<typeof createReferenceOnboarding>;
