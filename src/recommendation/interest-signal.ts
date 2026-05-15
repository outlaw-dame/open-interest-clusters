import {
  RECOMMENDATION_ACCESS_BASES,
  RECOMMENDATION_DATA_USES,
  RECOMMENDATION_PROTOCOLS,
  RECOMMENDATION_SOURCE_VISIBILITIES,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationAccessBasis,
  type RecommendationConsentEvaluation,
  type RecommendationDataUse,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
} from "./consent.js";
import {
  normalizeRecommendationSourceItem,
  RECOMMENDATION_SOURCE_ITEM_KINDS,
  RECOMMENDATION_SOURCE_TRUST_BOUNDARIES,
  type RecommendationSourceItem,
  type RecommendationSourceItemKind,
  type RecommendationSourceTrustBoundary
} from "./source-adapter.js";

export const RECOMMENDATION_INTEREST_TARGET_KINDS = [
  "canonical_interest",
  "hashtag",
  "entity",
  "keyword",
  "domain",
  "creator",
  "collection",
  "moderation_label"
] as const;

export type RecommendationInterestTargetKind = typeof RECOMMENDATION_INTEREST_TARGET_KINDS[number];

export const RECOMMENDATION_INTEREST_ACTIONS = [
  "view",
  "dwell",
  "click",
  "search",
  "like",
  "reply",
  "repost",
  "quote",
  "follow",
  "save",
  "share",
  "select",
  "dismiss",
  "hide",
  "block",
  "mute",
  "label"
] as const;

export type RecommendationInterestAction = typeof RECOMMENDATION_INTEREST_ACTIONS[number];

export const RECOMMENDATION_INTEREST_POLARITIES = ["positive", "negative", "neutral"] as const;

export type RecommendationInterestPolarity = typeof RECOMMENDATION_INTEREST_POLARITIES[number];

export const RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES = ["local_only", "server_allowed", "aggregate_only"] as const;

export type RecommendationInterestPrivacyBoundary = typeof RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES[number];

export interface RecommendationInterestTarget {
  kind: RecommendationInterestTargetKind;
  key: string;
}

export interface RecommendationInterestEvidence {
  sourceItemKind: RecommendationSourceItemKind;
  protocol: RecommendationProtocol;
  sourceVisibility: RecommendationSourceVisibility;
  accessBasis: RecommendationAccessBasis;
  trustBoundary: RecommendationSourceTrustBoundary;
  observedAt: string;
}

export interface RecommendationInterestSignal {
  target: RecommendationInterestTarget;
  action: RecommendationInterestAction;
  polarity: RecommendationInterestPolarity;
  strength: number;
  confidence: number;
  dataUse: RecommendationDataUse;
  privacyBoundary: RecommendationInterestPrivacyBoundary;
  evidence: RecommendationInterestEvidence;
  consent: PrivacySafeRecommendationConsentEvent;
  expiresAt?: string;
}

export interface RecommendationInterestSignalInput {
  target: RecommendationInterestTarget;
  action: RecommendationInterestAction;
  polarity?: RecommendationInterestPolarity;
  strength: number;
  confidence: number;
  dataUse: RecommendationDataUse;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  evidence: RecommendationInterestEvidence;
  consent: PrivacySafeRecommendationConsentEvent;
  expiresAt?: string;
}

export interface RecommendationInterestSignalFromSourceInput {
  source: RecommendationSourceItem;
  target: RecommendationInterestTarget;
  action: RecommendationInterestAction;
  polarity?: RecommendationInterestPolarity;
  strength: number;
  confidence: number;
  dataUse: RecommendationDataUse;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  consentEvaluation: RecommendationConsentEvaluation;
  expiresAt?: string;
}

const TARGET_KIND_SET = new Set<string>(RECOMMENDATION_INTEREST_TARGET_KINDS);
const ACTION_SET = new Set<string>(RECOMMENDATION_INTEREST_ACTIONS);
const POLARITY_SET = new Set<string>(RECOMMENDATION_INTEREST_POLARITIES);
const PRIVACY_BOUNDARY_SET = new Set<string>(RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES);
const DATA_USE_SET = new Set<string>(RECOMMENDATION_DATA_USES);
const SOURCE_ITEM_KIND_SET = new Set<string>(RECOMMENDATION_SOURCE_ITEM_KINDS);
const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const VISIBILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_VISIBILITIES);
const ACCESS_BASIS_SET = new Set<string>(RECOMMENDATION_ACCESS_BASES);
const TRUST_BOUNDARY_SET = new Set<string>(RECOMMENDATION_SOURCE_TRUST_BOUNDARIES);
const MAX_TARGET_KEY_LENGTH = 160;
const DOMAIN_TARGET_KEY_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function hasString(set: ReadonlySet<string>, value: unknown): value is string {
  return typeof value === "string" && set.has(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isBoundedUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPrivacySafeTargetKey(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const trimmed = value.trim();
  return (
    trimmed === value &&
    trimmed.length <= MAX_TARGET_KEY_LENGTH &&
    !trimmed.includes("://") &&
    !trimmed.includes("@") &&
    !/[\x00-\x1F\x7F]/u.test(trimmed)
  );
}

function isPrivacySafeDomainTargetKey(value: unknown): value is string {
  return isPrivacySafeTargetKey(value) && DOMAIN_TARGET_KEY_PATTERN.test(value);
}

function isInterestTarget(value: unknown): value is RecommendationInterestTarget {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<RecommendationInterestTarget>;
  if (!hasString(TARGET_KIND_SET, candidate.kind)) {
    return false;
  }

  return candidate.kind === "domain"
    ? isPrivacySafeDomainTargetKey(candidate.key)
    : isPrivacySafeTargetKey(candidate.key);
}

function isInterestEvidence(value: unknown): value is RecommendationInterestEvidence {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<RecommendationInterestEvidence>;
  return (
    hasString(SOURCE_ITEM_KIND_SET, candidate.sourceItemKind) &&
    hasString(PROTOCOL_SET, candidate.protocol) &&
    hasString(VISIBILITY_SET, candidate.sourceVisibility) &&
    hasString(ACCESS_BASIS_SET, candidate.accessBasis) &&
    hasString(TRUST_BOUNDARY_SET, candidate.trustBoundary) &&
    isNonEmptyString(candidate.observedAt)
  );
}

function isConsentEvent(value: unknown): value is PrivacySafeRecommendationConsentEvent {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<PrivacySafeRecommendationConsentEvent>;
  return (
    candidate.decision === "allow" &&
    candidate.reason === "consent.allow.explicit" &&
    hasString(DATA_USE_SET, candidate.dataUse) &&
    hasString(PROTOCOL_SET, candidate.protocol) &&
    hasString(VISIBILITY_SET, candidate.sourceVisibility) &&
    hasString(ACCESS_BASIS_SET, candidate.accessBasis) &&
    isBoolean(candidate.containsPrivateData) &&
    isBoolean(candidate.containsThirdPartyData) &&
    isBoolean(candidate.serverSideProcessing)
  );
}

function cloneTarget(target: RecommendationInterestTarget): RecommendationInterestTarget {
  return Object.freeze({ kind: target.kind, key: target.key });
}

function cloneEvidence(evidence: RecommendationInterestEvidence): RecommendationInterestEvidence {
  return Object.freeze({
    sourceItemKind: evidence.sourceItemKind,
    protocol: evidence.protocol,
    sourceVisibility: evidence.sourceVisibility,
    accessBasis: evidence.accessBasis,
    trustBoundary: evidence.trustBoundary,
    observedAt: evidence.observedAt
  });
}

function cloneConsentEvent(consent: PrivacySafeRecommendationConsentEvent): PrivacySafeRecommendationConsentEvent {
  return Object.freeze({
    decision: consent.decision,
    reason: consent.reason,
    dataUse: consent.dataUse,
    protocol: consent.protocol,
    sourceVisibility: consent.sourceVisibility,
    accessBasis: consent.accessBasis,
    containsPrivateData: consent.containsPrivateData,
    containsThirdPartyData: consent.containsThirdPartyData,
    serverSideProcessing: consent.serverSideProcessing
  });
}

function isValidInterestSignal(value: unknown): value is RecommendationInterestSignal {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<RecommendationInterestSignal>;
  return (
    isInterestTarget(candidate.target) &&
    hasString(ACTION_SET, candidate.action) &&
    hasString(POLARITY_SET, candidate.polarity) &&
    isBoundedUnitNumber(candidate.strength) &&
    isBoundedUnitNumber(candidate.confidence) &&
    hasString(DATA_USE_SET, candidate.dataUse) &&
    hasString(PRIVACY_BOUNDARY_SET, candidate.privacyBoundary) &&
    isInterestEvidence(candidate.evidence) &&
    isConsentEvent(candidate.consent) &&
    isOptionalNonEmptyString(candidate.expiresAt) &&
    candidate.consent.dataUse === candidate.dataUse &&
    candidate.consent.protocol === candidate.evidence.protocol &&
    candidate.consent.sourceVisibility === candidate.evidence.sourceVisibility &&
    candidate.consent.accessBasis === candidate.evidence.accessBasis
  );
}

export function isRecommendationInterestSignal(value: unknown): value is RecommendationInterestSignal {
  return isValidInterestSignal(value);
}

export function normalizeRecommendationInterestSignal(input: RecommendationInterestSignalInput): RecommendationInterestSignal {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation interest signal input.");
  }

  const candidate: RecommendationInterestSignal = {
    target: input.target,
    action: input.action,
    polarity: input.polarity ?? "neutral",
    strength: input.strength,
    confidence: input.confidence,
    dataUse: input.dataUse,
    privacyBoundary: input.privacyBoundary ?? "local_only",
    evidence: input.evidence,
    consent: input.consent
  };

  if (input.expiresAt !== undefined) {
    candidate.expiresAt = input.expiresAt;
  }

  if (!isValidInterestSignal(candidate)) {
    throw new TypeError("Invalid recommendation interest signal.");
  }

  const normalized: RecommendationInterestSignal = {
    target: cloneTarget(candidate.target),
    action: candidate.action,
    polarity: candidate.polarity,
    strength: candidate.strength,
    confidence: candidate.confidence,
    dataUse: candidate.dataUse,
    privacyBoundary: candidate.privacyBoundary,
    evidence: cloneEvidence(candidate.evidence),
    consent: cloneConsentEvent(candidate.consent)
  };

  if (candidate.expiresAt !== undefined) {
    normalized.expiresAt = candidate.expiresAt;
  }

  return Object.freeze(normalized);
}

function sourceEvidence(source: RecommendationSourceItem): RecommendationInterestEvidence {
  return Object.freeze({
    sourceItemKind: source.kind,
    protocol: source.context.protocol,
    sourceVisibility: source.context.sourceVisibility,
    accessBasis: source.context.accessBasis,
    trustBoundary: source.provenance.trustBoundary,
    observedAt: source.provenance.observedAt
  });
}

export function createRecommendationInterestSignalFromSource(
  input: RecommendationInterestSignalFromSourceInput
): RecommendationInterestSignal {
  if (!isObject(input)) {
    throw new TypeError("Invalid recommendation interest signal source input.");
  }

  const source = normalizeRecommendationSourceItem(input.source);
  const consent = input.consentEvaluation.auditEvent;
  const signalInput: RecommendationInterestSignalInput = {
    target: input.target,
    action: input.action,
    strength: input.strength,
    confidence: input.confidence,
    dataUse: input.dataUse,
    evidence: sourceEvidence(source),
    consent
  };

  if (input.polarity !== undefined) {
    signalInput.polarity = input.polarity;
  }

  if (input.privacyBoundary !== undefined) {
    signalInput.privacyBoundary = input.privacyBoundary;
  }

  if (input.expiresAt !== undefined) {
    signalInput.expiresAt = input.expiresAt;
  }

  return normalizeRecommendationInterestSignal(signalInput);
}
