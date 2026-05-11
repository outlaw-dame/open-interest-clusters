import type { UnifiedSignal } from "../signals/types.js";
import type { InterestCluster } from "../types/schema.js";

export interface EmbeddingTextOptions {
  maxLength?: number;
  includeProtocolHints?: boolean;
}

const DEFAULT_MAX_LENGTH = 4096;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appendPart(parts: string[], value: string | undefined): void {
  if (!value) return;

  const normalized = normalizeText(value);

  if (normalized) {
    parts.push(normalized);
  }
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value).toLowerCase())
        .filter(Boolean)
    )
  );
}

function boundedJoin(parts: readonly string[], maxLength: number): string {
  const joined = parts.join("\n");
  return joined.length > maxLength ? joined.slice(0, maxLength) : joined;
}

export function signalToEmbeddingText(signal: UnifiedSignal, options: EmbeddingTextOptions = {}): string {
  const maxLength = Math.max(128, Math.min(options.maxLength ?? DEFAULT_MAX_LENGTH, 32_000));
  const parts: string[] = [];

  appendPart(parts, signal.text);

  const hashtags = dedupe(signal.hashtags);
  if (hashtags.length > 0) {
    appendPart(parts, `hashtags: ${hashtags.join(" ")}`);
  }

  const keywords = dedupe(signal.keywords);
  if (keywords.length > 0) {
    appendPart(parts, `keywords: ${keywords.join(" ")}`);
  }

  const entities = dedupe(signal.entities.map((entity) => entity.label));
  if (entities.length > 0) {
    appendPart(parts, `entities: ${entities.join("; ")}`);
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
    appendPart(parts, `subcategories: ${dedupe(cluster.taxonomy.primary_subcategories).join("; ")}`);
  }

  const hashtags = dedupe([
    ...cluster.hashtags.anchor,
    ...cluster.hashtags.aliases,
    ...cluster.hashtags.adjacent
  ]);

  if (hashtags.length > 0) {
    appendPart(parts, `hashtags: ${hashtags.join(" ")}`);
  }

  const keywords = dedupe([
    ...cluster.keywords.high_value,
    ...cluster.keywords.secondary
  ]);

  if (keywords.length > 0) {
    appendPart(parts, `keywords: ${keywords.join("; ")}`);
  }

  return boundedJoin(parts, maxLength);
}
