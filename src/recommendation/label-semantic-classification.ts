import { hasUnsafeControlCharacter } from "./control-characters.js";
import type {
  RecommendationLabelRecordKind,
  RecommendationLabelTargetKind,
  RecommendationLabelerEvidence,
  RecommendationLabelerSignalEvaluation
} from "./labeler-signal-policy.js";

export const RECOMMENDATION_LABEL_SEMANTIC_KINDS = [
  "topic_interest",
  "moderation",
  "safety",
  "identity",
  "community",
  "content_format",
  "game",
  "eligibility",
  "unknown"
] as const;

export type RecommendationLabelSemanticKind = typeof RECOMMENDATION_LABEL_SEMANTIC_KINDS[number];

export const RECOMMENDATION_LABEL_SEMANTIC_CLASSIFICATION_DECISIONS = [
  "classified",
  "unclassified",
  "not_applicable"
] as const;

export type RecommendationLabelSemanticClassificationDecision =
  typeof RECOMMENDATION_LABEL_SEMANTIC_CLASSIFICATION_DECISIONS[number];

export type RecommendationLabelSemanticClassificationReasonCode =
  | "label_semantics.classified.explicit_definition"
  | "label_semantics.unclassified.no_definition"
  | "label_semantics.not_applicable.policy_ignored";

export interface RecommendationLabelSemanticDefinitionInput {
  definitionId: string;
  labelerDid: string;
  value: string;
  semanticKind: Exclude<RecommendationLabelSemanticKind, "unknown">;
  targetKinds?: readonly RecommendationLabelTargetKind[];
  recordKinds?: readonly RecommendationLabelRecordKind[];
}

export interface RecommendationLabelSemanticDefinition {
  definitionId: string;
  labelerDid: string;
  value: string;
  semanticKind: Exclude<RecommendationLabelSemanticKind, "unknown">;
  targetKinds: readonly RecommendationLabelTargetKind[];
  recordKinds: readonly RecommendationLabelRecordKind[];
}

export interface RecommendationLabelSemanticClassificationInput {
  evaluation: RecommendationLabelerSignalEvaluation;
  definitions?: readonly RecommendationLabelSemanticDefinitionInput[];
}

export interface RecommendationLabelSemanticClassification {
  decision: RecommendationLabelSemanticClassificationDecision;
  semanticKind: RecommendationLabelSemanticKind;
  reasonCode: RecommendationLabelSemanticClassificationReasonCode;
  confidence: 0 | 1;
  definitionId?: string;
}

export interface RecommendationLabelSemanticClassificationBatchInput {
  evaluations: readonly RecommendationLabelerSignalEvaluation[];
  definitions?: readonly RecommendationLabelSemanticDefinitionInput[];
}

export interface RecommendationLabelSemanticClassificationBatchResult {
  classifications: readonly RecommendationLabelSemanticClassification[];
  classifiedCount: number;
  unclassifiedCount: number;
  notApplicableCount: number;
}

const SEMANTIC_KIND_SET = new Set<string>(RECOMMENDATION_LABEL_SEMANTIC_KINDS);
const TARGET_KIND_SET = new Set<string>(["repository", "record", "blob", "unknown"]);
const RECORD_KIND_SET = new Set<string>(["profile", "post", "feed", "list", "starter_pack", "custom", "unknown"]);
const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;
const LABEL_VALUE_PATTERN = /^!?[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MAX_DEFINITIONS = 10_000;
const MAX_DEFINITION_ID_LENGTH = 256;
const MAX_DID_LENGTH = 256;
const MAX_LABEL_VALUE_LENGTH = 128;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number, message: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maxLength ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(message);
  }

  return value;
}

function normalizeDefinitionId(value: unknown): string {
  return boundedString(value, MAX_DEFINITION_ID_LENGTH, "Invalid recommendation label semantic definition ID.");
}

function normalizeLabelerDid(value: unknown): string {
  const did = boundedString(value, MAX_DID_LENGTH, "Invalid recommendation label semantic definition labeler DID.");
  if (!DID_PATTERN.test(did) || /\s/u.test(did)) {
    throw new TypeError("Invalid recommendation label semantic definition labeler DID.");
  }

  return did;
}

function normalizeLabelValue(value: unknown): string {
  const label = boundedString(value, MAX_LABEL_VALUE_LENGTH, "Invalid recommendation label semantic definition value.");
  if (!LABEL_VALUE_PATTERN.test(label)) {
    throw new TypeError("Invalid recommendation label semantic definition value.");
  }

  return label.toLocaleLowerCase("en-US");
}

function normalizeSemanticKind(value: unknown): Exclude<RecommendationLabelSemanticKind, "unknown"> {
  if (typeof value !== "string" || value === "unknown" || !SEMANTIC_KIND_SET.has(value)) {
    throw new TypeError("Invalid recommendation label semantic kind.");
  }

  return value as Exclude<RecommendationLabelSemanticKind, "unknown">;
}

function normalizeUniqueStringArray<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  message: string
): readonly T[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(message);

  const normalized: T[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item) || seen.has(item)) {
      throw new TypeError(message);
    }
    seen.add(item);
    normalized.push(item as T);
  }

  return Object.freeze(normalized.sort());
}

export function normalizeRecommendationLabelSemanticDefinition(
  input: RecommendationLabelSemanticDefinitionInput
): RecommendationLabelSemanticDefinition {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid recommendation label semantic definition input.");
  }

  return Object.freeze({
    definitionId: normalizeDefinitionId(input.definitionId),
    labelerDid: normalizeLabelerDid(input.labelerDid),
    value: normalizeLabelValue(input.value),
    semanticKind: normalizeSemanticKind(input.semanticKind),
    targetKinds: normalizeUniqueStringArray<RecommendationLabelTargetKind>(
      input.targetKinds,
      TARGET_KIND_SET,
      "Invalid recommendation label semantic target kinds."
    ),
    recordKinds: normalizeUniqueStringArray<RecommendationLabelRecordKind>(
      input.recordKinds,
      RECORD_KIND_SET,
      "Invalid recommendation label semantic record kinds."
    )
  });
}

function definitionSpecificity(definition: RecommendationLabelSemanticDefinition): number {
  return (definition.targetKinds.length > 0 ? 1 : 0) + (definition.recordKinds.length > 0 ? 1 : 0);
}

function definitionMatches(
  definition: RecommendationLabelSemanticDefinition,
  evidence: RecommendationLabelerEvidence
): boolean {
  if (definition.labelerDid !== evidence.labelerDid) return false;
  if (definition.value !== evidence.value.toLocaleLowerCase("en-US")) return false;
  if (definition.targetKinds.length > 0 && !definition.targetKinds.includes(evidence.target.kind)) return false;

  if (definition.recordKinds.length > 0) {
    const recordKind = evidence.target.recordKind;
    if (recordKind === undefined || !definition.recordKinds.includes(recordKind)) return false;
  }

  return true;
}

function normalizeDefinitions(
  values: readonly RecommendationLabelSemanticDefinitionInput[] | undefined
): readonly RecommendationLabelSemanticDefinition[] {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values) || values.length > MAX_DEFINITIONS) {
    throw new TypeError("Invalid recommendation label semantic definitions.");
  }

  const definitions = values.map(normalizeRecommendationLabelSemanticDefinition);
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.definitionId)) {
      throw new TypeError("Duplicate recommendation label semantic definition ID.");
    }
    ids.add(definition.definitionId);
  }

  return Object.freeze(definitions);
}

function selectDefinition(
  definitions: readonly RecommendationLabelSemanticDefinition[],
  evidence: RecommendationLabelerEvidence
): RecommendationLabelSemanticDefinition | undefined {
  const matches = definitions
    .filter((definition) => definitionMatches(definition, evidence))
    .sort((left, right) => definitionSpecificity(right) - definitionSpecificity(left));

  const selected = matches[0];
  if (selected === undefined) return undefined;

  const selectedSpecificity = definitionSpecificity(selected);
  const conflicting = matches.find(
    (candidate, index) =>
      index > 0 &&
      definitionSpecificity(candidate) === selectedSpecificity &&
      candidate.semanticKind !== selected.semanticKind
  );
  if (conflicting !== undefined) {
    throw new TypeError("Conflicting recommendation label semantic definitions.");
  }

  return selected;
}

function notApplicable(): RecommendationLabelSemanticClassification {
  return Object.freeze({
    decision: "not_applicable",
    semanticKind: "unknown",
    reasonCode: "label_semantics.not_applicable.policy_ignored",
    confidence: 0
  });
}

function unclassified(): RecommendationLabelSemanticClassification {
  return Object.freeze({
    decision: "unclassified",
    semanticKind: "unknown",
    reasonCode: "label_semantics.unclassified.no_definition",
    confidence: 0
  });
}

export function classifyRecommendationLabelSemantics(
  input: RecommendationLabelSemanticClassificationInput
): RecommendationLabelSemanticClassification {
  if (!isPlainRecord(input) || !isPlainRecord(input.evaluation)) {
    throw new TypeError("Invalid recommendation label semantic classification input.");
  }

  if (input.evaluation.decision !== "accept") return notApplicable();
  if (!isPlainRecord(input.evaluation.evidence)) {
    throw new TypeError("Invalid recommendation label semantic classification evidence.");
  }

  const definitions = normalizeDefinitions(input.definitions);
  const definition = selectDefinition(definitions, input.evaluation.evidence);
  if (definition === undefined) return unclassified();

  return Object.freeze({
    decision: "classified",
    semanticKind: definition.semanticKind,
    reasonCode: "label_semantics.classified.explicit_definition",
    confidence: 1,
    definitionId: definition.definitionId
  });
}

export function classifyRecommendationLabelSemanticsBatch(
  input: RecommendationLabelSemanticClassificationBatchInput
): RecommendationLabelSemanticClassificationBatchResult {
  if (!isPlainRecord(input) || !Array.isArray(input.evaluations)) {
    throw new TypeError("Invalid recommendation label semantic classification batch input.");
  }

  const definitions = normalizeDefinitions(input.definitions);
  const classifications: RecommendationLabelSemanticClassification[] = [];
  let classifiedCount = 0;
  let unclassifiedCount = 0;
  let notApplicableCount = 0;

  for (const evaluation of input.evaluations) {
    const classification = classifyRecommendationLabelSemantics({ evaluation, definitions });
    classifications.push(classification);
    if (classification.decision === "classified") classifiedCount += 1;
    else if (classification.decision === "unclassified") unclassifiedCount += 1;
    else notApplicableCount += 1;
  }

  return Object.freeze({
    classifications: Object.freeze(classifications),
    classifiedCount,
    unclassifiedCount,
    notApplicableCount
  });
}
