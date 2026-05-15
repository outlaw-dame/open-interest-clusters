import {
  RECOMMENDATION_DATA_USES,
  type RecommendationConsentEvaluation,
  type RecommendationDataUse
} from "./consent.js";
import type { RecommendationConsentGatedSourceAdapterReadResult } from "./consent-gated-source-adapter.js";
import {
  RECOMMENDATION_INTEREST_ACTIONS,
  RECOMMENDATION_INTEREST_POLARITIES,
  RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES,
  createRecommendationInterestSignalFromSource,
  type RecommendationInterestAction,
  type RecommendationInterestPolarity,
  type RecommendationInterestPrivacyBoundary,
  type RecommendationInterestSignal,
  type RecommendationInterestSignalFromSourceInput,
  type RecommendationInterestTarget
} from "./interest-signal.js";
import {
  normalizeRecommendationSourceItem,
  type RecommendationSourceItem
} from "./source-adapter.js";

export interface RecommendationInterestSignalDerivationSpec {
  sourceIndex: number;
  target: RecommendationInterestTarget;
  action: RecommendationInterestAction;
  polarity?: RecommendationInterestPolarity;
  strength: number;
  confidence: number;
  privacyBoundary?: RecommendationInterestPrivacyBoundary;
  expiresAt?: string;
}

export interface RecommendationInterestSignalDerivationInput {
  readResult: RecommendationConsentGatedSourceAdapterReadResult;
  dataUse: RecommendationDataUse;
  derivations: readonly RecommendationInterestSignalDerivationSpec[];
}

export interface RecommendationInterestSignalDerivationResult {
  signals: readonly RecommendationInterestSignal[];
  sourceItemCount: number;
  derivationCount: number;
  deniedItemCount: number;
}

const DATA_USE_SET = new Set<string>(RECOMMENDATION_DATA_USES);
const ACTION_SET = new Set<string>(RECOMMENDATION_INTEREST_ACTIONS);
const POLARITY_SET = new Set<string>(RECOMMENDATION_INTEREST_POLARITIES);
const PRIVACY_BOUNDARY_SET = new Set<string>(RECOMMENDATION_INTEREST_PRIVACY_BOUNDARIES);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isKnownDataUse(value: unknown): value is RecommendationDataUse {
  return typeof value === "string" && DATA_USE_SET.has(value);
}

function isKnownAction(value: unknown): value is RecommendationInterestAction {
  return typeof value === "string" && ACTION_SET.has(value);
}

function isOptionalPolarity(value: unknown): value is RecommendationInterestPolarity | undefined {
  return value === undefined || (typeof value === "string" && POLARITY_SET.has(value));
}

function isOptionalPrivacyBoundary(value: unknown): value is RecommendationInterestPrivacyBoundary | undefined {
  return value === undefined || (typeof value === "string" && PRIVACY_BOUNDARY_SET.has(value));
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
}

function isBoundedUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidSourceIndex(value: unknown, sourceCount: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < sourceCount;
}

function isValidConsentEvaluation(value: unknown): value is RecommendationConsentEvaluation {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<RecommendationConsentEvaluation>;
  return isObject(candidate.auditEvent) && candidate.decision === "allow" && candidate.auditEvent.decision === "allow";
}

function normalizeReadResultItem(
  readResult: RecommendationConsentGatedSourceAdapterReadResult,
  index: number
): { source: RecommendationSourceItem; evaluation: RecommendationConsentEvaluation } {
  const source = readResult.items[index];
  const evaluation = readResult.consentEvaluations[index];

  if (source === undefined || evaluation === undefined || !isValidConsentEvaluation(evaluation)) {
    throw new TypeError("Invalid recommendation interest signal derivation read result.");
  }

  return {
    source: normalizeRecommendationSourceItem(source),
    evaluation
  };
}

function assertValidDerivationSpec(
  spec: RecommendationInterestSignalDerivationSpec,
  sourceCount: number
): void {
  if (
    !isObject(spec) ||
    !isValidSourceIndex(spec.sourceIndex, sourceCount) ||
    !isKnownAction(spec.action) ||
    !isOptionalPolarity(spec.polarity) ||
    !isBoundedUnitNumber(spec.strength) ||
    !isBoundedUnitNumber(spec.confidence) ||
    !isOptionalPrivacyBoundary(spec.privacyBoundary) ||
    !isOptionalNonEmptyString(spec.expiresAt)
  ) {
    throw new TypeError("Invalid recommendation interest signal derivation spec.");
  }
}

function createSignalForSpec(
  readResult: RecommendationConsentGatedSourceAdapterReadResult,
  dataUse: RecommendationDataUse,
  spec: RecommendationInterestSignalDerivationSpec
): RecommendationInterestSignal {
  const { source, evaluation } = normalizeReadResultItem(readResult, spec.sourceIndex);
  const input: RecommendationInterestSignalFromSourceInput = {
    source,
    target: spec.target,
    action: spec.action,
    strength: spec.strength,
    confidence: spec.confidence,
    dataUse,
    consentEvaluation: evaluation
  };

  if (spec.polarity !== undefined) {
    input.polarity = spec.polarity;
  }

  if (spec.privacyBoundary !== undefined) {
    input.privacyBoundary = spec.privacyBoundary;
  }

  if (spec.expiresAt !== undefined) {
    input.expiresAt = spec.expiresAt;
  }

  return createRecommendationInterestSignalFromSource(input);
}

export function deriveRecommendationInterestSignals(
  input: RecommendationInterestSignalDerivationInput
): RecommendationInterestSignalDerivationResult {
  if (!isObject(input) || !isKnownDataUse(input.dataUse) || !Array.isArray(input.derivations)) {
    throw new TypeError("Invalid recommendation interest signal derivation input.");
  }

  if (!isObject(input.readResult) || input.readResult.items.length !== input.readResult.consentEvaluations.length) {
    throw new TypeError("Invalid recommendation interest signal derivation read result.");
  }

  const sourceCount = input.readResult.items.length;
  const signals = input.derivations.map((spec) => {
    assertValidDerivationSpec(spec, sourceCount);
    return createSignalForSpec(input.readResult, input.dataUse, spec);
  });

  return Object.freeze({
    signals: Object.freeze(signals),
    sourceItemCount: sourceCount,
    derivationCount: input.derivations.length,
    deniedItemCount: input.readResult.deniedItemCount
  });
}
