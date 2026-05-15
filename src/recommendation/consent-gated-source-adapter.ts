import {
  RECOMMENDATION_DATA_USES,
  RECOMMENDATION_PROTOCOLS,
  evaluateRecommendationConsent,
  type PrivacySafeRecommendationConsentEvent,
  type RecommendationConsentEvaluation,
  type RecommendationConsentPolicy,
  type RecommendationConsentRequest,
  type RecommendationDataUse,
  type RecommendationProtocol
} from "./consent.js";
import {
  RecommendationConsentAuditError,
  RecommendationConsentDeniedError,
  type RecommendationConsentEnforcementOptions
} from "./consent-enforcement.js";
import {
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
const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isKnownDataUse(value: unknown): value is RecommendationDataUse {
  return typeof value === "string" && DATA_USE_SET.has(value);
}

function isKnownProtocol(value: unknown): value is RecommendationProtocol {
  return typeof value === "string" && PROTOCOL_SET.has(value);
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
  return Object.freeze({
    decision: event.decision,
    reason: event.reason,
    dataUse: event.dataUse,
    protocol: event.protocol,
    sourceVisibility: event.sourceVisibility,
    accessBasis: event.accessBasis,
    containsPrivateData: event.containsPrivateData,
    containsThirdPartyData: event.containsThirdPartyData,
    serverSideProcessing: event.serverSideProcessing
  });
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

async function recordAuditThenThrowDenied(
  evaluation: RecommendationConsentEvaluation,
  options: RecommendationConsentEnforcementOptions | undefined
): Promise<never> {
  try {
    await recordConsentAuditEvent(evaluation.auditEvent, options);
  } catch {
    throw new RecommendationConsentDeniedError(evaluation);
  }

  throw new RecommendationConsentDeniedError(evaluation);
}

function preflightProtocol(adapter: RecommendationSourceAdapter): RecommendationProtocol {
  return isKnownProtocol(adapter.protocol) && adapter.protocol !== "unknown" ? adapter.protocol : "app_local";
}

function createPreflightConsentRequest(
  subjectId: string,
  dataUse: RecommendationDataUse,
  adapter: RecommendationSourceAdapter
): RecommendationConsentRequest {
  const protocol = preflightProtocol(adapter);
  const request: RecommendationConsentRequest = {
    subjectId,
    dataUse,
    protocol,
    sourceVisibility: protocol === "atproto" ? "atproto_public_repo" : "public",
    accessBasis: protocol === "atproto" ? "atproto_public_repo" : "public_web",
    containsPrivateData: false,
    containsThirdPartyData: false,
    serverSideProcessing: false
  };

  return request;
}

async function requirePolicyBeforeSourceRead(
  policy: RecommendationConsentPolicy | null | undefined,
  subjectId: string,
  dataUse: RecommendationDataUse,
  adapter: RecommendationSourceAdapter,
  options: RecommendationConsentEnforcementOptions | undefined
): Promise<void> {
  if (policy !== null && policy !== undefined) {
    return;
  }

  const evaluation = evaluateRecommendationConsent(
    policy,
    createPreflightConsentRequest(subjectId, dataUse, adapter)
  );

  await recordAuditThenThrowDenied(evaluation, options);
}

function createConsentRequestFromNormalizedSource(
  subjectId: string,
  dataUse: RecommendationDataUse,
  source: RecommendationSourceItem
): RecommendationConsentRequest {
  const request: RecommendationConsentRequest = {
    subjectId,
    dataUse,
    protocol: source.context.protocol,
    sourceVisibility: source.context.sourceVisibility,
    accessBasis: source.context.accessBasis
  };

  if (source.context.containsPrivateData !== undefined) {
    request.containsPrivateData = source.context.containsPrivateData;
  }

  if (source.context.containsThirdPartyData !== undefined) {
    request.containsThirdPartyData = source.context.containsThirdPartyData;
  }

  if (source.context.serverSideProcessing !== undefined) {
    request.serverSideProcessing = source.context.serverSideProcessing;
  }

  if (source.context.providerPolicyAllowsProcessing !== undefined) {
    request.providerPolicyAllowsProcessing = source.context.providerPolicyAllowsProcessing;
  }

  return request;
}

async function evaluateSourceItemConsent(
  source: RecommendationSourceItem,
  subjectId: string,
  dataUse: RecommendationDataUse,
  policy: RecommendationConsentPolicy | null | undefined,
  deniedItemMode: RecommendationDeniedSourceItemMode,
  options: RecommendationConsentEnforcementOptions | undefined
): Promise<AllowedSourceItem | null> {
  const consentRequest = createConsentRequestFromNormalizedSource(subjectId, dataUse, source);
  const evaluation = evaluateRecommendationConsent(policy, consentRequest);

  try {
    await recordConsentAuditEvent(evaluation.auditEvent, options);
  } catch (error) {
    if (evaluation.decision === "deny") {
      throw new RecommendationConsentDeniedError(evaluation);
    }

    throw error;
  }

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
  await requirePolicyBeforeSourceRead(
    input.policy,
    safeReadRequest.subjectId,
    input.dataUse,
    input.adapter,
    input.enforcementOptions
  );

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
