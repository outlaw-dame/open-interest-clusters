import type { UnifiedSignal, SignalKind, SignalVisibility } from "./types.js";

function inferKind(activityType?: string, objectType?: string): SignalKind {
  const normalizedActivity = activityType?.toLowerCase();
  const normalizedObject = objectType?.toLowerCase();

  if (normalizedActivity === "announce") return "repost";
  if (normalizedActivity === "like") return "like";
  if (normalizedActivity === "follow") return "follow";
  if (normalizedObject === "note" || normalizedObject === "article") return "post";

  return "unknown";
}

function inferVisibility(to?: unknown): SignalVisibility {
  if (!Array.isArray(to)) return "unknown";

  const values = to.filter((value): value is string => typeof value === "string");

  if (values.some((value) => value.includes("Public"))) {
    return "public";
  }

  return "unknown";
}

export function normalizeActivityPubSignal(input: Record<string, unknown>): UnifiedSignal {
  const object = typeof input.object === "object" && input.object !== null
    ? input.object as Record<string, unknown>
    : undefined;

  const text = typeof object?.content === "string"
    ? object.content
    : typeof input.content === "string"
      ? input.content
      : "";

  const hashtags = Array.isArray(object?.tag)
    ? object.tag
        .map((tag) => typeof tag === "object" && tag !== null ? tag as Record<string, unknown> : undefined)
        .flatMap((tag) => typeof tag?.name === "string" ? [tag.name] : [])
    : [];

  return {
    id: String(input.id ?? crypto.randomUUID()),
    kind: inferKind(
      typeof input.type === "string" ? input.type : undefined,
      typeof object?.type === "string" ? object.type : undefined
    ),
    nativeProtocol: "activitypub",
    authorId: String(input.actor ?? "unknown"),
    text,
    hashtags,
    keywords: [],
    entities: [],
    links: [],
    createdAt: typeof object?.published === "string"
      ? object.published
      : new Date().toISOString(),
    visibility: inferVisibility(input.to),
    indexable: true,
    discoverableAuthor: true
  };
}
