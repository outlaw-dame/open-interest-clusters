import {
  RECOMMENDATION_DATA_USES,
  evaluateRecommendationConsent,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentEvaluation,
  type RecommendationConsentPolicy,
  type RecommendationDataUse
} from "./consent.js";
import {
  RecommendationConsentAuditError,
  RecommendationConsentDeniedError,
  type RecommendationConsentEnforcementOptions
} from "./consent-enforcement.js";
import {
  createRecommendationConsentRequestFromSource,
  normalizeRecommendationSourceAdapterReadRequest,
  readRecommendationSourceAdapter,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterReadRequest,
  type RecommendationSourceItem
} from "./source-adapter.js";

export type RecommendationDeniedSourceItemMode = "fail_closed" | "filter_denied";

export interface RecommendationConsentGatedSourceAdapterReadInput {
  adapter: RecommendationSourceAdapter;
  readRequest: RecommendationSourceAdapterReadRequest;
  dataUse: RecommendationDataUse;
  policy: RecommendationConsentPolicy | null | undefined;
  enforcementOptions?: RecommendationConsentEnforcementOptions;
  deniedItemMode?: RecommendationDeniedSourceItemMode;
}

export interface RecommendationConsentGatedSourceAdapterReadResult {
  items: readonly RecommendationSourceItem[];
  consentEvaluations: readonly RecommendationConsentEvaluation[];
  deniedItemCount: number;
  cursor?: string;
}

interface AllowedSourceItem {
  source: RecommendationSourceItem;
  evaluation: RecommendationConsentEvaluation;
}

const DATA_USE_SET = new Set<string>(RECOMMENDATION_DATA_USES);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isKnownDataUse(value: unknown): value is RecommendationDataUse {
  return typeof value === "string" && DATA_USE_SET.has(value);
}

function isDeniedItemMode(value: unknown): value is RecommendationDeniedSourceItemMode | undefined {
  return value === undefined || value === "fail_closed" || value === "filter_denied";
}

function freezeItems(items: RecommendationSourceItem[]): readonly RecommendationSourceItem[] {
  return Object.freeze(items);
}

function freezeEvaluations(evaluations: RecommendationConsentEvaluation[]): readonly RecommendationConsentEvaluation[] {
  return Object.freeze(evaluations);
}

function cloneAuditEvent(event: PrivacySafeRecommendationConsentEvent): PrivacySafeRecommendationConsentEvent {
  return Object.freeze({ ...event });
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

async function evaluateSourceItemConsent(
  source: RecommendationSourceItem,
  subjectId: string,
  dataUse: RecommendationDataUse,
  policy: RecommendationConsentPolicy | null | undefined,
  deniedItemMode: RecommendationDeniedSourceItemMode,
  options: RecommendationConsentEnforcementOptions | undefined
): Promise<AllowedSourceItem | null> {
  const consentRequest = createRecommendationConsentRequestFromSource({
    subjectId,
    dataUse,
    source
  });
  const evaluation = evaluateRecommendationConsent(policy, consentRequest);

  await recordConsentAuditEvent(evaluation.auditEvent, options);

  if (evaluation.decision === "deny") {
    if (deniedItemMode === "filter_denied") {
      return null;
    }

    throw new RecommendationConsentDeniedError(evaluation);
  }

  return { source, evaluation };
}

function createReadResult(
  items: RecommendationSourceItem[],
  evaluations: RecommendationConsentEvaluation[],
  deniedItemCount: number,
  cursor: string | undefined
): RecommendationConsentGatedSourceAdapterReadResult {
  const result: RecommendationConsentGatedSourceAdapterReadResult = {
    items: freezeItems(items),
    consentEvaluations: freezeEvaluations(evaluations),
    deniedItemCount
  };

  if (cursor !== undefined) {
    result.cursor = cursor;
  }

  return Object.freeze(result);
}

export async function readRecommendationSourceAdapterWithConsent(
  input: RecommendationConsentGatedSourceAdapterReadInput
): Promise<RecommendationConsentGatedSourceAdapterReadResult> {
  if (!isObject(input) || !isDeniedItemMode(input.deniedItemMode) || !isKnownDataUse(input.dataUse)) {
    throw new TypeError("Invalid recommendation consent-gated source adapter read input.");
  }

  const safeReadRequest = normalizeRecommendationSourceAdapterReadRequest(input.readRequest);
  const deniedItemMode = input.deniedItemMode ?? "fail_closed";
  const sourceResult = await readRecommendationSourceAdapter(input.adapter, safeReadRequest);
  const evaluations = await Promise.all(
    sourceResult.items.map((source) =>
      evaluateSourceItemConsent(
        source,
        safeReadRequest.subjectId,
        input.dataUse,
        input.policy,
        deniedItemMode,
        input.enforcementOptions
      )
    )
  );
  const allowedItems: RecommendationSourceItem[] = [];
  const consentEvaluations: RecommendationConsentEvaluation[] = [];
  let deniedItemCount = 0;

  for (const evaluation of evaluations) {
    if (evaluation === null) {
      deniedItemCount += 1;
      continue;
    }

    allowedItems.push(evaluation.source);
    consentEvaluations.push(evaluation.evaluation);
  }

  return createReadResult(allowedItems, consentEvaluations, deniedItemCount, sourceResult.cursor);
}
