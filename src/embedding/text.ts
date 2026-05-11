import type { UnifiedSignal } from "../signals/types.js";
import type { InterestCluster } from "../types/schema.js";

export interface EmbeddingTextOptions {
  maxLength?: number;
  includeProtocolHints?: boolean;
}

const DEFAULT_MAX_LENGTH = 4096;

function appendPart(parts: string[], value: string | undefined): void {
  const normalized = value?.trim();
  if (normalized) parts.push(normalized);
}

function boundedJoin(parts: readonly string[], maxLength: number): string {
  const joined = parts.join("\n");
  return joined.length > maxLength ? joined.slice(0, maxLength) : joined;
}

export function signalToEmbeddingText(signal: UnifiedSignal, options: EmbeddingTextOptions = {}): string {
  const maxLength = Math.max(128, Math.min(options.maxLength ?? DEFAULT_MAX_LENGTH, 32_000));
  const parts: string[] = [];

  appendPart(parts, signal.text);

  if (signal.hashtags.length > 0) {
    appendPart(parts, `hashtags: ${signal.hashtags.join(" ")}`);
  }

  if (signal.keywords.length > 0) {
    appendPart(parts, `keywords: ${signal.keywords.join(" ")}`);
  }

  if (signal.entities.length > 0) {
    appendPart(parts, `entities: ${signal.entities.map((entity) => entity.label).join("; ")}`);
  }

  if (options.includeProtocolHints) {
    appendPart(parts, `protocol: ${signal.nativeProtocol}`);
    appendPart(parts, `visibility: ${signal.visibility}`);
  }

  return boundedJoin(parts, maxLength);
}

export function clusterToEmbeddingText(cluster: InterestCluster, options: EmbeddingTextOptions = {}): string {
  const maxLength = Math.max(128, Math.min(options.maxLength ?? DEFAULT_MAX_LENGTH, 32_000));
  const parts: string[] = [];

  appendPart(parts, cluster.display.label);
  appendPart(parts, `cluster: ${cluster.id}`);
  appendPart(parts, `category: ${cluster.display.category}`);
  appendPart(parts, `anchor: ${cluster.anchor.hashtag}`);

  if (cluster.taxonomy.primary_subcategories.length > 0) {
    appendPart(parts, `subcategories: ${cluster.taxonomy.primary_subcategories.join("; ")}`);
  }

  const hashtags = [
    ...cluster.hashtags.anchor,
    ...cluster.hashtags.aliases,
    ...cluster.hashtags.adjacent
  ];

  if (hashtags.length > 0) {
    appendPart(parts, `hashtags: ${hashtags.join(" ")}`);
  }

  const keywords = [
    ...cluster.keywords.high_value,
    ...cluster.keywords.secondary
  ];

  if (keywords.length > 0) {
    appendPart(parts, `keywords: ${keywords.join("; ")}`);
  }

  return boundedJoin(parts, maxLength);
}
