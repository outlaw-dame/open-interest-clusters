import {
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentPolicy,
  type RecommendationDataUse,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
} from "./consent.js";
import {
  requireRecommendationConsent,
  type RecommendationConsentEnforcementOptions
} from "./consent-enforcement.js";
import {
  RECOMMENDATION_ONBOARDING_SELECTION_SCHEMA_VERSION,
  createRecommendationOnboardingSelection,
  type RecommendationOnboardingSelectionRecord
} from "./catalog.js";
import {
  findRecommendationCanonicalTagInIndex,
  findRecommendationCatalogTopicInIndex,
  type RecommendationCatalogIndex
} from "./catalog-index.js";
import {
  normalizeRecommendationInterestSignal,
  type RecommendationInterestEvidence,
  type RecommendationInterestPrivacyBoundary,
  type RecommendationInterestSignal,
  type RecommendationInterestSignalInput
} from "./interest-signal.js";
import {
  createInMemoryRecommendationProfileStore,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStore
} from "./profile-store.js";
import type { RecommendationSourceTrustBoundary } from "./source-adapter.js";

export const RECOMMENDATION_ONBOARDING_PROFILE_SEED_SCHEMA_VERSION = "recommendation-onboarding-profile-seed.v1" as const;

export interface RecommendationOnboardingProfileSeedInput {
  subjectId: string;
  catalogIndex: RecommendationCatalogIndex;
  selection: RecommendationOnboardingSelectionRecord;
  policy: RecommendationConsentPolicy | null | undefined;
  dataUse?: RecommendationDataUse;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  observedAt?: string;
  expiresAt?: string;
  profileStore?: RecommendationProfileStore;
  enforcementOptions?: RecommendationConsentEnforcementOptions;
  allowSensitiveSelections?: boolean;
}

export interface RecommendationOnboardingProfileSeedResult {
  schemaVersion: typeof RECOMMENDATION_ONBOARDING_PROFILE_SEED_SCHEMA_VERSION;
  signalCount: number;
  canonicalInterestSignalCount: number;
  hashtagSignalCount: number;
  profile: RecommendationProfileSnapshot;
  signals: readonly RecommendationInterestSignal[];
  consent: PrivacySafeRecommendationConsentEvent;
}

interface OnboardingSignalAccumulator {
  signals: RecommendationInterestSignal[];
  canonicalInterestSignalCount: number;
  hashtagSignalCount: number;
}

type OnboardingSignalBucket = "canonical_interest" | "hashtag";

const DEFAULT_DATA_USE: RecommendationDataUse = "local_personalization";
const DEFAULT_PRIVACY_BOUNDARY: RecommendationInterestPrivacyBoundary = "local_only";
const ONBOARDING_EVIDENCE_PROTOCOL: RecommendationProtocol = "app_local";
const ONBOARDING_EVIDENCE_VISIBILITY: RecommendationSourceVisibility = "local_only";
const ONBOARDING_TRUST_BOUNDARY: RecommendationSourceTrustBoundary = "user_owned";
const USER_OWNED_POD_PREFERENCE_TARGETS: ReadonlySet<string> = new Set(["activitypods_pod", "solid_pod"]);
/** A private space on the user's own PDS. There is deliberately no target for a public repo. */
const USER_OWNED_ATPROTO_SPACE_PREFERENCE_TARGET = "atproto_private_space";
const MAX_SUBJECT_ID_LENGTH = 512;
const MAX_SIGNAL_COUNT = 10_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSubjectId(value: unknown): asserts value is string {
  if (
    !isNonEmptyString(value) ||
    value.length > MAX_SUBJECT_ID_LENGTH ||
    /[\x00-\x1F\x7F]/u.test(value)
  ) {
    throw new TypeError("Invalid recommendation onboarding profile subject id.");
  }
}

function assertTimestamp(value: string, message: string): string {
  if (!isNonEmptyString(value) || value.trim() !== value || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(message);
  }

  return value;
}

function optionalTimestamp(value: string | undefined, fallback: string, message: string): string {
  if (value === undefined) {
    return fallback;
  }

  return assertTimestamp(value, message);
}

function assertExpiresAt(value: string | undefined, observedAt: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const expiresAt = assertTimestamp(value, "Invalid recommendation onboarding profile seed expiration timestamp.");
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) {
    throw new TypeError("Invalid recommendation onboarding profile seed expiration timestamp.");
  }

  return expiresAt;
}

function assertSubjectLevelPrivacyBoundary(privacyBoundary: RecommendationInterestPrivacyBoundary): void {
  if (privacyBoundary === "aggregate_only") {
    throw new TypeError("Recommendation onboarding profile seed cannot create subject-level aggregate-only profile state.");
  }
}

function isUserOwnedServerTarget(storageTarget: string): boolean {
  return USER_OWNED_POD_PREFERENCE_TARGETS.has(storageTarget) || storageTarget === USER_OWNED_ATPROTO_SPACE_PREFERENCE_TARGET;
}

/**
 * With no explicit choice, a selection kept in the user's own pod is labelled `server_allowed` and
 * anything else `local_only`. An explicit `local_only` for a pod selection is refused rather than
 * rewritten: the label has to say where the interests are processed.
 */
function resolvePrivacyBoundary(
  explicit: RecommendationInterestPrivacyBoundary | undefined,
  selection: RecommendationOnboardingSelectionRecord
): RecommendationInterestPrivacyBoundary {
  const inUserPod = isUserOwnedServerTarget(selection.storageTarget);
  if (explicit === undefined) return inUserPod ? "server_allowed" : DEFAULT_PRIVACY_BOUNDARY;
  if (inUserPod && explicit === "local_only") {
    throw new TypeError("Recommendation onboarding profile seed for a user-owned pod or space must use the server_allowed privacy boundary.");
  }
  return explicit;
}

/**
 * Where the selection is kept decides what the evidence says. A selection kept on the device is app-local
 * owner evidence. A selection kept in the user's own pod is evidence read from that pod under the user's
 * own access control (a private ATProto space on the user's PDS gets the matching ATProto evidence), which is the only server-side evidence the signal policy accepts for
 * `server_allowed` interests. Any other pairing keeps the app-local evidence, so the policy refuses it.
 */
function createOnboardingEvidence(
  observedAt: string,
  privacyBoundary: RecommendationInterestPrivacyBoundary,
  selection: RecommendationOnboardingSelectionRecord
): RecommendationInterestEvidence {
  if (privacyBoundary === "server_allowed" && selection.storageTarget === USER_OWNED_ATPROTO_SPACE_PREFERENCE_TARGET) {
    return Object.freeze({
      sourceItemKind: "collection",
      protocol: "atproto",
      sourceVisibility: "atproto_private_space",
      accessBasis: "atproto_space_authority",
      trustBoundary: ONBOARDING_TRUST_BOUNDARY,
      observedAt
    });
  }
  if (privacyBoundary === "server_allowed" && USER_OWNED_POD_PREFERENCE_TARGETS.has(selection.storageTarget)) {
    return Object.freeze({
      sourceItemKind: "collection",
      protocol: "activitypods",
      sourceVisibility: "acl_controlled",
      accessBasis: "solid_acl_control",
      trustBoundary: ONBOARDING_TRUST_BOUNDARY,
      observedAt
    });
  }
  return Object.freeze({
    sourceItemKind: "collection",
    protocol: ONBOARDING_EVIDENCE_PROTOCOL,
    sourceVisibility: ONBOARDING_EVIDENCE_VISIBILITY,
    accessBasis: "owner",
    trustBoundary: ONBOARDING_TRUST_BOUNDARY,
    observedAt
  });
}

function selectionForCatalogIndex(
  catalogIndex: RecommendationCatalogIndex,
  selection: RecommendationOnboardingSelectionRecord
): RecommendationOnboardingSelectionRecord {
  if (!isObject(catalogIndex) || !isObject(selection) || selection.schemaVersion !== RECOMMENDATION_ONBOARDING_SELECTION_SCHEMA_VERSION) {
    throw new TypeError("Invalid recommendation onboarding selection record.");
  }

  return createRecommendationOnboardingSelection({
    catalog: catalogIndex.catalog,
    selectedTopicIds: selection.selectedTopicIds,
    selectedCanonicalTagIds: selection.selectedCanonicalTagIds,
    allowAutoFollowHashtags: selection.allowAutoFollowHashtags,
    selectedAt: selection.selectedAt,
    storageTarget: selection.storageTarget
  });
}

function createSignal(input: RecommendationInterestSignalInput, expiresAt: string | undefined): RecommendationInterestSignal {
  if (expiresAt === undefined) {
    return normalizeRecommendationInterestSignal(input);
  }

  return normalizeRecommendationInterestSignal({ ...input, expiresAt });
}

function createSignalAccumulator(): OnboardingSignalAccumulator {
  return {
    signals: [],
    canonicalInterestSignalCount: 0,
    hashtagSignalCount: 0
  };
}

function appendSeedSignal(
  accumulator: OnboardingSignalAccumulator,
  bucket: OnboardingSignalBucket,
  input: RecommendationInterestSignalInput,
  expiresAt: string | undefined
): void {
  if (accumulator.signals.length >= MAX_SIGNAL_COUNT) {
    throw new TypeError("Recommendation onboarding profile seed generated too many signals.");
  }

  accumulator.signals.push(createSignal(input, expiresAt));
  if (bucket === "canonical_interest") {
    accumulator.canonicalInterestSignalCount += 1;
  } else {
    accumulator.hashtagSignalCount += 1;
  }
}

function addSensitiveTopicIdForTopic(
  sensitiveTopicIds: Set<string>,
  catalogIndex: RecommendationCatalogIndex,
  topicId: string
): void {
  const topic = findRecommendationCatalogTopicInIndex(catalogIndex, topicId);
  if (topic === null) {
    throw new TypeError("Recommendation onboarding profile seed references unknown topic.");
  }
  if (topic.sensitive === true) {
    sensitiveTopicIds.add(topic.id);
    return;
  }
  if (topic.primaryTopicId === undefined) {
    return;
  }

  const primaryTopic = findRecommendationCatalogTopicInIndex(catalogIndex, topic.primaryTopicId);
  if (primaryTopic === null) {
    throw new TypeError("Recommendation onboarding profile seed references unknown topic.");
  }
  if (primaryTopic.sensitive === true) {
    sensitiveTopicIds.add(primaryTopic.id);
  }
}

function collectSensitiveSelectionTopicIds(
  catalogIndex: RecommendationCatalogIndex,
  selection: RecommendationOnboardingSelectionRecord
): readonly string[] {
  const sensitiveTopicIds = new Set<string>();
  const expandedTagIds = new Set(selection.expandedCanonicalTagIds);

  for (const topicId of selection.selectedTopicIds) {
    addSensitiveTopicIdForTopic(sensitiveTopicIds, catalogIndex, topicId);
  }

  for (const tagId of expandedTagIds) {
    const tag = findRecommendationCanonicalTagInIndex(catalogIndex, tagId);
    if (tag === null) {
      throw new TypeError("Recommendation onboarding profile seed references unknown canonical tag.");
    }
  }

  for (const [topicId, topicTagIds] of catalogIndex.canonicalTagIdsByTopicId.entries()) {
    if (topicTagIds.some((tagId) => expandedTagIds.has(tagId))) {
      addSensitiveTopicIdForTopic(sensitiveTopicIds, catalogIndex, topicId);
    }
  }

  return Object.freeze([...sensitiveTopicIds].sort());
}

function assertSensitiveSelectionAllowed(
  sensitiveTopicIds: readonly string[],
  allowSensitiveSelections: boolean | undefined
): void {
  if (sensitiveTopicIds.length > 0 && allowSensitiveSelections !== true) {
    throw new TypeError("Recommendation onboarding profile seed requires explicit sensitive selection opt-in.");
  }
}

function appendCanonicalInterestSignals(
  accumulator: OnboardingSignalAccumulator,
  catalogIndex: RecommendationCatalogIndex,
  selection: RecommendationOnboardingSelectionRecord,
  evidence: RecommendationInterestEvidence,
  privacyBoundary: RecommendationInterestPrivacyBoundary,
  dataUse: RecommendationDataUse,
  consent: PrivacySafeRecommendationConsentEvent,
  expiresAt: string | undefined
): void {
  const selectedTopics = new Set(selection.selectedTopicIds);
  const selectedTags = new Set(selection.selectedCanonicalTagIds);
  const emittedTargets = new Set<string>();

  for (const topicId of selection.selectedTopicIds) {
    const topic = findRecommendationCatalogTopicInIndex(catalogIndex, topicId);
    if (topic === null) {
      throw new TypeError("Recommendation onboarding profile seed references unknown topic.");
    }

    emittedTargets.add(topic.id);
    appendSeedSignal(accumulator, "canonical_interest", {
      target: { kind: "canonical_interest", key: topic.id },
      action: "select",
      polarity: "positive",
      strength: 1,
      confidence: 1,
      dataUse,
      privacyBoundary,
      evidence,
      consent
    }, expiresAt);
  }

  for (const tagId of selection.expandedCanonicalTagIds) {
    const tag = findRecommendationCanonicalTagInIndex(catalogIndex, tagId);
    if (tag === null) {
      throw new TypeError("Recommendation onboarding profile seed references unknown canonical tag.");
    }
    if (emittedTargets.has(tag.id)) {
      continue;
    }

    emittedTargets.add(tag.id);
    const explicitlySelected = selectedTags.has(tagId);
    const parentSelected = (tag.parentTopicIds ?? []).some((topicId) => selectedTopics.has(topicId));
    appendSeedSignal(accumulator, "canonical_interest", {
      target: { kind: "canonical_interest", key: tag.id },
      action: "select",
      polarity: "positive",
      strength: explicitlySelected || parentSelected ? 0.95 : 0.75,
      confidence: explicitlySelected ? 1 : 0.9,
      dataUse,
      privacyBoundary,
      evidence,
      consent
    }, expiresAt);
  }
}

function appendHashtagSignals(
  accumulator: OnboardingSignalAccumulator,
  catalogIndex: RecommendationCatalogIndex,
  selection: RecommendationOnboardingSelectionRecord,
  evidence: RecommendationInterestEvidence,
  privacyBoundary: RecommendationInterestPrivacyBoundary,
  dataUse: RecommendationDataUse,
  consent: PrivacySafeRecommendationConsentEvent,
  expiresAt: string | undefined
): void {
  const seenHashtags = new Set<string>();

  for (const tagId of selection.expandedCanonicalTagIds) {
    const tag = findRecommendationCanonicalTagInIndex(catalogIndex, tagId);
    if (tag === null) {
      throw new TypeError("Recommendation onboarding profile seed references unknown canonical tag.");
    }

    for (const hashtag of tag.hashtags) {
      if (seenHashtags.has(hashtag)) {
        continue;
      }
      seenHashtags.add(hashtag);
      appendSeedSignal(accumulator, "hashtag", {
        target: { kind: "hashtag", key: hashtag },
        action: "select",
        polarity: "positive",
        strength: 0.6,
        confidence: 0.85,
        dataUse,
        privacyBoundary,
        evidence,
        consent
      }, expiresAt);
    }
  }
}

export interface RecommendationOnboardingSignalBuild {
  signals: readonly RecommendationInterestSignal[];
  canonicalInterestSignalCount: number;
  hashtagSignalCount: number;
  consent: PrivacySafeRecommendationConsentEvent;
  observedAt: string;
  privacyBoundary: RecommendationInterestPrivacyBoundary;
}

/**
 * Runs every seed check (catalog, sensitivity, consent) and builds the signals, without touching any
 * profile store. Callers that own their own persistence use this so no throwaway store is created.
 */
export async function buildRecommendationOnboardingSignals(
  input: Omit<RecommendationOnboardingProfileSeedInput, "profileStore">
): Promise<RecommendationOnboardingSignalBuild> {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation onboarding profile seed input.");
  }

  assertSubjectId(input.subjectId);
  const catalogIndex = input.catalogIndex;
  const selection = selectionForCatalogIndex(catalogIndex, input.selection);
  const dataUse = input.dataUse ?? DEFAULT_DATA_USE;
  const privacyBoundary = resolvePrivacyBoundary(input.privacyBoundary, selection);
  assertSubjectLevelPrivacyBoundary(privacyBoundary);
  if (input.allowSensitiveSelections !== true) {
    assertSensitiveSelectionAllowed(
      collectSensitiveSelectionTopicIds(catalogIndex, selection),
      input.allowSensitiveSelections
    );
  }
  const observedAt = optionalTimestamp(input.observedAt, selection.selectedAt, "Invalid recommendation onboarding profile seed timestamp.");
  const expiresAt = assertExpiresAt(input.expiresAt, observedAt);
  const evidence = createOnboardingEvidence(observedAt, privacyBoundary, selection);
  const consentEvaluation = await requireRecommendationConsent(
    input.policy,
    Object.freeze({
      subjectId: input.subjectId,
      dataUse,
      protocol: evidence.protocol,
      sourceVisibility: evidence.sourceVisibility,
      accessBasis: evidence.accessBasis,
      containsPrivateData: true,
      containsThirdPartyData: false,
      serverSideProcessing: privacyBoundary !== "local_only"
    }),
    input.enforcementOptions
  );
  const consent = consentEvaluation.auditEvent;
  const accumulator = createSignalAccumulator();
  appendCanonicalInterestSignals(
    accumulator,
    catalogIndex,
    selection,
    evidence,
    privacyBoundary,
    dataUse,
    consent,
    expiresAt
  );
  appendHashtagSignals(
    accumulator,
    catalogIndex,
    selection,
    evidence,
    privacyBoundary,
    dataUse,
    consent,
    expiresAt
  );
  return Object.freeze({
    signals: Object.freeze([...accumulator.signals]),
    canonicalInterestSignalCount: accumulator.canonicalInterestSignalCount,
    hashtagSignalCount: accumulator.hashtagSignalCount,
    consent,
    observedAt,
    privacyBoundary
  });
}

export async function createRecommendationOnboardingProfileSeed(
  input: RecommendationOnboardingProfileSeedInput
): Promise<RecommendationOnboardingProfileSeedResult> {
  const { signals, canonicalInterestSignalCount, hashtagSignalCount, consent, observedAt, privacyBoundary } =
    await buildRecommendationOnboardingSignals(input);
  const profileStore = input.profileStore ?? createInMemoryRecommendationProfileStore({
    allowedPrivacyBoundaries: [privacyBoundary],
    now: () => observedAt
  });
  const ingestResult = await profileStore.ingestSignals({
    subjectId: input.subjectId,
    signals,
    now: observedAt
  });

  return Object.freeze({
    schemaVersion: RECOMMENDATION_ONBOARDING_PROFILE_SEED_SCHEMA_VERSION,
    signalCount: signals.length,
    canonicalInterestSignalCount,
    hashtagSignalCount,
    profile: ingestResult.profile,
    signals,
    consent
  });
}
