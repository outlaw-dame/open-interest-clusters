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
  createRecommendationHashtagFollowPlan,
  createRecommendationOnboardingSelection,
  type RecommendationCatalog,
  type RecommendationHashtagFollowPlan,
  type RecommendationOnboardingSelectionRecord,
  type RecommendationPreferenceStorageTarget
} from "./catalog.js";
import {
  createRecommendationCatalogIndex,
  type RecommendationCatalogIndex
} from "./catalog-index.js";
import type { RecommendationInterestPrivacyBoundary } from "./interest-signal.js";
import {
  createRecommendationOnboardingProfileSeed,
  type RecommendationOnboardingProfileSeedResult
} from "./onboarding-profile-seed.js";
import type { RecommendationProfileSnapshot, RecommendationProfileStore } from "./profile-store.js";
import type { RecommendationProfilePersistenceAdapter } from "./profile-store-persistence.js";
import {
  RECOMMENDATION_PROFILE_PERSISTENCE_STORAGE_TARGETS,
  writeRecommendationProfileStoreRecordSafely,
  type HardenedRecommendationProfilePersistenceWriteResult,
  type RecommendationProfilePersistenceStorageTarget,
  type RecommendationProfilePersistenceVerificationConsistency
} from "./profile-store-persistence-hardening.js";

export const RECOMMENDATION_ONBOARDING_PROFILE_BOOTSTRAP_SCHEMA_VERSION = "recommendation-onboarding-profile-bootstrap.v1" as const;

export interface RecommendationOnboardingProfileBootstrapPersistenceOptions {
  adapter: RecommendationProfilePersistenceAdapter;
  namespace?: string;
  salt?: string;
  writtenAt?: string;
  expiresAt?: string;
  verifyWrite?: boolean;
  deleteOnVerificationFailure?: boolean;
  verificationConsistency?: RecommendationProfilePersistenceVerificationConsistency;
}

export interface RecommendationOnboardingProfileBootstrapInput {
  subjectId: string;
  catalog?: RecommendationCatalog;
  catalogIndex?: RecommendationCatalogIndex;
  selectedTopicIds: readonly string[];
  selectedCanonicalTagIds?: readonly string[];
  allowAutoFollowHashtags?: boolean;
  allowSensitiveSelections?: boolean;
  selectedAt?: string;
  now?: () => string;
  storageTarget?: RecommendationProfilePersistenceStorageTarget;
  preferenceStorageTarget?: RecommendationPreferenceStorageTarget;
  policy: RecommendationConsentPolicy | null | undefined;
  dataUse?: RecommendationDataUse;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  expiresAt?: string;
  profileStore?: RecommendationProfileStore;
  enforcementOptions?: RecommendationConsentEnforcementOptions;
  persistence?: RecommendationOnboardingProfileBootstrapPersistenceOptions;
}

export interface RecommendationOnboardingProfileBootstrapResult {
  schemaVersion: typeof RECOMMENDATION_ONBOARDING_PROFILE_BOOTSTRAP_SCHEMA_VERSION;
  storageTarget: RecommendationProfilePersistenceStorageTarget;
  selection: RecommendationOnboardingSelectionRecord;
  selectedCanonicalInterestIds: readonly string[];
  hashtagFollowPlan: RecommendationHashtagFollowPlan;
  profile: RecommendationProfileSnapshot;
  signalCount: number;
  canonicalInterestSignalCount: number;
  hashtagSignalCount: number;
  consent: PrivacySafeRecommendationConsentEvent;
  persisted: boolean;
  persistence?: HardenedRecommendationProfilePersistenceWriteResult;
}

const DEFAULT_DATA_USE: RecommendationDataUse = "local_personalization";
const DEFAULT_PRIVACY_BOUNDARY: RecommendationInterestPrivacyBoundary = "local_only";
const DEFAULT_STORAGE_TARGET: RecommendationProfilePersistenceStorageTarget = "local_app";
const BOOTSTRAP_PROTOCOL: RecommendationProtocol = "app_local";
const BOOTSTRAP_VISIBILITY: RecommendationSourceVisibility = "local_only";
const STORAGE_TARGET_SET = new Set<string>(RECOMMENDATION_PROFILE_PERSISTENCE_STORAGE_TARGETS);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertTimestamp(value: unknown, message: string): string {
  if (!isNonEmptyString(value) || value.trim() !== value || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(message);
  }

  return value;
}

function normalizeStorageTarget(value: unknown): RecommendationProfilePersistenceStorageTarget {
  if (value === undefined) {
    return DEFAULT_STORAGE_TARGET;
  }

  if (typeof value !== "string" || !STORAGE_TARGET_SET.has(value)) {
    throw new TypeError("Invalid recommendation onboarding profile bootstrap storage target.");
  }

  return value as RecommendationProfilePersistenceStorageTarget;
}

function preferenceTargetForPersistenceTarget(
  storageTarget: RecommendationProfilePersistenceStorageTarget,
  override: RecommendationPreferenceStorageTarget | undefined
): RecommendationPreferenceStorageTarget {
  if (override !== undefined) {
    return override;
  }

  switch (storageTarget) {
    case "local_app":
    case "ephemeral_session":
      return "local_app";
    case "user_pod":
      return "activitypods_pod";
    case "server_profile":
    case "provider_hosted":
      return "provider_storage";
  }
}

function catalogIndexForInput(input: RecommendationOnboardingProfileBootstrapInput): RecommendationCatalogIndex {
  if (input.catalogIndex !== undefined) {
    return input.catalogIndex;
  }

  if (input.catalog !== undefined) {
    return createRecommendationCatalogIndex(input.catalog);
  }

  throw new TypeError("Recommendation onboarding profile bootstrap requires a catalog or catalog index.");
}

function requiresServerPersistenceConsent(storageTarget: RecommendationProfilePersistenceStorageTarget): boolean {
  return storageTarget === "user_pod" || storageTarget === "server_profile" || storageTarget === "provider_hosted";
}

async function assertServerPersistenceAllowedBeforeSeeding(
  policy: RecommendationConsentPolicy | null | undefined,
  subjectId: string,
  dataUse: RecommendationDataUse,
  storageTarget: RecommendationProfilePersistenceStorageTarget,
  enforcementOptions: RecommendationConsentEnforcementOptions | undefined
): Promise<void> {
  if (!requiresServerPersistenceConsent(storageTarget)) {
    return;
  }

  await requireRecommendationConsent(
    policy,
    Object.freeze({
      subjectId,
      dataUse,
      protocol: BOOTSTRAP_PROTOCOL,
      sourceVisibility: BOOTSTRAP_VISIBILITY,
      accessBasis: "owner",
      containsPrivateData: true,
      containsThirdPartyData: false,
      serverSideProcessing: true
    }),
    enforcementOptions
  );
}

function selectedCanonicalInterestIdsFromSeed(seed: RecommendationOnboardingProfileSeedResult): readonly string[] {
  const ids = new Set<string>();
  for (const entry of seed.profile.entries) {
    if (entry.target.kind === "canonical_interest") {
      ids.add(entry.target.key);
    }
  }

  return Object.freeze([...ids].sort());
}

function selectedAtForInput(input: RecommendationOnboardingProfileBootstrapInput): string {
  if (input.selectedAt !== undefined) {
    return assertTimestamp(input.selectedAt, "Invalid recommendation onboarding profile bootstrap timestamp.");
  }

  const now = input.now?.() ?? new Date().toISOString();
  return assertTimestamp(now, "Invalid recommendation onboarding profile bootstrap timestamp.");
}

async function persistBootstrapProfile(
  input: RecommendationOnboardingProfileBootstrapInput,
  storageTarget: RecommendationProfilePersistenceStorageTarget,
  seed: RecommendationOnboardingProfileSeedResult,
  selectedAt: string,
  dataUse: RecommendationDataUse,
  privacyBoundary: RecommendationInterestPrivacyBoundary
): Promise<HardenedRecommendationProfilePersistenceWriteResult | undefined> {
  if (input.persistence === undefined) {
    return undefined;
  }

  const persistence = input.persistence;
  return writeRecommendationProfileStoreRecordSafely(persistence.adapter, {
    subjectId: input.subjectId,
    profile: seed.profile,
    writtenAt: persistence.writtenAt ?? selectedAt,
    storageTarget,
    policy: input.policy,
    dataUse,
    privacyBoundary,
    ...(persistence.namespace === undefined ? {} : { namespace: persistence.namespace }),
    ...(persistence.salt === undefined ? {} : { salt: persistence.salt }),
    ...(persistence.expiresAt === undefined ? {} : { expiresAt: persistence.expiresAt }),
    ...(persistence.verifyWrite === undefined ? {} : { verifyWrite: persistence.verifyWrite }),
    ...(persistence.deleteOnVerificationFailure === undefined ? {} : { deleteOnVerificationFailure: persistence.deleteOnVerificationFailure }),
    ...(persistence.verificationConsistency === undefined ? {} : { verificationConsistency: persistence.verificationConsistency })
  });
}

export async function bootstrapRecommendationProfileFromOnboarding(
  input: RecommendationOnboardingProfileBootstrapInput
): Promise<RecommendationOnboardingProfileBootstrapResult> {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation onboarding profile bootstrap input.");
  }

  const storageTarget = normalizeStorageTarget(input.storageTarget);
  const dataUse = input.dataUse ?? DEFAULT_DATA_USE;
  const privacyBoundary = input.privacyBoundary ?? DEFAULT_PRIVACY_BOUNDARY;
  const catalogIndex = catalogIndexForInput(input);
  const selectedAt = selectedAtForInput(input);
  const selection = createRecommendationOnboardingSelection({
    catalog: catalogIndex.catalog,
    selectedTopicIds: input.selectedTopicIds,
    selectedCanonicalTagIds: input.selectedCanonicalTagIds ?? Object.freeze([]),
    allowAutoFollowHashtags: input.allowAutoFollowHashtags === true,
    selectedAt,
    storageTarget: preferenceTargetForPersistenceTarget(storageTarget, input.preferenceStorageTarget)
  });
  const hashtagFollowPlan = createRecommendationHashtagFollowPlan({ catalog: catalogIndex.catalog, selection });

  await assertServerPersistenceAllowedBeforeSeeding(
    input.policy,
    input.subjectId,
    dataUse,
    storageTarget,
    input.enforcementOptions
  );

  const seed = await createRecommendationOnboardingProfileSeed({
    subjectId: input.subjectId,
    catalogIndex,
    selection,
    policy: input.policy,
    dataUse,
    privacyBoundary,
    observedAt: selectedAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.profileStore === undefined ? {} : { profileStore: input.profileStore }),
    ...(input.enforcementOptions === undefined ? {} : { enforcementOptions: input.enforcementOptions }),
    ...(input.allowSensitiveSelections === undefined ? {} : { allowSensitiveSelections: input.allowSensitiveSelections })
  });

  const persistence = await persistBootstrapProfile(input, storageTarget, seed, selectedAt, dataUse, privacyBoundary);

  return Object.freeze({
    schemaVersion: RECOMMENDATION_ONBOARDING_PROFILE_BOOTSTRAP_SCHEMA_VERSION,
    storageTarget,
    selection,
    selectedCanonicalInterestIds: selectedCanonicalInterestIdsFromSeed(seed),
    hashtagFollowPlan,
    profile: seed.profile,
    signalCount: seed.signalCount,
    canonicalInterestSignalCount: seed.canonicalInterestSignalCount,
    hashtagSignalCount: seed.hashtagSignalCount,
    consent: seed.consent,
    persisted: persistence !== undefined,
    ...(persistence === undefined ? {} : { persistence })
  });
}
