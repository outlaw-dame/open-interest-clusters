import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  RECOMMENDATION_LABEL_SEMANTIC_KINDS,
  type RecommendationLabelSemanticClassification,
  type RecommendationLabelSemanticKind
} from "./label-semantic-classification.js";

export const RECOMMENDATION_LABEL_EFFECT_KINDS = [
  "positive_interest",
  "negative_interest",
  "moderation_constraint",
  "safety_constraint",
  "contextual_affinity",
  "presentation_preference",
  "eligibility_constraint",
  "evidence_only"
] as const;

export type RecommendationLabelEffectKind = typeof RECOMMENDATION_LABEL_EFFECT_KINDS[number];

export const RECOMMENDATION_LABEL_EFFECT_POLICY_SOURCES = ["engine_default", "host_app", "imported"] as const;
export type RecommendationLabelEffectPolicySource = typeof RECOMMENDATION_LABEL_EFFECT_POLICY_SOURCES[number];

export const RECOMMENDATION_LABEL_EFFECT_DECISIONS = ["apply", "evidence_only", "not_applicable"] as const;
export type RecommendationLabelEffectDecision = typeof RECOMMENDATION_LABEL_EFFECT_DECISIONS[number];

export type RecommendationLabelEffectReasonCode =
  | "label_effect.apply.engine_default"
  | "label_effect.apply.explicit_policy"
  | "label_effect.evidence_only.engine_default"
  | "label_effect.evidence_only.explicit_policy"
  | "label_effect.not_applicable.unclassified"
  | "label_effect.not_applicable.policy_ignored";

export interface RecommendationLabelEffectPolicyDefinitionInput {
  policyId: string;
  source: Exclude<RecommendationLabelEffectPolicySource, "engine_default">;
  semanticKind: Exclude<RecommendationLabelSemanticKind, "unknown">;
  effectKind: RecommendationLabelEffectKind;
}

export interface RecommendationLabelEffectPolicyDefinition {
  policyId: string;
  source: Exclude<RecommendationLabelEffectPolicySource, "engine_default">;
  semanticKind: Exclude<RecommendationLabelSemanticKind, "unknown">;
  effectKind: RecommendationLabelEffectKind;
}

export interface RecommendationLabelEffectPolicyInput {
  classification: RecommendationLabelSemanticClassification;
  definitions?: readonly RecommendationLabelEffectPolicyDefinitionInput[];
}

export interface RecommendationLabelEffectEvaluation {
  decision: RecommendationLabelEffectDecision;
  semanticKind: RecommendationLabelSemanticKind;
  effectKind?: RecommendationLabelEffectKind;
  reasonCode: RecommendationLabelEffectReasonCode;
  policyId?: string;
  policySource?: RecommendationLabelEffectPolicySource;
}

export interface RecommendationLabelEffectPolicyBatchInput {
  classifications: readonly RecommendationLabelSemanticClassification[];
  definitions?: readonly RecommendationLabelEffectPolicyDefinitionInput[];
}

export interface RecommendationLabelEffectPolicyBatchResult {
  evaluations: readonly RecommendationLabelEffectEvaluation[];
  appliedCount: number;
  evidenceOnlyCount: number;
  notApplicableCount: number;
}

const SEMANTIC_KIND_SET = new Set<string>(RECOMMENDATION_LABEL_SEMANTIC_KINDS);
const EFFECT_KIND_SET = new Set<string>(RECOMMENDATION_LABEL_EFFECT_KINDS);
const POLICY_SOURCE_SET = new Set<string>(RECOMMENDATION_LABEL_EFFECT_POLICY_SOURCES);
const CLASSIFICATION_DECISION_SET = new Set<string>(["classified", "unclassified", "not_applicable"]);
const DEFINITION_SOURCE_SET = new Set<string>(["labeler_declared", "host_app", "imported"]);
const MAX_POLICY_ID_LENGTH = 256;
const MAX_POLICY_DEFINITIONS = 128;
const MAX_DEFINITION_ID_LENGTH = 256;

const ALLOWED_EFFECTS_BY_SEMANTIC_KIND: Readonly<Record<Exclude<RecommendationLabelSemanticKind, "unknown">, ReadonlySet<RecommendationLabelEffectKind>>> = Object.freeze({
  topic_interest: new Set<RecommendationLabelEffectKind>(["positive_interest", "negative_interest", "evidence_only"]),
  moderation: new Set<RecommendationLabelEffectKind>(["moderation_constraint", "evidence_only"]),
  safety: new Set<RecommendationLabelEffectKind>(["safety_constraint", "evidence_only"]),
  identity: new Set<RecommendationLabelEffectKind>(["contextual_affinity", "evidence_only"]),
  community: new Set<RecommendationLabelEffectKind>(["contextual_affinity", "evidence_only"]),
  content_format: new Set<RecommendationLabelEffectKind>(["presentation_preference", "evidence_only"]),
  game: new Set<RecommendationLabelEffectKind>(["contextual_affinity", "evidence_only"]),
  eligibility: new Set<RecommendationLabelEffectKind>(["eligibility_constraint", "evidence_only"])
});

const DEFAULT_EFFECT_BY_SEMANTIC_KIND: Readonly<Record<Exclude<RecommendationLabelSemanticKind, "unknown">, RecommendationLabelEffectKind>> = Object.freeze({
  topic_interest: "positive_interest",
  moderation: "moderation_constraint",
  safety: "safety_constraint",
  identity: "evidence_only",
  community: "evidence_only",
  content_format: "evidence_only",
  game: "evidence_only",
  eligibility: "eligibility_constraint"
});

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

function normalizeSemanticKind(value: unknown): Exclude<RecommendationLabelSemanticKind, "unknown"> {
  if (typeof value !== "string" || value === "unknown" || !SEMANTIC_KIND_SET.has(value)) {
    throw new TypeError("Invalid recommendation label effect semantic kind.");
  }
  return value as Exclude<RecommendationLabelSemanticKind, "unknown">;
}

function normalizeEffectKind(value: unknown): RecommendationLabelEffectKind {
  if (typeof value !== "string" || !EFFECT_KIND_SET.has(value)) {
    throw new TypeError("Invalid recommendation label effect kind.");
  }
  return value as RecommendationLabelEffectKind;
}

function normalizePolicySource(value: unknown): Exclude<RecommendationLabelEffectPolicySource, "engine_default"> {
  if (typeof value !== "string" || value === "engine_default" || !POLICY_SOURCE_SET.has(value)) {
    throw new TypeError("Invalid recommendation label effect policy source.");
  }
  return value as Exclude<RecommendationLabelEffectPolicySource, "engine_default">;
}

export function normalizeRecommendationLabelEffectPolicyDefinition(
  input: RecommendationLabelEffectPolicyDefinitionInput
): RecommendationLabelEffectPolicyDefinition {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid recommendation label effect policy definition input.");
  }

  const semanticKind = normalizeSemanticKind(input.semanticKind);
  const effectKind = normalizeEffectKind(input.effectKind);
  if (!ALLOWED_EFFECTS_BY_SEMANTIC_KIND[semanticKind].has(effectKind)) {
    throw new TypeError("Recommendation label effect is incompatible with semantic kind.");
  }

  return Object.freeze({
    policyId: boundedString(input.policyId, MAX_POLICY_ID_LENGTH, "Invalid recommendation label effect policy ID."),
    source: normalizePolicySource(input.source),
    semanticKind,
    effectKind
  });
}

function normalizeDefinitions(
  values: readonly RecommendationLabelEffectPolicyDefinitionInput[] | undefined
): readonly RecommendationLabelEffectPolicyDefinition[] {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values) || values.length > MAX_POLICY_DEFINITIONS) {
    throw new TypeError("Invalid recommendation label effect policy definitions.");
  }

  const definitions = values.map(normalizeRecommendationLabelEffectPolicyDefinition);
  const ids = new Set<string>();
  const semanticKinds = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.policyId)) {
      throw new TypeError("Duplicate recommendation label effect policy ID.");
    }
    if (semanticKinds.has(definition.semanticKind)) {
      throw new TypeError("Duplicate recommendation label effect semantic policy.");
    }
    ids.add(definition.policyId);
    semanticKinds.add(definition.semanticKind);
  }

  return Object.freeze(definitions);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validateClassification(value: unknown): RecommendationLabelSemanticClassification {
  if (!isPlainRecord(value)) {
    throw new TypeError("Invalid recommendation label effect classification.");
  }
  if (typeof value.decision !== "string" || !CLASSIFICATION_DECISION_SET.has(value.decision)) {
    throw new TypeError("Invalid recommendation label effect classification decision.");
  }
  if (typeof value.semanticKind !== "string" || !SEMANTIC_KIND_SET.has(value.semanticKind)) {
    throw new TypeError("Invalid recommendation label effect classification semantic kind.");
  }

  if (value.decision === "classified") {
    if (
      value.semanticKind === "unknown" ||
      value.reasonCode !== "label_semantics.classified.explicit_definition" ||
      value.confidence !== 1 ||
      typeof value.definitionSource !== "string" ||
      !DEFINITION_SOURCE_SET.has(value.definitionSource) ||
      !hasOnlyKeys(value, new Set(["decision", "semanticKind", "reasonCode", "confidence", "definitionId", "definitionSource"]))
    ) {
      throw new TypeError("Invalid recommendation label effect classification state.");
    }
    boundedString(
      value.definitionId,
      MAX_DEFINITION_ID_LENGTH,
      "Invalid recommendation label effect classification state."
    );
  } else if (value.decision === "unclassified") {
    if (
      value.semanticKind !== "unknown" ||
      value.reasonCode !== "label_semantics.unclassified.no_definition" ||
      value.confidence !== 0 ||
      !hasOnlyKeys(value, new Set(["decision", "semanticKind", "reasonCode", "confidence"]))
    ) {
      throw new TypeError("Invalid recommendation label effect classification state.");
    }
  } else if (
    value.semanticKind !== "unknown" ||
    value.reasonCode !== "label_semantics.not_applicable.policy_ignored" ||
    value.confidence !== 0 ||
    !hasOnlyKeys(value, new Set(["decision", "semanticKind", "reasonCode", "confidence"]))
  ) {
    throw new TypeError("Invalid recommendation label effect classification state.");
  }

  return value as unknown as RecommendationLabelSemanticClassification;
}

function notApplicable(
  semanticKind: RecommendationLabelSemanticKind,
  reasonCode: "label_effect.not_applicable.unclassified" | "label_effect.not_applicable.policy_ignored"
): RecommendationLabelEffectEvaluation {
  return Object.freeze({ decision: "not_applicable", semanticKind, reasonCode });
}

function evaluationForEffect(
  semanticKind: Exclude<RecommendationLabelSemanticKind, "unknown">,
  effectKind: RecommendationLabelEffectKind,
  explicit: RecommendationLabelEffectPolicyDefinition | undefined
): RecommendationLabelEffectEvaluation {
  const decision: RecommendationLabelEffectDecision = effectKind === "evidence_only" ? "evidence_only" : "apply";
  const reasonCode: RecommendationLabelEffectReasonCode = explicit === undefined
    ? (decision === "apply" ? "label_effect.apply.engine_default" : "label_effect.evidence_only.engine_default")
    : (decision === "apply" ? "label_effect.apply.explicit_policy" : "label_effect.evidence_only.explicit_policy");

  const result: RecommendationLabelEffectEvaluation = {
    decision,
    semanticKind,
    effectKind,
    reasonCode,
    policySource: explicit?.source ?? "engine_default"
  };
  if (explicit !== undefined) result.policyId = explicit.policyId;
  return Object.freeze(result);
}

export function evaluateRecommendationLabelEffectPolicy(
  input: RecommendationLabelEffectPolicyInput
): RecommendationLabelEffectEvaluation {
  if (!isPlainRecord(input)) {
    throw new TypeError("Invalid recommendation label effect policy input.");
  }

  const classification = validateClassification(input.classification);
  const definitions = normalizeDefinitions(input.definitions);
  if (classification.decision === "not_applicable") {
    return notApplicable("unknown", "label_effect.not_applicable.policy_ignored");
  }
  if (classification.decision === "unclassified") {
    return notApplicable("unknown", "label_effect.not_applicable.unclassified");
  }

  const semanticKind = classification.semanticKind as Exclude<RecommendationLabelSemanticKind, "unknown">;
  const explicit = definitions.find((definition) => definition.semanticKind === semanticKind);
  return evaluationForEffect(
    semanticKind,
    explicit?.effectKind ?? DEFAULT_EFFECT_BY_SEMANTIC_KIND[semanticKind],
    explicit
  );
}

export function evaluateRecommendationLabelEffectPolicyBatch(
  input: RecommendationLabelEffectPolicyBatchInput
): RecommendationLabelEffectPolicyBatchResult {
  if (!isPlainRecord(input) || !Array.isArray(input.classifications)) {
    throw new TypeError("Invalid recommendation label effect policy batch input.");
  }

  const definitions = normalizeDefinitions(input.definitions);
  const evaluations: RecommendationLabelEffectEvaluation[] = [];
  let appliedCount = 0;
  let evidenceOnlyCount = 0;
  let notApplicableCount = 0;

  for (const classification of input.classifications) {
    const evaluation = evaluateRecommendationLabelEffectPolicy({ classification, definitions });
    evaluations.push(evaluation);
    if (evaluation.decision === "apply") appliedCount += 1;
    else if (evaluation.decision === "evidence_only") evidenceOnlyCount += 1;
    else notApplicableCount += 1;
  }

  return Object.freeze({
    evaluations: Object.freeze(evaluations),
    appliedCount,
    evidenceOnlyCount,
    notApplicableCount
  });
}