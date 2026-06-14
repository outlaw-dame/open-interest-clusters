import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  RECOMMENDATION_DATA_USES,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationDataUse
} from "./consent.js";
import {
  RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES,
  RECOMMENDATION_INTEREST_TARGET_KINDS,
  normalizeRecommendationInterestSignal,
  type RecommendationInterestPrivacyBoundary,
  type RecommendationInterestSignal,
  type RecommendationInterestSignalInput,
  type RecommendationInterestTarget,
  type RecommendationInterestTargetKind
} from "./interest-signal.js";
import type {
  RecommendationLabelerEvidence,
  RecommendationLabelerSignalEvaluation
} from "./labeler-signal-policy.js";

export interface RecommendationLabelerInterestSignalInput {
  evaluation: RecommendationLabelerSignalEvaluation;
  dataUse: RecommendationDataUse;
  targetKind?: RecommendationInterestTargetKind;
  strength?: number;
  confidence?: number;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  expiresAt?: string;
}

export interface RecommendationLabelerInterestSignalBatchInput {
  evaluations: readonly RecommendationLabelerSignalEvaluation[];
  dataUse: RecommendationDataUse;
  targetKind?: RecommendationInterestTargetKind;
  strength?: number;
  confidence?: number;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  expiresAt?: string;
}

export interface RecommendationLabelerInterestSignalDerivationResult {
  signals: readonly RecommendationInterestSignal[];
  acceptedEvaluationCount: number;
  ignoredEvaluationCount: number;
}

const DATA_USE_SET = new Set<string>(RECOMMENDATION_DATA_USES);
const TARGET_KIND_SET = new Set<string>(RECOMMENDATION_INTEREST_TARGET_KINDS);
const PRIVACY_BOUNDARY_SET = new Set<string>(RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES);
const MAX_LABEL_INTEREST_KEY_LENGTH = 160;
const DEFAULT_LABEL_INTEREST_STRENGTH = 0.35;
const DEFAULT_LABEL_INTEREST_CONFIDENCE = 0.65;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isKnownDataUse(value: unknown): value is RecommendationDataUse {
  return typeof value === "string" && DATA_USE_SET.has(value);
}

function isKnownTargetKind(value: unknown): value is RecommendationInterestTargetKind {
  return typeof value === "string" && TARGET_KIND_SET.has(value);
}

function isOptionalTargetKind(value: unknown): value is RecommendationInterestTargetKind | undefined {
  return value === undefined || isKnownTargetKind(value);
}

function isOptionalPrivacyBoundary(value: unknown): value is RecommendationInterestPrivacyBoundary | undefined {
  return value === undefined || (typeof value === "string" && PRIVACY_BOUNDARY_SET.has(value));
}

function boundedUnitNumber(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`Invalid recommendation labeler interest ${label}.`);
  }

  return value;
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid recommendation labeler interest ${label}.`);
  }

  return value;
}

function normalizeLabelInterestKey(value: string, targetKind: RecommendationInterestTargetKind): string {
  const rawKey = value.trim().toLocaleLowerCase("en-US");
  const key = targetKind === "domain" ? rawKey.replace(/_+/gu, "-") : rawKey.replace(/[._]+/gu, "-");
  if (
    key.length === 0 ||
    key.length > MAX_LABEL_INTEREST_KEY_LENGTH ||
    key.includes("://") ||
    key.includes("@") ||
    hasUnsafeControlCharacter(key)
  ) {
    throw new TypeError("Invalid recommendation labeler interest key.");
  }

  return key;
}

function assertAllowedConsent(consent: PrivacySafeRecommendationConsentEvent, dataUse: RecommendationDataUse): void {
  if (consent.decision !== "allow" || consent.dataUse !== dataUse) {
    throw new TypeError("Invalid recommendation labeler interest consent.");
  }
}

function acceptedEvidence(evaluation: RecommendationLabelerSignalEvaluation): RecommendationLabelerEvidence | undefined {
  if (evaluation.decision !== "accept") return undefined;
  if (!isPlainRecord(evaluation.evidence)) {
    throw new TypeError("Invalid recommendation labeler interest signal input.");
  }

  return evaluation.evidence;
}

function signalInputFromEvidence(
  input: RecommendationLabelerInterestSignalInput,
  evidence: RecommendationLabelerEvidence
): RecommendationInterestSignal {
  if (!isKnownDataUse(input.dataUse) || !isOptionalTargetKind(input.targetKind) || !isOptionalPrivacyBoundary(input.privacyBoundary)) {
    throw new TypeError("Invalid recommendation labeler interest signal input.");
  }

  assertAllowedConsent(input.evaluation.auditEvent, input.dataUse);

  const targetKind = input.targetKind ?? "canonical_interest";
  const target: RecommendationInterestTarget = {
    kind: targetKind,
    key: normalizeLabelInterestKey(evidence.value, targetKind)
  };
  const expiresAt = optionalNonEmptyString(input.expiresAt ?? evidence.expiresAt, "expiration timestamp");
  const signalInput: RecommendationInterestSignalInput = {
    target,
    action: "label",
    polarity: "neutral",
    strength: boundedUnitNumber(input.strength, DEFAULT_LABEL_INTEREST_STRENGTH, "strength"),
    confidence: boundedUnitNumber(input.confidence, DEFAULT_LABEL_INTEREST_CONFIDENCE, "confidence"),
    dataUse: input.dataUse,
    privacyBoundary: input.privacyBoundary ?? "local_only",
    evidence: {
      sourceItemKind: "label",
      protocol: "atproto",
      sourceVisibility: input.evaluation.auditEvent.sourceVisibility,
      accessBasis: input.evaluation.auditEvent.accessBasis,
      trustBoundary: "third_party",
      observedAt: evidence.createdAt
    },
    consent: input.evaluation.auditEvent
  };

  if (expiresAt !== undefined) {
    signalInput.expiresAt = expiresAt;
  }

  return normalizeRecommendationInterestSignal(signalInput);
}

export function createRecommendationInterestSignalFromLabelerEvidence(
  input: RecommendationLabelerInterestSignalInput
): RecommendationInterestSignal | undefined {
  if (!isPlainRecord(input) || !isPlainRecord(input.evaluation) || !isPlainRecord(input.evaluation.auditEvent)) {
    throw new TypeError("Invalid recommendation labeler interest signal input.");
  }

  const evidence = acceptedEvidence(input.evaluation);
  if (evidence === undefined) {
    return undefined;
  }

  return signalInputFromEvidence(input, evidence);
}

export function deriveRecommendationInterestSignalsFromLabelerEvaluations(
  input: RecommendationLabelerInterestSignalBatchInput
): RecommendationLabelerInterestSignalDerivationResult {
  if (!isPlainRecord(input) || !Array.isArray(input.evaluations) || !isKnownDataUse(input.dataUse)) {
    throw new TypeError("Invalid recommendation labeler interest signal derivation input.");
  }

  const signals: RecommendationInterestSignal[] = [];
  let acceptedEvaluationCount = 0;
  let ignoredEvaluationCount = 0;

  for (const evaluation of input.evaluations) {
    const signalInput: RecommendationLabelerInterestSignalInput = {
      evaluation,
      dataUse: input.dataUse
    };

    if (input.targetKind !== undefined) signalInput.targetKind = input.targetKind;
    if (input.strength !== undefined) signalInput.strength = input.strength;
    if (input.confidence !== undefined) signalInput.confidence = input.confidence;
    if (input.privacyBoundary !== undefined) signalInput.privacyBoundary = input.privacyBoundary;
    if (input.expiresAt !== undefined) signalInput.expiresAt = input.expiresAt;

    try {
      const signal = createRecommendationInterestSignalFromLabelerEvidence(signalInput);

      if (signal === undefined) {
        ignoredEvaluationCount += 1;
      } else {
        acceptedEvaluationCount += 1;
        signals.push(signal);
      }
    } catch (error) {
      void error;
      ignoredEvaluationCount += 1;
    }
  }

  return Object.freeze({
    signals: Object.freeze(signals),
    acceptedEvaluationCount,
    ignoredEvaluationCount
  });
}
