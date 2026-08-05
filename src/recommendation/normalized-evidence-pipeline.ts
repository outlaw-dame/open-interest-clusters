import { sha256Hex } from "../runtime/hash.js";
import {
  RECOMMENDATION_DATA_USES,
  type RecommendationConsentEvaluation,
  type RecommendationConsentPolicy,
  type RecommendationDataUse
} from "./consent.js";
import type { RecommendationConsentEnforcementOptions } from "./consent-enforcement.js";
import {
  readRecommendationSourceAdapterWithConsent,
  type RecommendationConsentGatedSourceAdapterReadResult,
  type RecommendationDeniedSourceItemMode
} from "./consent-gated-source-adapter.js";
import type {
  RecommendationEngineOrchestrator,
  RecommendationEngineProcessResult
} from "./engine-orchestrator.js";
import {
  normalizeRecommendationInterestSignal,
  type RecommendationInterestSignal
} from "./interest-signal.js";
import type { RecommendationSignalLedgerEventInput } from "./signal-ledger.js";
import {
  normalizeRecommendationSourceAdapterReadRequest,
  normalizeRecommendationSourceItem,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterReadRequest,
  type RecommendationSourceItem
} from "./source-adapter.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";

export interface RecommendationNormalizedEvidence {
  evidenceId: string;
  subjectId: string;
  dataUse: RecommendationDataUse;
  source: RecommendationSourceItem;
  consentEvaluation: RecommendationConsentEvaluation;
}

export type RecommendationEvidenceSourceEventIdentifier = (
  source: RecommendationSourceItem,
  index: number
) => string;

export interface RecommendationNormalizedEvidenceBatchInput {
  subjectId: string;
  dataUse: RecommendationDataUse;
  readResult: RecommendationConsentGatedSourceAdapterReadResult;
  identifySourceEvent: RecommendationEvidenceSourceEventIdentifier;
  namespace?: string;
}

export interface RecommendationNormalizedEvidenceBatch {
  evidence: readonly RecommendationNormalizedEvidence[];
  deniedItemCount: number;
  cursor?: string;
}

export type RecommendationEvidenceSignalDeriver = (
  evidence: RecommendationNormalizedEvidence
) => readonly RecommendationInterestSignal[] | Promise<readonly RecommendationInterestSignal[]>;

export interface RecommendationNormalizedEvidencePipelineOptions {
  engine: Pick<RecommendationEngineOrchestrator, "process">;
  identifySourceEvent: RecommendationEvidenceSourceEventIdentifier;
  deriveSignals: RecommendationEvidenceSignalDeriver;
  namespace?: string;
  maxEvidencePerRead?: number;
  maxSignalsPerEvidence?: number;
  maxEventsPerProcess?: number;
}

export interface RecommendationNormalizedEvidencePipelineProcessInput {
  adapter: RecommendationSourceAdapter;
  readRequest: RecommendationSourceAdapterReadRequest;
  dataUse: RecommendationDataUse;
  policy: RecommendationConsentPolicy | null | undefined;
  enforcementOptions?: RecommendationConsentEnforcementOptions;
  deniedItemMode?: RecommendationDeniedSourceItemMode;
  now?: string;
}

export interface RecommendationNormalizedEvidencePipelineProcessResult {
  subjectId: string;
  evidence: readonly RecommendationNormalizedEvidence[];
  signals: readonly RecommendationInterestSignal[];
  events: readonly RecommendationSignalLedgerEventInput[];
  deniedItemCount: number;
  processResult: RecommendationEngineProcessResult;
  cursor?: string;
}

export interface RecommendationNormalizedEvidencePipeline {
  process(
    input: RecommendationNormalizedEvidencePipelineProcessInput
  ): Promise<RecommendationNormalizedEvidencePipelineProcessResult>;
}

const DATA_USE_SET = new Set<string>(RECOMMENDATION_DATA_USES);
const DEFAULT_NAMESPACE = "recommendation-normalized-evidence.v1";
const DEFAULT_MAX_EVIDENCE = 10_000;
const MAX_EVIDENCE = 100_000;
const DEFAULT_MAX_SIGNALS_PER_EVIDENCE = 64;
const MAX_SIGNALS_PER_EVIDENCE = 1_024;
const DEFAULT_MAX_EVENTS_PER_PROCESS = 10_000;
const MAX_EVENTS_PER_PROCESS = 100_000;
const MAX_IDENTIFIER_LENGTH = 2_048;
const MAX_NAMESPACE_LENGTH = 128;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, message: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(message);
  }
  return value;
}

function normalizeDataUse(value: unknown): RecommendationDataUse {
  if (typeof value !== "string" || !DATA_USE_SET.has(value)) {
    throw new TypeError("Invalid recommendation normalized evidence data use.");
  }
  return value as RecommendationDataUse;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, message: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(message);
  }
  return value;
}

function allowedEvaluation(value: unknown): RecommendationConsentEvaluation {
  if (!isPlainRecord(value) || value.decision !== "allow" || !isPlainRecord(value.auditEvent)) {
    throw new TypeError("Invalid recommendation normalized evidence consent evaluation.");
  }
  const evaluation = value as unknown as RecommendationConsentEvaluation;
  if (evaluation.auditEvent.decision !== "allow") {
    throw new TypeError("Invalid recommendation normalized evidence consent evaluation.");
  }
  return evaluation;
}

function assertEvaluationBinding(
  evaluation: RecommendationConsentEvaluation,
  source: RecommendationSourceItem,
  expectedDataUse: RecommendationDataUse
): void {
  const audit = evaluation.auditEvent;
  if (
    evaluation.reason !== audit.reason ||
    evaluation.dataUse !== audit.dataUse ||
    evaluation.protocol !== audit.protocol ||
    evaluation.sourceVisibility !== audit.sourceVisibility ||
    evaluation.accessBasis !== audit.accessBasis ||
    evaluation.containsPrivateData !== audit.containsPrivateData ||
    evaluation.containsThirdPartyData !== audit.containsThirdPartyData ||
    evaluation.serverSideProcessing !== audit.serverSideProcessing ||
    audit.dataUse !== expectedDataUse ||
    audit.protocol !== source.context.protocol ||
    audit.sourceVisibility !== source.context.sourceVisibility ||
    audit.accessBasis !== source.context.accessBasis ||
    audit.containsPrivateData !== (source.context.containsPrivateData ?? false) ||
    audit.containsThirdPartyData !== (source.context.containsThirdPartyData ?? false) ||
    audit.serverSideProcessing !== (source.context.serverSideProcessing ?? false)
  ) {
    throw new TypeError("Recommendation normalized evidence consent does not match its source.");
  }
}

function createEvidenceId(
  namespace: string,
  subjectId: string,
  dataUse: RecommendationDataUse,
  source: RecommendationSourceItem,
  rawSourceEventId: string
): string {
  const material = [
    namespace,
    subjectId,
    dataUse,
    source.provenance.adapterId,
    source.provenance.sourceSystem,
    rawSourceEventId
  ].join("\u0000");
  return `evidence:${sha256Hex(material)}`;
}

function freezeEvidence(value: RecommendationNormalizedEvidence): RecommendationNormalizedEvidence {
  return Object.freeze({
    evidenceId: value.evidenceId,
    subjectId: value.subjectId,
    dataUse: value.dataUse,
    source: value.source,
    consentEvaluation: value.consentEvaluation
  });
}

export function createRecommendationNormalizedEvidenceBatch(
  input: RecommendationNormalizedEvidenceBatchInput
): RecommendationNormalizedEvidenceBatch {
  if (
    !isPlainRecord(input) ||
    !isPlainRecord(input.readResult) ||
    !Array.isArray(input.readResult.items) ||
    !Array.isArray(input.readResult.consentEvaluations) ||
    typeof input.identifySourceEvent !== "function"
  ) {
    throw new TypeError("Invalid recommendation normalized evidence batch input.");
  }

  const subject = boundedString(
    input.subjectId,
    MAX_IDENTIFIER_LENGTH,
    "Invalid recommendation normalized evidence subject ID."
  );
  const dataUse = normalizeDataUse(input.dataUse);
  const namespace = input.namespace === undefined
    ? DEFAULT_NAMESPACE
    : boundedString(
      input.namespace,
      MAX_NAMESPACE_LENGTH,
      "Invalid recommendation normalized evidence namespace."
    );

  if (input.readResult.items.length !== input.readResult.consentEvaluations.length) {
    throw new TypeError("Recommendation normalized evidence source and consent counts differ.");
  }

  const evidence = input.readResult.items.map((rawSource, index) => {
    const source = normalizeRecommendationSourceItem(rawSource);
    const evaluation = allowedEvaluation(input.readResult.consentEvaluations[index]);
    assertEvaluationBinding(evaluation, source, dataUse);
    const rawId = boundedString(
      input.identifySourceEvent(source, index),
      MAX_IDENTIFIER_LENGTH,
      "Invalid recommendation normalized evidence source event ID."
    );
    return freezeEvidence({
      evidenceId: createEvidenceId(namespace, subject, dataUse, source, rawId),
      subjectId: subject,
      dataUse,
      source,
      consentEvaluation: evaluation
    });
  });

  const result: RecommendationNormalizedEvidenceBatch = {
    evidence: Object.freeze(evidence),
    deniedItemCount: input.readResult.deniedItemCount
  };
  if (input.readResult.cursor !== undefined) result.cursor = input.readResult.cursor;
  return Object.freeze(result);
}

function assertSignalBinding(
  signal: RecommendationInterestSignal,
  evidence: RecommendationNormalizedEvidence
): void {
  const source = evidence.source;
  const expectedConsent = evidence.consentEvaluation.auditEvent;
  if (
    signal.dataUse !== evidence.dataUse ||
    signal.evidence.sourceItemKind !== source.kind ||
    signal.evidence.protocol !== source.context.protocol ||
    signal.evidence.sourceVisibility !== source.context.sourceVisibility ||
    signal.evidence.accessBasis !== source.context.accessBasis ||
    signal.evidence.trustBoundary !== source.provenance.trustBoundary ||
    signal.evidence.observedAt !== source.provenance.observedAt ||
    signal.consent.decision !== expectedConsent.decision ||
    signal.consent.reason !== expectedConsent.reason ||
    signal.consent.dataUse !== expectedConsent.dataUse ||
    signal.consent.protocol !== expectedConsent.protocol ||
    signal.consent.sourceVisibility !== expectedConsent.sourceVisibility ||
    signal.consent.accessBasis !== expectedConsent.accessBasis ||
    signal.consent.containsPrivateData !== expectedConsent.containsPrivateData ||
    signal.consent.containsThirdPartyData !== expectedConsent.containsThirdPartyData ||
    signal.consent.serverSideProcessing !== expectedConsent.serverSideProcessing
  ) {
    throw new TypeError("Recommendation signal is not bound to its normalized evidence.");
  }
}

function signalEventId(evidenceId: string, signal: RecommendationInterestSignal, index: number): string {
  const material = [
    evidenceId,
    String(index),
    signal.target.kind,
    signal.target.key,
    signal.action,
    signal.polarity,
    signal.dataUse,
    signal.privacyBoundary
  ].join("\u0000");
  return `signal-event:${sha256Hex(material)}`;
}

export function createRecommendationNormalizedEvidencePipeline(
  options: RecommendationNormalizedEvidencePipelineOptions
): RecommendationNormalizedEvidencePipeline {
  if (
    !isPlainRecord(options) ||
    !isPlainRecord(options.engine) ||
    typeof options.engine.process !== "function" ||
    typeof options.identifySourceEvent !== "function" ||
    typeof options.deriveSignals !== "function"
  ) {
    throw new TypeError("Invalid recommendation normalized evidence pipeline options.");
  }

  const namespace = options.namespace === undefined
    ? DEFAULT_NAMESPACE
    : boundedString(
      options.namespace,
      MAX_NAMESPACE_LENGTH,
      "Invalid recommendation normalized evidence namespace."
    );
  const maxEvidence = positiveInteger(
    options.maxEvidencePerRead,
    DEFAULT_MAX_EVIDENCE,
    MAX_EVIDENCE,
    "Invalid recommendation normalized evidence read limit."
  );
  const maxSignals = positiveInteger(
    options.maxSignalsPerEvidence,
    DEFAULT_MAX_SIGNALS_PER_EVIDENCE,
    MAX_SIGNALS_PER_EVIDENCE,
    "Invalid recommendation normalized evidence signal limit."
  );
  const maxEvents = positiveInteger(
    options.maxEventsPerProcess,
    DEFAULT_MAX_EVENTS_PER_PROCESS,
    MAX_EVENTS_PER_PROCESS,
    "Invalid recommendation normalized evidence event limit."
  );

  return Object.freeze({
    async process(
      input: RecommendationNormalizedEvidencePipelineProcessInput
    ): Promise<RecommendationNormalizedEvidencePipelineProcessResult> {
      if (!isPlainRecord(input)) {
        throw new TypeError("Invalid recommendation normalized evidence pipeline process input.");
      }

      const readRequest = normalizeRecommendationSourceAdapterReadRequest(input.readRequest);
      const dataUse = normalizeDataUse(input.dataUse);
      const readResult = await readRecommendationSourceAdapterWithConsent({
        adapter: input.adapter,
        readRequest,
        dataUse,
        policy: input.policy,
        ...(input.enforcementOptions === undefined ? {} : { enforcementOptions: input.enforcementOptions }),
        ...(input.deniedItemMode === undefined ? {} : { deniedItemMode: input.deniedItemMode })
      });

      if (readResult.items.length > maxEvidence) {
        throw new RangeError("Recommendation normalized evidence read limit exceeded.");
      }

      const batch = createRecommendationNormalizedEvidenceBatch({
        subjectId: readRequest.subjectId,
        dataUse,
        readResult,
        identifySourceEvent: options.identifySourceEvent,
        namespace
      });

      const signals: RecommendationInterestSignal[] = [];
      const events: RecommendationSignalLedgerEventInput[] = [];

      for (const evidence of batch.evidence) {
        const derived = await options.deriveSignals(evidence);
        if (!Array.isArray(derived)) {
          throw new TypeError("Invalid recommendation normalized evidence signal derivation result.");
        }
        if (derived.length > maxSignals) {
          throw new RangeError("Recommendation normalized evidence signal limit exceeded.");
        }
        if (events.length + derived.length > maxEvents) {
          throw new RangeError("Recommendation normalized evidence total event limit exceeded.");
        }

        for (let index = 0; index < derived.length; index += 1) {
          const signal = normalizeRecommendationInterestSignal(derived[index]);
          assertSignalBinding(signal, evidence);
          const sourceEventId = signalEventId(evidence.evidenceId, signal, index);
          const operationId = `apply:${sha256Hex(`${sourceEventId}\u0000${evidence.evidenceId}`)}`;
          signals.push(signal);
          events.push(Object.freeze({
            operation: "apply",
            operationId,
            sourceEventId,
            occurredAt: evidence.source.provenance.observedAt,
            signal
          }));
        }
      }

      const processResult = await options.engine.process({
        subjectId: readRequest.subjectId,
        events: Object.freeze(events),
        ...(input.now === undefined ? {} : { now: input.now })
      });

      const result: RecommendationNormalizedEvidencePipelineProcessResult = {
        subjectId: readRequest.subjectId,
        evidence: batch.evidence,
        signals: Object.freeze(signals),
        events: Object.freeze(events),
        deniedItemCount: batch.deniedItemCount,
        processResult
      };
      if (batch.cursor !== undefined) result.cursor = batch.cursor;
      return Object.freeze(result);
    }
  });
}
