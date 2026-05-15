import {
  RECOMMENDATION_DERIVED_DATA_TARGETS,
  evaluateRecommendationConsent,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentEvaluation,
  type RecommendationConsentPolicy,
  type RecommendationConsentReasonCode,
  type RecommendationConsentRequest,
  type RecommendationDerivedDataDeletionIntent,
  type RecommendationDerivedDataTarget
} from "./consent.js";

export type RecommendationConsentAuditFailureMode = "fail_closed" | "ignore";

export interface RecommendationConsentAuditSink {
  record(event: PrivacySafeRecommendationConsentEvent): Promise<void> | void;
}

export interface RecommendationConsentEnforcementOptions {
  auditSink?: RecommendationConsentAuditSink;
  auditFailureMode?: RecommendationConsentAuditFailureMode;
}

export interface RecommendationDerivedDataDeletionResult {
  deletedTargets: readonly RecommendationDerivedDataTarget[];
  skippedTargets: readonly RecommendationDerivedDataTarget[];
  completedAt: string;
}

export interface RecommendationDerivedDataDeleter {
  deleteDerivedData(
    intent: RecommendationDerivedDataDeletionIntent
  ): Promise<RecommendationDerivedDataDeletionResult> | RecommendationDerivedDataDeletionResult;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isKnownDeletionTarget(value: unknown): value is RecommendationDerivedDataTarget {
  return typeof value === "string" && RECOMMENDATION_DERIVED_DATA_TARGETS.includes(value as RecommendationDerivedDataTarget);
}

function cloneAuditEvent(event: PrivacySafeRecommendationConsentEvent): PrivacySafeRecommendationConsentEvent {
  return Object.freeze({ ...event });
}

function freezeTargets(targets: RecommendationDerivedDataTarget[]): readonly RecommendationDerivedDataTarget[] {
  return Object.freeze(targets);
}

function isValidDeletionIntent(intent: unknown): intent is RecommendationDerivedDataDeletionIntent {
  if (intent === null || typeof intent !== "object") {
    return false;
  }

  const candidate = intent as Partial<RecommendationDerivedDataDeletionIntent>;

  return (
    isNonEmptyString(candidate.subjectId) &&
    isNonEmptyString(candidate.requestedAt) &&
    candidate.scope === "recommendation_derived_data" &&
    Array.isArray(candidate.targets) &&
    candidate.targets.length > 0 &&
    candidate.targets.every(isKnownDeletionTarget)
  );
}

function isValidDeletionResult(result: unknown): result is RecommendationDerivedDataDeletionResult {
  if (result === null || typeof result !== "object") {
    return false;
  }

  const candidate = result as Partial<RecommendationDerivedDataDeletionResult>;

  return (
    Array.isArray(candidate.deletedTargets) &&
    Array.isArray(candidate.skippedTargets) &&
    isNonEmptyString(candidate.completedAt) &&
    candidate.deletedTargets.every(isKnownDeletionTarget) &&
    candidate.skippedTargets.every(isKnownDeletionTarget)
  );
}

function sanitizeDeletionResult(result: unknown): RecommendationDerivedDataDeletionResult {
  if (!isValidDeletionResult(result)) {
    throw new TypeError("Invalid recommendation derived data deletion result.");
  }

  return Object.freeze({
    deletedTargets: freezeTargets([...new Set(result.deletedTargets)]),
    skippedTargets: freezeTargets([...new Set(result.skippedTargets)]),
    completedAt: result.completedAt
  });
}

export class RecommendationConsentDeniedError extends Error {
  readonly reason: RecommendationConsentReasonCode;
  readonly auditEvent: PrivacySafeRecommendationConsentEvent;

  constructor(evaluation: RecommendationConsentEvaluation) {
    super(`Recommendation consent denied: ${evaluation.reason}`);
    this.name = "RecommendationConsentDeniedError";
    this.reason = evaluation.reason;
    this.auditEvent = cloneAuditEvent(evaluation.auditEvent);
  }
}

export class RecommendationConsentAuditError extends Error {
  readonly auditEvent: PrivacySafeRecommendationConsentEvent;

  constructor(event: PrivacySafeRecommendationConsentEvent) {
    super("Recommendation consent audit sink failed.");
    this.name = "RecommendationConsentAuditError";
    this.auditEvent = cloneAuditEvent(event);
  }
}

export class RecommendationDerivedDataDeletionError extends Error {
  constructor() {
    super("Recommendation derived data deletion failed.");
    this.name = "RecommendationDerivedDataDeletionError";
  }
}

async function recordConsentAuditEvent(
  event: PrivacySafeRecommendationConsentEvent,
  options: RecommendationConsentEnforcementOptions | undefined
): Promise<void> {
  if (options?.auditSink === undefined) {
    return;
  }

  try {
    await options.auditSink.record(cloneAuditEvent(event));
  } catch {
    if ((options.auditFailureMode ?? "fail_closed") === "fail_closed") {
      throw new RecommendationConsentAuditError(event);
    }
  }
}

export async function requireRecommendationConsent(
  policy: RecommendationConsentPolicy | null | undefined,
  request: RecommendationConsentRequest,
  options?: RecommendationConsentEnforcementOptions
): Promise<RecommendationConsentEvaluation> {
  const evaluation = evaluateRecommendationConsent(policy, request);

  try {
    await recordConsentAuditEvent(evaluation.auditEvent, options);
  } catch (error) {
    if (evaluation.decision === "deny") {
      throw new RecommendationConsentDeniedError(evaluation);
    }

    throw error;
  }

  if (evaluation.decision === "deny") {
    throw new RecommendationConsentDeniedError(evaluation);
  }

  return evaluation;
}

export async function withRecommendationConsent<T>(
  policy: RecommendationConsentPolicy | null | undefined,
  request: RecommendationConsentRequest,
  operation: () => Promise<T> | T,
  options?: RecommendationConsentEnforcementOptions
): Promise<T> {
  await requireRecommendationConsent(policy, request, options);
  return operation();
}

export async function executeRecommendationDerivedDataDeletion(
  intent: RecommendationDerivedDataDeletionIntent,
  deleter: RecommendationDerivedDataDeleter
): Promise<RecommendationDerivedDataDeletionResult> {
  if (!isValidDeletionIntent(intent)) {
    throw new TypeError("Invalid recommendation derived data deletion intent.");
  }

  if (deleter === null || typeof deleter !== "object" || typeof deleter.deleteDerivedData !== "function") {
    throw new TypeError("Invalid recommendation derived data deleter.");
  }

  try {
    const result = await deleter.deleteDerivedData(intent);
    return sanitizeDeletionResult(result);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("Invalid recommendation derived data deletion result")) {
      throw error;
    }

    throw new RecommendationDerivedDataDeletionError();
  }
}
