import type {
  NativeProtocol,
  SignalEntityReference,
  SignalFacetLink,
  SignalKind,
  SignalVisibility,
  UnifiedSignal,
  UpstreamOrigin
} from "./types.js";

export interface CanonicalRecommendationSignalInput {
  id: string;
  kind?: SignalKind;
  nativeProtocol: NativeProtocol;
  upstreamOrigin?: UpstreamOrigin;
  sourceHint?: string;
  authorId: string;
  authorHandle?: string;
  authorDisplayName?: string;
  text?: string;
  language?: string;
  hashtags?: readonly string[];
  keywords?: readonly string[];
  entities?: readonly SignalEntityReference[];
  links?: readonly SignalFacetLink[];
  createdAt?: string;
  visibility?: SignalVisibility;
  indexable?: boolean;
  discoverableAuthor?: boolean;
  canonicalUrl?: string;
  replyToId?: string;
  quoteOfId?: string;
  repostOfId?: string;
  rawTagStrings?: readonly string[];
  rawMentions?: readonly string[];
  rawProtocolMetadata?: Record<string, unknown>;
}

function copyStrings(values: readonly string[] | undefined): string[] {
  return values ? [...values] : [];
}

function copyEntities(values: readonly SignalEntityReference[] | undefined): SignalEntityReference[] {
  if (!values) return [];

  return values.map((entity) => {
    const copied: SignalEntityReference = {
      label: entity.label
    };

    if (entity.wikidataId) copied.wikidataId = entity.wikidataId;
    if (entity.dbpediaResource) copied.dbpediaResource = entity.dbpediaResource;
    if (entity.aliases) copied.aliases = [...entity.aliases];

    return copied;
  });
}

function copyLinks(values: readonly SignalFacetLink[] | undefined): SignalFacetLink[] {
  return values ? values.map((link) => ({ ...link })) : [];
}

export function normalizeCanonicalSignal(input: CanonicalRecommendationSignalInput): UnifiedSignal {
  const signal: UnifiedSignal = {
    id: input.id,
    kind: input.kind ?? "unknown",
    nativeProtocol: input.nativeProtocol,
    authorId: input.authorId,
    text: input.text ?? "",
    hashtags: copyStrings(input.hashtags),
    keywords: copyStrings(input.keywords),
    entities: copyEntities(input.entities),
    links: copyLinks(input.links),
    createdAt: input.createdAt ?? new Date(0).toISOString(),
    visibility: input.visibility ?? "unknown"
  };

  if (input.upstreamOrigin) signal.upstreamOrigin = input.upstreamOrigin;
  if (input.sourceHint) signal.sourceHint = input.sourceHint;
  if (input.authorHandle) signal.authorHandle = input.authorHandle;
  if (input.authorDisplayName) signal.authorDisplayName = input.authorDisplayName;
  if (input.language) signal.language = input.language;
  if (typeof input.indexable === "boolean") signal.indexable = input.indexable;
  if (typeof input.discoverableAuthor === "boolean") signal.discoverableAuthor = input.discoverableAuthor;
  if (input.canonicalUrl) signal.canonicalUrl = input.canonicalUrl;
  if (input.replyToId) signal.replyToId = input.replyToId;
  if (input.quoteOfId) signal.quoteOfId = input.quoteOfId;
  if (input.repostOfId) signal.repostOfId = input.repostOfId;
  if (input.rawTagStrings) signal.rawTagStrings = copyStrings(input.rawTagStrings);
  if (input.rawMentions) signal.rawMentions = copyStrings(input.rawMentions);
  if (input.rawProtocolMetadata) signal.rawProtocolMetadata = { ...input.rawProtocolMetadata };

  return signal;
}
