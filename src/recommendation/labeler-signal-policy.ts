import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  isRecommendationAtprotoLabelExpired,
  mergeRecommendationAtprotoLabelState,
  type RecommendationAtprotoLabelSignal,
  type RecommendationAtprotoLabelStateValue
} from "./atproto-labels.js";
import {
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentEvaluation
} from "./consent.js";

export const RECOMMENDATION_LABELER_SUBSCRIPTION_SOURCES = ["atproto", "host_app", "imported"] as const;

export type RecommendationLabelerSubscriptionSource = typeof RECOMMENDATION_LABELER_SUBSCRIPTION_SOURCES[number];

export const RECOMMENDATION_LABELER_SIGNAL_DECISIONS = ["accept", "ignore"] as const;

export type RecommendationLabelerSignalDecision = typeof RECOMMENDATION_LABELER_SIGNAL_DECISIONS[number];

export type RecommendationLabelerSignalReasonCode =
  | "labeler.accept.subscribed_evidence"
  | "labeler.ignore.consent_denied"
  | "labeler.ignore.not_subscribed"
  | "labeler.ignore.subscription_revoked"
  | "labeler.ignore.labeler_mismatch"
  | "labeler.ignore.expired_label"
  | "labeler.ignore.negated_label";

export interface RecommendationUserLabelerSubscriptionInput {
  subjectId: string;
  labelerDid: string;
  source: RecommendationLabelerSubscriptionSource;
  subscribedAt?: string;
  revokedAt?: string;
}

export interface RecommendationUserLabelerSubscription {
  subjectId: string;
  labelerDid: string;
  source: RecommendationLabelerSubscriptionSource;
  subscribedAt?: string;
  revokedAt?: string;
}

export interface RecommendationLabelerSignalPolicyInput {
  subjectId: string;
  label: RecommendationAtprotoLabelStateValue;
  subscription?: RecommendationUserLabelerSubscriptionInput | RecommendationUserLabelerSubscription | null;
  consentEvaluation: RecommendationConsentEvaluation;
  now?: string;
}

export interface RecommendationLabelerEvidence {
  subjectId: string;
  labelerDid: string;
  targetUri: string;
  value: string;
  negated: false;
  provenance: RecommendationAtprotoLabelSignal["provenance"];
  createdAt: string;
  subscriptionSource: RecommendationLabelerSubscriptionSource;
  targetCid?: string;
  expiresAt?: string;
  version?: number;
}

export interface RecommendationLabelerSignalEvaluation {
  decision: RecommendationLabelerSignalDecision;
  reasonCode: RecommendationLabelerSignalReasonCode;
  auditEvent: PrivacySafeRecommendationConsentEvent;
  evidence?: RecommendationLabelerEvidence;
}

const SUBSCRIPTION_SOURCE_SET = new Set<string>(RECOMMENDATION_LABELER_SUBSCRIPTION_SOURCES);
const MAX_SUBJECT_ID_LENGTH = 512;
const MAX_DID_LENGTH = 256;
const MAX_TIMESTAMP_LENGTH = 64;
const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasWhitespace(value: string): boolean {
  return /\s/u.test(value);
}

function boundedString(value: unknown, maxLength: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maxLength ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(`Invalid recommendation labeler ${label}.`);
  }

  return value;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return timestamp(value, label);
}

function timestamp(value: unknown, label: string): string {
  const normalized = boundedString(value, MAX_TIMESTAMP_LENGTH, label);
  const match = RFC3339_TIMESTAMP_PATTERN.exec(normalized);
  if (match === null) {
    throw new TypeError(`Invalid recommendation labeler ${label}.`);
  }

  if (!Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`Invalid recommendation labeler ${label}.`);
  }

  return normalized;
}

function did(value: unknown, label: string): string {
  const normalized = boundedString(value, MAX_DID_LENGTH, label);
  if (!DID_PATTERN.test(normalized) || hasWhitespace(normalized)) {
    throw new TypeError(`Invalid recommendation labeler ${label}.`);
  }

  return normalized;
}

function subjectId(value: unknown): string {
  return boundedString(value, MAX_SUBJECT_ID_LENGTH, "subject ID");
}

function subscriptionSource(value: unknown): RecommendationLabelerSubscriptionSource {
  if (typeof value !== "string" || !SUBSCRIPTION_SOURCE_SET.has(value)) {
    throw new TypeError("Invalid recommendation labeler subscription source.");
  }

  return value as RecommendationLabelerSubscriptionSource;
}

function ignored(
  reasonCode: RecommendationLabelerSignalReasonCode,
  auditEvent: PrivacySafeRecommendationConsentEvent
): RecommendationLabelerSignalEvaluation {
  return Object.freeze({ decision: "ignore", reasonCode, auditEvent });
}

function accepted(
  evidence: RecommendationLabelerEvidence,
  auditEvent: PrivacySafeRecommendationConsentEvent
): RecommendationLabelerSignalEvaluation {
  return Object.freeze({ decision: "accept", reasonCode: "labeler.accept.subscribed_evidence", auditEvent, evidence });
}

export function normalizeRecommendationUserLabelerSubscription(
  input: RecommendationUserLabelerSubscriptionInput | RecommendationUserLabelerSubscription
): RecommendationUserLabelerSubscription {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid recommendation labeler subscription input.");
  }

  const normalized: RecommendationUserLabelerSubscription = {
    subjectId: subjectId(input.subjectId),
    labelerDid: did(input.labelerDid, "DID"),
    source: subscriptionSource(input.source)
  };

  const subscribedAt = optionalTimestamp(input.subscribedAt, "subscription timestamp");
  const revokedAt = optionalTimestamp(input.revokedAt, "revocation timestamp");

  if (subscribedAt !== undefined) normalized.subscribedAt = subscribedAt;
  if (revokedAt !== undefined) normalized.revokedAt = revokedAt;

  return Object.freeze(normalized);
}

export function evaluateRecommendationLabelerSignalPolicy(
  input: RecommendationLabelerSignalPolicyInput
): RecommendationLabelerSignalEvaluation {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid recommendation labeler signal policy input.");
  }

  const auditEvent = input.consentEvaluation.auditEvent;
  if (auditEvent.decision !== "allow") {
    return ignored("labeler.ignore.consent_denied", auditEvent);
  }

  const normalizedSubjectId = subjectId(input.subjectId);
  if (input.subscription === undefined || input.subscription === null) {
    return ignored("labeler.ignore.not_subscribed", auditEvent);
  }

  const subscription = normalizeRecommendationUserLabelerSubscription(input.subscription);
  if (subscription.subjectId !== normalizedSubjectId) {
    return ignored("labeler.ignore.not_subscribed", auditEvent);
  }

  if (subscription.revokedAt !== undefined) {
    return ignored("labeler.ignore.subscription_revoked", auditEvent);
  }

  const label = mergeRecommendationAtprotoLabelState({ incoming: input.label });
  if (label === undefined) {
    return ignored("labeler.ignore.negated_label", auditEvent);
  }

  if (label.labelerDid !== subscription.labelerDid) {
    return ignored("labeler.ignore.labeler_mismatch", auditEvent);
  }

  if (input.now !== undefined && isRecommendationAtprotoLabelExpired(label, input.now)) {
    return ignored("labeler.ignore.expired_label", auditEvent);
  }

  const evidence: RecommendationLabelerEvidence = {
    subjectId: normalizedSubjectId,
    labelerDid: label.labelerDid,
    targetUri: label.targetUri,
    value: label.value,
    negated: false,
    provenance: label.provenance,
    createdAt: label.createdAt,
    subscriptionSource: subscription.source
  };

  if (label.targetCid !== undefined) evidence.targetCid = label.targetCid;
  if (label.expiresAt !== undefined) evidence.expiresAt = label.expiresAt;
  if (label.version !== undefined) evidence.version = label.version;

  return accepted(Object.freeze(evidence), auditEvent);
}
