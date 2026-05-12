import type { LocalPreferenceExplanation } from "./types.js";

export interface RecommendationExplanationComponent {
  label: string;
  contribution: number;
}

export interface RecommendationExplanation {
  clusterId: string;
  summary: string;
  components: RecommendationExplanationComponent[];
  confidence: number;
}

const MAX_COMPONENTS = 8;

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function projectRecommendationExplanation(
  explanation: Readonly<LocalPreferenceExplanation>
): RecommendationExplanation {
  const components: RecommendationExplanationComponent[] = [];

  if (explanation.weight !== 0) {
    components.push({
      label: "local_preference_weight",
      contribution: explanation.weight
    });
  }

  if (explanation.banditScore !== 0) {
    components.push({
      label: "local_feedback_bandit",
      contribution: explanation.banditScore
    });
  }

  const bounded = components
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .slice(0, MAX_COMPONENTS);

  let summary = "No significant local personalization signals.";

  switch (explanation.reason) {
    case "combined":
      summary = "Ranked using explicit interests and local interaction feedback.";
      break;
    case "explicit_interest":
      summary = "Ranked using explicit local interests.";
      break;
    case "local_feedback":
      summary = "Ranked using local interaction feedback.";
      break;
  }

  return {
    clusterId: explanation.clusterId,
    summary,
    components: bounded,
    confidence: clampConfidence(Math.abs(explanation.weight) / 100)
  };
}
