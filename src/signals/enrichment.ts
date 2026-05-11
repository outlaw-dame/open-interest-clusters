import type { EntityExtractor, EntityLinker, LinkedEntity } from "../entities/types.js";
import { extractAndLinkEntities } from "../entities/pipeline.js";
import type { CooccurrenceGraph } from "../graph/cooccurrence-graph.js";
import { ingestPostIntoGraph } from "../graph/ingest.js";
import { dedupeNormalized, normalizeString, type NormalizeHashtagOptions } from "../normalization/hashtags.js";
import type { SignalEntityReference, UnifiedSignal } from "./types.js";

export interface SignalEnrichmentOptions {
  normalization?: NormalizeHashtagOptions;
  extractor?: EntityExtractor;
  linker?: EntityLinker;
  graph?: CooccurrenceGraph;
  includeTextKeywords?: boolean;
  maxKeywords?: number;
}

export interface EnrichedSignalResult {
  signal: UnifiedSignal;
  linkedEntities: LinkedEntity[];
}

const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}_-]*/gu;

function extractKeywords(text: string, maxKeywords: number): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const value = normalizeString(match[0]);
    if (value.length < 2 || seen.has(value)) continue;
    seen.add(value);
    keywords.push(value);
    if (keywords.length >= maxKeywords) break;
  }

  return keywords;
}

function cloneSignalEntities(entities: readonly SignalEntityReference[]): SignalEntityReference[] {
  return entities.map((entity) => {
    const cloned: SignalEntityReference = {
      label: entity.label
    };

    if (entity.wikidataId) cloned.wikidataId = entity.wikidataId;
    if (entity.dbpediaResource) cloned.dbpediaResource = entity.dbpediaResource;
    if (entity.aliases) cloned.aliases = [...entity.aliases];

    return cloned;
  });
}

function toSignalEntities(entities: readonly LinkedEntity[]): SignalEntityReference[] {
  return entities.map((entity) => {
    const signalEntity: SignalEntityReference = {
      label: entity.label
    };

    if (entity.wikidataId) signalEntity.wikidataId = entity.wikidataId;
    if (entity.dbpediaResource) signalEntity.dbpediaResource = entity.dbpediaResource;

    return signalEntity;
  });
}

export async function enrichSignal(
  input: UnifiedSignal,
  options: SignalEnrichmentOptions = {}
): Promise<EnrichedSignalResult> {
  const maxKeywords = Math.max(0, Math.min(options.maxKeywords ?? 64, 512));
  const normalizedHashtags = dedupeNormalized(input.hashtags, options.normalization);
  const normalizedRawTags = input.rawTagStrings
    ? dedupeNormalized(input.rawTagStrings, options.normalization)
    : undefined;

  const existingKeywords = input.keywords.map((keyword) => normalizeString(keyword)).filter((keyword) => keyword.length > 0);
  const textKeywords = options.includeTextKeywords === false ? [] : extractKeywords(input.text, maxKeywords);
  const keywords = Array.from(new Set([...existingKeywords, ...textKeywords])).slice(0, maxKeywords);

  let linkedEntities: LinkedEntity[] = [];

  if (options.extractor) {
    linkedEntities = options.linker
      ? await extractAndLinkEntities(input.text, {
          extractor: options.extractor,
          linker: options.linker
        })
      : await extractAndLinkEntities(input.text, {
          extractor: options.extractor
        });
  }

  if (options.graph) {
    ingestPostIntoGraph(normalizedHashtags, options.graph);
  }

  const signal: UnifiedSignal = {
    ...input,
    hashtags: normalizedHashtags,
    keywords,
    entities: linkedEntities.length > 0 ? toSignalEntities(linkedEntities) : cloneSignalEntities(input.entities),
    links: input.links.map((link) => ({ ...link }))
  };

  if (normalizedRawTags) signal.rawTagStrings = normalizedRawTags;

  return { signal, linkedEntities };
}
