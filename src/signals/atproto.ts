import type { SignalFacetLink, UnifiedSignal } from "./types.js";

function extractLinks(record: Record<string, unknown>): SignalFacetLink[] {
  const facets = Array.isArray(record.facets) ? record.facets : [];
  const links: SignalFacetLink[] = [];

  for (const facet of facets) {
    if (typeof facet !== "object" || facet === null) continue;
    const features = Array.isArray((facet as Record<string, unknown>).features)
      ? (facet as Record<string, unknown>).features as unknown[]
      : [];

    for (const feature of features) {
      if (typeof feature !== "object" || feature === null) continue;
      const value = feature as Record<string, unknown>;
      const featureType = value["$" + "type"];
      if (featureType === "app.bsky.richtext.facet#link" && typeof value.uri === "string") {
        links.push({ url: value.uri });
      }
    }
  }

  return links;
}

export function normalizeATProtoSignal(input: Record<string, unknown>): UnifiedSignal {
  const record = typeof input.record === "object" && input.record !== null
    ? input.record as Record<string, unknown>
    : input;

  const hashtags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    id: String(input.uri ?? input.cid ?? "unknown"),
    canonicalUrl: typeof input.uri === "string" ? input.uri : undefined,
    kind: "post",
    nativeProtocol: "atproto",
    authorId: String(input.did ?? input.authorDid ?? input.author ?? "unknown"),
    authorHandle: typeof input.handle === "string" ? input.handle : undefined,
    text: typeof record.text === "string" ? record.text : "",
    hashtags,
    keywords: [],
    entities: [],
    links: extractLinks(record),
    createdAt: typeof record.createdAt === "string"
      ? record.createdAt
      : new Date().toISOString(),
    visibility: "public",
    indexable: true,
    discoverableAuthor: true
  };
}
