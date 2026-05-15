import {
  type RecommendationConsentEvaluation,
  type RecommendationConsentPolicy,
  type RecommendationDataUse
} from "./consent.js";
import {
  RecommendationConsentDeniedError,
  requireRecommendationConsent,
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isDeniedItemMode(value: unknown): value is RecommendationDeniedSourceItemMode | undefined {
  return value === undefined || value === "fail_closed" || value === "filter_denied";
}

function freezeItems(items: RecommendationSourceItem[]): readonly RecommendationSourceItem[] {
  return Object.freeze(items);
}

function freezeEvaluations(evaluations: RecommendationConsentEvaluation[]): readonly RecommendationConsentEvaluation[] {
  return Object.freeze(evaluations.map((evaluation) => Object.freeze({ ...evaluation, auditEvent: Object.freeze({ ...evaluation.auditEvent }) })));
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
  if (!isObject(input) || !isDeniedItemMode(input.deniedItemMode)) {
    throw new TypeError("Invalid recommendation consent-gated source adapter read input.");
  }

  const safeReadRequest = normalizeRecommendationSourceAdapterReadRequest(input.readRequest);
  const deniedItemMode = input.deniedItemMode ?? "fail_closed";
  const sourceResult = await readRecommendationSourceAdapter(input.adapter, safeReadRequest);
  const allowedItems: RecommendationSourceItem[] = [];
  const consentEvaluations: RecommendationConsentEvaluation[] = [];
  let deniedItemCount = 0;

  for (const source of sourceResult.items) {
    const consentRequest = createRecommendationConsentRequestFromSource({
      subjectId: safeReadRequest.subjectId,
      dataUse: input.dataUse,
      source
    });

    try {
      const evaluation = await requireRecommendationConsent(input.policy, consentRequest, input.enforcementOptions);
      allowedItems.push(source);
      consentEvaluations.push(evaluation);
    } catch (error) {
      if (deniedItemMode === "filter_denied" && error instanceof RecommendationConsentDeniedError) {
        deniedItemCount += 1;
        continue;
      }

      throw error;
    }
  }

  return createReadResult(allowedItems, consentEvaluations, deniedItemCount, sourceResult.cursor);
}
