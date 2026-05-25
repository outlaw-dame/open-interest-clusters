import {
  createCanonicalRecommendationSourceItem,
  normalizeCanonicalRecommendationEvent,
  type CanonicalRecommendationContentSummary,
  type CanonicalRecommendationEvent,
  type CanonicalRecommendationEventKind,
  type CanonicalRecommendationProjectionMode,
  type CanonicalRecommendationSourceOptions,
  type CanonicalRecommendationVisibility
} from "./canonical-source-adapter.js";
import {
  createAtprotoSourceContext,
  type RecommendationActivityPubVisibility,
  type RecommendationAtprotoRepositoryVisibility,
  type RecommendationAtprotoSourceContextInput
} from "./protocol-source-contexts.js";
import {
  normalizeRecommendationSourceItem,
  type RecommendationSourceItem,
  type RecommendationSourceItemKind,
  type RecommendationSourceTrustBoundary
} from "./source-adapter.js";

export const ACTIVITYPUB_RECOMMENDATION_SOURCE_NORMALIZER_ID = "activitypub-recommendation-normalizer" as const;
export const ATPROTO_RECOMMENDATION_SOURCE_NORMALIZER_ID = "atproto-recommendation-normalizer" as const;

export const RECOMMENDATION_ACTIVITYPUB_NORMALIZED_EVENT_TYPES = [
  "Create",
  "Update",
  "Delete",
  "Like",
  "Announce",
  "Follow",
  "Undo",
  "Flag"
] as const;
export type RecommendationActivityPubNormalizedEventType = typeof RECOMMENDATION_ACTIVITYPUB_NORMALIZED_EVENT_TYPES[number];

export const RECOMMENDATION_ACTIVITYPUB_NORMALIZED_UNDO_TYPES = ["Like", "Announce", "Follow"] as const;
export type RecommendationActivityPubNormalizedUndoType = typeof RECOMMENDATION_ACTIVITYPUB_NORMALIZED_UNDO_TYPES[number];

export const RECOMMENDATION_ACTIVITYPUB_NORMALIZED_OBJECT_TYPES = [
  "Note",
  "Article",
  "Question",
  "Person",
  "Group",
  "Collection",
  "Unknown"
] as const;
export type RecommendationActivityPubNormalizedObjectType = typeof RECOMMENDATION_ACTIVITYPUB_NORMALIZED_OBJECT_TYPES[number];

export const RECOMMENDATION_ATPROTO_NORMALIZED_OPERATIONS = ["create", "update", "delete"] as const;
export type RecommendationAtprotoNormalizedOperation = typeof RECOMMENDATION_ATPROTO_NORMALIZED_OPERATIONS[number];

export const RECOMMENDATION_ATPROTO_NORMALIZED_COLLECTIONS = [
  "app.bsky.feed.post",
  "app.bsky.actor.profile",
  "app.bsky.feed.like",
  "app.bsky.feed.repost",
  "app.bsky.graph.follow",
  "app.bsky.graph.block"
] as const;
export type RecommendationAtprotoNormalizedCollection = typeof RECOMMENDATION_ATPROTO_NORMALIZED_COLLECTIONS[number];

type CanonicalRecommendationContentKind = NonNullable<CanonicalRecommendationContentSummary["kind"]>;

export interface RecommendationProtocolContentInput {
  title?: string | null;
  summary?: string | null;
  plaintext?: string | null;
  language?: string | null;
  tags?: readonly string[];
  links?: readonly string[];
  externalUrl?: string | null;
  linkPreviewUrl?: string | null;
}

export interface RecommendationProtocolSourceNormalizerOptions {
  adapterId?: string;
  sourceSystem?: string;
  defaultTrustBoundary?: RecommendationSourceTrustBoundary;
  includeMirroredEvents?: boolean;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPubNormalizedEvent extends RecommendationProtocolContentInput {
  type: RecommendationActivityPubNormalizedEventType;
  activityId: string;
  actorUri: string;
  actorHandle?: string | null;
  objectId?: string | null;
  objectType?: RecommendationActivityPubNormalizedObjectType;
  targetActorUri?: string | null;
  targetHandle?: string | null;
  undoType?: RecommendationActivityPubNormalizedUndoType;
  visibility: RecommendationActivityPubVisibility;
  publishedAt?: string | null;
  updatedAt?: string | null;
  observedAt: string;
  projectionMode?: CanonicalRecommendationProjectionMode;
  trustBoundary?: RecommendationSourceTrustBoundary;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationAtprotoNormalizedRecordEvent extends RecommendationProtocolContentInput {
  operation: RecommendationAtprotoNormalizedOperation;
  repositoryDid: string;
  collection: RecommendationAtprotoNormalizedCollection;
  rkey?: string | null;
  atUri: string;
  cid?: string | null;
  subjectAtUri?: string | null;
  subjectDid?: string | null;
  handle?: string | null;
  repositoryVisibility?: RecommendationAtprotoRepositoryVisibility;
  createdAt?: string | null;
  indexedAt?: string | null;
  observedAt: string;
  projectionMode?: CanonicalRecommendationProjectionMode;
  trustBoundary?: RecommendationSourceTrustBoundary;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

const MAX_PROTOCOL_ID_LENGTH = 2_048;
const MAX_PROTOCOL_TEXT_LENGTH = 20_000;
const MAX_PROTOCOL_TAG_COUNT = 64;
const MAX_PROTOCOL_LINK_COUNT = 64;
const DEFAULT_ACTIVITYPUB_SOURCE_SYSTEM = "activitypub.normalized.v1";
const DEFAULT_ATPROTO_SOURCE_SYSTEM = "atproto.normalized.v1";
const DEFAULT_PROTOCOL_TRUST_BOUNDARY: RecommendationSourceTrustBoundary = "remote_provider";
const CONTROL_CODE_BLOCK_SIZE = 32;
const C1_CONTROL_CODE_BLOCK = 4;
const ACTIVITYPUB_EVENT_TYPE_SET = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_EVENT_TYPES);
const ACTIVITYPUB_UNDO_TYPE_SET = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_UNDO_TYPES);
const ACTIVITYPUB_OBJECT_TYPE_SET = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_OBJECT_TYPES);
const ACTIVITYPUB_VISIBILITY_SET = new Set<string>([
  "public",
  "unlisted",
  "private",
  "followers_only",
  "direct",
  "mentioned_only",
  "mutuals_only",
  "local_only",
  "unknown"
]);
const ATPROTO_OPERATION_SET = new Set<string>(RECOMMENDATION_ATPROTO_NORMALIZED_OPERATIONS);
const ATPROTO_COLLECTION_SET = new Set<string>(RECOMMENDATION_ATPROTO_NORMALIZED_COLLECTIONS);
const ATPROTO_REPOSITORY_VISIBILITY_SET = new Set<string>(["public_repo", "unknown"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || Math.floor(code / CONTROL_CODE_BLOCK_SIZE) === C1_CONTROL_CODE_BLOCK) {
      return true;
    }
  }

  return false;
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PROTOCOL_ID_LENGTH && !hasControlCharacter(value);
}

function requiredBoundedIdentifier(value: unknown, label: string): string {
  if (!isBoundedIdentifier(value)) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return value;
}

function optionalBoundedIdentifier(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requiredBoundedIdentifier(value, label);
}

function optionalText(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== "string" || value.length > MAX_PROTOCOL_TEXT_LENGTH) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return value;
}

function optionalStringList(value: unknown, maxCount: number, label: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > maxCount) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return Object.freeze(value.map((item) => requiredBoundedIdentifier(item, label)));
}

function normalizeHttpUrl(value: unknown, label: string): string {
  const raw = requiredBoundedIdentifier(value, label).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`Invalid ${label}.`);
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username.length > 0 || url.password.length > 0) {
    throw new TypeError(`Invalid ${label}.`);
  }

  url.hash = "";
  return url.toString();
}

function optionalHttpUrl(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : normalizeHttpUrl(value, label);
}

function isDidMethodChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39);
}

function isDidIdentifierChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    char === "." ||
    char === "_" ||
    char === ":" ||
    char === "%" ||
    char === "-"
  );
}

function normalizeDid(value: unknown, label: string): string {
  const raw = requiredBoundedIdentifier(value, label).trim();
  const parts = raw.split(":");
  const method = parts[1] ?? "";
  const identifier = parts.slice(2).join(":");
  if (parts.length < 3 || parts[0] !== "did" || method.length === 0 || identifier.length === 0) {
    throw new TypeError(`Invalid ${label}.`);
  }

  if (![...method].every(isDidMethodChar) || ![...identifier].every(isDidIdentifierChar)) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return raw;
}

function isHandleLabelChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || char === "-";
}

function isAtprotoHandleAuthority(value: string): boolean {
  if (value.length === 0 || value.length > 253 || value.startsWith(".") || value.endsWith(".")) {
    return false;
  }

  const labels = value.toLocaleLowerCase("en-US").split(".");
  if (labels.length < 2) {
    return false;
  }

  return labels.every((label) => {
    if (label.length === 0 || label.length > 63 || label.startsWith("-") || label.endsWith("-")) {
      return false;
    }

    return [...label].every(isHandleLabelChar);
  });
}

function isAtUriPathSegmentChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    char === "." ||
    char === "_" ||
    char === "-" ||
    char === "~" ||
    char === "%" ||
    char === ":"
  );
}

function assertAtprotoAuthority(value: string, label: string): void {
  if (value.includes("@") || value.includes("/") || value.includes("?") || value.includes("#")) {
    throw new TypeError(`Invalid ${label}.`);
  }

  if (value.startsWith("did:")) {
    normalizeDid(value, label);
    return;
  }

  if (!isAtprotoHandleAuthority(value)) {
    throw new TypeError(`Invalid ${label}.`);
  }
}

function assertAtUriPath(value: string, label: string): void {
  const segments = value.split("/");
  if (segments.length < 2) {
    throw new TypeError(`Invalid ${label}.`);
  }

  for (const segment of segments) {
    if (segment.length === 0 || segment.length > MAX_PROTOCOL_ID_LENGTH || ![...segment].every(isAtUriPathSegmentChar)) {
      throw new TypeError(`Invalid ${label}.`);
    }
  }
}

function normalizeAtUri(value: unknown, label: string): string {
  const raw = requiredBoundedIdentifier(value, label).trim();
  const scheme = "at://";
  if (!raw.startsWith(scheme) || raw.includes("#") || raw.includes("?")) {
    throw new TypeError(`Invalid ${label}.`);
  }

  const rest = raw.slice(scheme.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0 || slashIndex === rest.length - 1) {
    throw new TypeError(`Invalid ${label}.`);
  }

  assertAtprotoAuthority(rest.slice(0, slashIndex), label);
  assertAtUriPath(rest.slice(slashIndex + 1), label);
  return raw;
}

function optionalAtUri(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : normalizeAtUri(value, label);
}

function knownValue<T extends string>(set: ReadonlySet<string>, value: unknown, label: string): T {
  if (typeof value !== "string" || !set.has(value)) {
    throw new TypeError(`Invalid ${label}.`);
  }

  return value as T;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`Invalid ${label}.`);
  return value;
}

function timestampFromNullable(value: string | null | undefined, fallback: string): string {
  return value ?? fallback;
}

function contentKindFromActivityPub(
  type: RecommendationActivityPubNormalizedEventType,
  objectType: RecommendationActivityPubNormalizedObjectType
): CanonicalRecommendationContentKind {
  if (objectType === "Article") return "article";
  if (objectType === "Question") return "poll";
  if (objectType === "Person" || objectType === "Group") return "profile";
  if (type === "Like") return "reaction";
  if (type === "Follow") return "follow";
  if (type === "Announce") return "share";
  if (objectType === "Unknown" || objectType === "Collection") return "unknown";
  return "note";
}

function contentKindFromAtproto(collection: RecommendationAtprotoNormalizedCollection): CanonicalRecommendationContentKind {
  switch (collection) {
    case "app.bsky.feed.post":
      return "note";
    case "app.bsky.actor.profile":
      return "profile";
    case "app.bsky.feed.like":
      return "reaction";
    case "app.bsky.feed.repost":
      return "share";
    case "app.bsky.graph.follow":
      return "follow";
    case "app.bsky.graph.block":
      return "unknown";
  }
}

function buildContentSummary(
  input: RecommendationProtocolContentInput,
  kind: CanonicalRecommendationContentKind
): CanonicalRecommendationContentSummary {
  const title = optionalText(input.title, "protocol source content title");
  const summary = optionalText(input.summary, "protocol source content summary");
  const plaintext = optionalText(input.plaintext, "protocol source content plaintext");
  const language = optionalBoundedIdentifier(input.language, "protocol source content language");
  const tags = optionalStringList(input.tags, MAX_PROTOCOL_TAG_COUNT, "protocol source content tags");
  const links = optionalStringList(input.links, MAX_PROTOCOL_LINK_COUNT, "protocol source content links");
  const externalUrl = input.externalUrl === undefined || input.externalUrl === null
    ? input.externalUrl
    : normalizeHttpUrl(input.externalUrl, "protocol source external URL");
  const linkPreviewUrl = input.linkPreviewUrl === undefined || input.linkPreviewUrl === null
    ? input.linkPreviewUrl
    : normalizeHttpUrl(input.linkPreviewUrl, "protocol source link preview URL");

  const content: CanonicalRecommendationContentSummary = { kind };
  if (title !== undefined) content.title = title;
  if (summary !== undefined) content.summary = summary;
  if (plaintext !== undefined) content.plaintext = plaintext;
  if (language !== undefined) content.language = language;
  if (tags !== undefined) content.tags = tags;
  if (links !== undefined) content.links = links;
  if (externalUrl !== undefined) content.externalUrl = externalUrl;
  if (linkPreviewUrl !== undefined) content.linkPreviewUrl = linkPreviewUrl;
  return Object.freeze(content);
}

function activityPubCanonicalVisibility(visibility: RecommendationActivityPubVisibility): CanonicalRecommendationVisibility {
  switch (visibility) {
    case "public":
      return "public";
    case "unlisted":
      return "unlisted";
    case "private":
    case "followers_only":
    case "mutuals_only":
      return "followers";
    case "direct":
    case "mentioned_only":
      return "direct";
    case "local_only":
      return "local_only";
    case "unknown":
      return "unknown";
  }
}

function activityPubKind(
  type: RecommendationActivityPubNormalizedEventType,
  objectType: RecommendationActivityPubNormalizedObjectType,
  undoType: RecommendationActivityPubNormalizedUndoType | undefined
): CanonicalRecommendationEventKind {
  switch (type) {
    case "Create":
      if (objectType === "Question") return "PollCreate";
      if (objectType === "Person" || objectType === "Group") return "ProfileUpdate";
      return "PostCreate";
    case "Update":
      if (objectType === "Question") return "PollEdit";
      if (objectType === "Person" || objectType === "Group") return "ProfileUpdate";
      return "PostEdit";
    case "Delete":
      return objectType === "Question" ? "PollDelete" : "PostDelete";
    case "Like":
      return "ReactionAdd";
    case "Announce":
      return "ShareAdd";
    case "Follow":
      return "FollowAdd";
    case "Flag":
      return "ReportCreate";
    case "Undo":
      if (undoType === undefined) throw new TypeError("Invalid ActivityPub recommendation undo type.");
      if (undoType === "Like") return "ReactionRemove";
      return undoType === "Announce" ? "ShareRemove" : "FollowRemove";
  }
}

function atprotoKind(
  operation: RecommendationAtprotoNormalizedOperation,
  collection: RecommendationAtprotoNormalizedCollection
): CanonicalRecommendationEventKind | null {
  switch (collection) {
    case "app.bsky.feed.post":
      if (operation === "create") return "PostCreate";
      return operation === "update" ? "PostEdit" : "PostDelete";
    case "app.bsky.actor.profile":
      return operation === "delete" ? "AccountState" : "ProfileUpdate";
    case "app.bsky.feed.like":
      if (operation === "update") throw new TypeError("Invalid ATProto recommendation like operation.");
      return operation === "create" ? "ReactionAdd" : "ReactionRemove";
    case "app.bsky.feed.repost":
      if (operation === "update") throw new TypeError("Invalid ATProto recommendation repost operation.");
      return operation === "create" ? "ShareAdd" : "ShareRemove";
    case "app.bsky.graph.follow":
      if (operation === "update") throw new TypeError("Invalid ATProto recommendation follow operation.");
      return operation === "create" ? "FollowAdd" : "FollowRemove";
    case "app.bsky.graph.block":
      return null;
  }
}

function atprotoDirectSourceItemKind(
  operation: RecommendationAtprotoNormalizedOperation,
  collection: RecommendationAtprotoNormalizedCollection
): RecommendationSourceItemKind | null {
  if (collection !== "app.bsky.graph.block") return null;
  if (operation === "update") throw new TypeError("Invalid ATProto recommendation block operation.");
  return "block";
}

function normalizeProtocolOptions(
  options: RecommendationProtocolSourceNormalizerOptions,
  defaults: { adapterId: string; sourceSystem: string }
): CanonicalRecommendationSourceOptions {
  const rawOptions: unknown = options;
  if (!isPlainRecord(rawOptions)) throw new TypeError("Invalid protocol recommendation source normalizer options.");

  const normalized: CanonicalRecommendationSourceOptions = {
    adapterId: optionalBoundedIdentifier(options.adapterId, "protocol source adapter id") ?? defaults.adapterId,
    sourceSystem: optionalBoundedIdentifier(options.sourceSystem, "protocol source system") ?? defaults.sourceSystem,
    defaultTrustBoundary: options.defaultTrustBoundary ?? DEFAULT_PROTOCOL_TRUST_BOUNDARY
  };

  const includeMirroredEvents = optionalBoolean(options.includeMirroredEvents, "protocol mirrored event flag");
  const containsThirdPartyData = optionalBoolean(options.containsThirdPartyData, "protocol third-party data flag");
  const serverSideProcessing = optionalBoolean(options.serverSideProcessing, "protocol server-side processing flag");
  const providerPolicyAllowsProcessing = optionalBoolean(options.providerPolicyAllowsProcessing, "protocol provider policy flag");
  if (includeMirroredEvents !== undefined) normalized.includeMirroredEvents = includeMirroredEvents;
  if (containsThirdPartyData !== undefined) normalized.containsThirdPartyData = containsThirdPartyData;
  if (serverSideProcessing !== undefined) normalized.serverSideProcessing = serverSideProcessing;
  if (providerPolicyAllowsProcessing !== undefined) normalized.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  return Object.freeze(normalized);
}

function addCanonicalOptionalFlags(
  event: CanonicalRecommendationEvent,
  input: {
    projectionMode?: CanonicalRecommendationProjectionMode;
    trustBoundary?: RecommendationSourceTrustBoundary;
    containsThirdPartyData?: boolean;
    serverSideProcessing?: boolean;
    providerPolicyAllowsProcessing?: boolean;
  }
): CanonicalRecommendationEvent {
  if (input.projectionMode !== undefined) event.projectionMode = input.projectionMode;
  if (input.trustBoundary !== undefined) event.trustBoundary = input.trustBoundary;
  if (input.containsThirdPartyData !== undefined) event.containsThirdPartyData = input.containsThirdPartyData;
  if (input.serverSideProcessing !== undefined) event.serverSideProcessing = input.serverSideProcessing;
  if (input.providerPolicyAllowsProcessing !== undefined) event.providerPolicyAllowsProcessing = input.providerPolicyAllowsProcessing;
  return event;
}

function shouldIncludeDirectAtprotoRecord(
  input: RecommendationAtprotoNormalizedRecordEvent,
  options: CanonicalRecommendationSourceOptions
): boolean {
  if (input.projectionMode === undefined || input.projectionMode === "native") return true;
  if (input.projectionMode === "mirrored") return options.includeMirroredEvents === true;
  throw new TypeError("Invalid ATProto recommendation projection mode.");
}

export function toCanonicalActivityPubRecommendationEvent(input: RecommendationActivityPubNormalizedEvent): CanonicalRecommendationEvent {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ActivityPub recommendation source event.");

  const type = knownValue<RecommendationActivityPubNormalizedEventType>(ACTIVITYPUB_EVENT_TYPE_SET, input.type, "ActivityPub recommendation event type");
  const objectType = input.objectType === undefined
    ? "Unknown"
    : knownValue<RecommendationActivityPubNormalizedObjectType>(ACTIVITYPUB_OBJECT_TYPE_SET, input.objectType, "ActivityPub recommendation object type");
  const undoType = input.undoType === undefined
    ? undefined
    : knownValue<RecommendationActivityPubNormalizedUndoType>(ACTIVITYPUB_UNDO_TYPE_SET, input.undoType, "ActivityPub recommendation undo type");
  const visibility = knownValue<RecommendationActivityPubVisibility>(ACTIVITYPUB_VISIBILITY_SET, input.visibility, "ActivityPub recommendation visibility");
  const observedAt = requiredBoundedIdentifier(input.observedAt, "ActivityPub recommendation observed timestamp");
  const activityId = normalizeHttpUrl(input.activityId, "ActivityPub recommendation activity id");
  const actorUri = normalizeHttpUrl(input.actorUri, "ActivityPub recommendation actor URI");
  const actorHandle = optionalBoundedIdentifier(input.actorHandle, "ActivityPub recommendation actor handle");
  const objectId = optionalHttpUrl(input.objectId, "ActivityPub recommendation object id");
  const targetActorUri = optionalHttpUrl(input.targetActorUri, "ActivityPub recommendation target actor URI");
  const targetHandle = optionalBoundedIdentifier(input.targetHandle, "ActivityPub recommendation target handle");
  const publishedAt = optionalBoundedIdentifier(input.publishedAt, "ActivityPub recommendation published timestamp");
  const updatedAt = optionalBoundedIdentifier(input.updatedAt, "ActivityPub recommendation updated timestamp");

  const event: CanonicalRecommendationEvent = {
    kind: activityPubKind(type, objectType, undoType),
    sourceProtocol: "activitypub",
    sourceEventId: activityId,
    visibility: activityPubCanonicalVisibility(visibility),
    createdAt: timestampFromNullable(publishedAt, timestampFromNullable(updatedAt, observedAt)),
    observedAt,
    actor: Object.freeze({ activityPubActorUri: actorUri, ...(actorHandle === undefined ? {} : { handle: actorHandle }) }),
    content: buildContentSummary(input, contentKindFromActivityPub(type, objectType))
  };

  if (objectId !== undefined) event.object = Object.freeze({ activityPubObjectId: objectId });
  if (targetActorUri !== undefined || targetHandle !== undefined) {
    event.subject = Object.freeze({
      ...(targetActorUri === undefined ? {} : { activityPubActorUri: targetActorUri }),
      ...(targetHandle === undefined ? {} : { handle: targetHandle })
    });
  }

  return normalizeCanonicalRecommendationEvent(addCanonicalOptionalFlags(event, input));
}

export function createActivityPubRecommendationSourceItem(
  input: RecommendationActivityPubNormalizedEvent,
  options: RecommendationProtocolSourceNormalizerOptions = {}
): RecommendationSourceItem | null {
  return createCanonicalRecommendationSourceItem(
    toCanonicalActivityPubRecommendationEvent(input),
    normalizeProtocolOptions(options, { adapterId: ACTIVITYPUB_RECOMMENDATION_SOURCE_NORMALIZER_ID, sourceSystem: DEFAULT_ACTIVITYPUB_SOURCE_SYSTEM })
  );
}

function atprotoCanonicalVisibility(repositoryVisibility: RecommendationAtprotoRepositoryVisibility | undefined): CanonicalRecommendationVisibility {
  return repositoryVisibility === undefined || repositoryVisibility === "public_repo" ? "public" : "unknown";
}

export function toCanonicalAtprotoRecommendationEvent(input: RecommendationAtprotoNormalizedRecordEvent): CanonicalRecommendationEvent {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ATProto recommendation source event.");

  const operation = knownValue<RecommendationAtprotoNormalizedOperation>(ATPROTO_OPERATION_SET, input.operation, "ATProto recommendation operation");
  const collection = knownValue<RecommendationAtprotoNormalizedCollection>(ATPROTO_COLLECTION_SET, input.collection, "ATProto recommendation collection");
  const kind = atprotoKind(operation, collection);
  if (kind === null) throw new TypeError("ATProto recommendation record must be converted directly to a source item.");
  const repositoryDid = normalizeDid(input.repositoryDid, "ATProto recommendation repository DID");
  const atUri = normalizeAtUri(input.atUri, "ATProto recommendation AT URI");
  const cid = optionalBoundedIdentifier(input.cid, "ATProto recommendation CID");
  const subjectAtUri = optionalAtUri(input.subjectAtUri, "ATProto recommendation subject AT URI");
  const subjectDid = input.subjectDid === undefined || input.subjectDid === null
    ? undefined
    : normalizeDid(input.subjectDid, "ATProto recommendation subject DID");
  const handle = optionalBoundedIdentifier(input.handle, "ATProto recommendation handle");
  const repositoryVisibility = input.repositoryVisibility === undefined
    ? undefined
    : knownValue<RecommendationAtprotoRepositoryVisibility>(ATPROTO_REPOSITORY_VISIBILITY_SET, input.repositoryVisibility, "ATProto recommendation repository visibility");
  const observedAt = requiredBoundedIdentifier(input.observedAt, "ATProto recommendation observed timestamp");
  const createdAt = optionalBoundedIdentifier(input.createdAt, "ATProto recommendation created timestamp");
  const indexedAt = optionalBoundedIdentifier(input.indexedAt, "ATProto recommendation indexed timestamp");

  const event: CanonicalRecommendationEvent = {
    kind,
    sourceProtocol: "atproto",
    sourceEventId: atUri,
    visibility: atprotoCanonicalVisibility(repositoryVisibility),
    createdAt: timestampFromNullable(createdAt, timestampFromNullable(indexedAt, observedAt)),
    observedAt,
    actor: Object.freeze({ did: repositoryDid, ...(handle === undefined ? {} : { handle }) }),
    object: Object.freeze({ atUri: subjectAtUri ?? atUri, ...(cid === undefined ? {} : { cid }) }),
    content: buildContentSummary(input, contentKindFromAtproto(collection))
  };

  if (subjectDid !== undefined) event.subject = Object.freeze({ did: subjectDid });
  return normalizeCanonicalRecommendationEvent(addCanonicalOptionalFlags(event, input));
}

function createDirectAtprotoContextInput(
  input: RecommendationAtprotoNormalizedRecordEvent,
  normalizedOptions: CanonicalRecommendationSourceOptions,
  repositoryVisibility: RecommendationAtprotoRepositoryVisibility
): RecommendationAtprotoSourceContextInput {
  const contextInput: RecommendationAtprotoSourceContextInput = { repositoryVisibility };
  const containsThirdPartyData = input.containsThirdPartyData ?? normalizedOptions.containsThirdPartyData;
  const serverSideProcessing = input.serverSideProcessing ?? normalizedOptions.serverSideProcessing;
  const providerPolicyAllowsProcessing = input.providerPolicyAllowsProcessing ?? normalizedOptions.providerPolicyAllowsProcessing;
  if (containsThirdPartyData !== undefined) contextInput.containsThirdPartyData = containsThirdPartyData;
  if (serverSideProcessing !== undefined) contextInput.serverSideProcessing = serverSideProcessing;
  if (providerPolicyAllowsProcessing !== undefined) contextInput.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  return contextInput;
}

export function createAtprotoRecommendationSourceItem(
  input: RecommendationAtprotoNormalizedRecordEvent,
  options: RecommendationProtocolSourceNormalizerOptions = {}
): RecommendationSourceItem | null {
  const operation = knownValue<RecommendationAtprotoNormalizedOperation>(ATPROTO_OPERATION_SET, input.operation, "ATProto recommendation operation");
  const collection = knownValue<RecommendationAtprotoNormalizedCollection>(ATPROTO_COLLECTION_SET, input.collection, "ATProto recommendation collection");
  const directKind = atprotoDirectSourceItemKind(operation, collection);
  const normalizedOptions = normalizeProtocolOptions(options, { adapterId: ATPROTO_RECOMMENDATION_SOURCE_NORMALIZER_ID, sourceSystem: DEFAULT_ATPROTO_SOURCE_SYSTEM });

  if (directKind === null) return createCanonicalRecommendationSourceItem(toCanonicalAtprotoRecommendationEvent(input), normalizedOptions);
  if (!shouldIncludeDirectAtprotoRecord(input, normalizedOptions)) return null;

  normalizeDid(input.repositoryDid, "ATProto recommendation repository DID");
  if (input.subjectDid !== undefined && input.subjectDid !== null) normalizeDid(input.subjectDid, "ATProto recommendation subject DID");
  const observedAt = requiredBoundedIdentifier(input.observedAt, "ATProto recommendation observed timestamp");
  const atUri = normalizeAtUri(input.atUri, "ATProto recommendation AT URI");
  const repositoryVisibility = input.repositoryVisibility === undefined
    ? "public_repo"
    : knownValue<RecommendationAtprotoRepositoryVisibility>(ATPROTO_REPOSITORY_VISIBILITY_SET, input.repositoryVisibility, "ATProto recommendation repository visibility");

  return normalizeRecommendationSourceItem({
    kind: directKind,
    context: createAtprotoSourceContext(createDirectAtprotoContextInput(input, normalizedOptions, repositoryVisibility)),
    provenance: {
      adapterId: normalizedOptions.adapterId ?? ATPROTO_RECOMMENDATION_SOURCE_NORMALIZER_ID,
      sourceSystem: normalizedOptions.sourceSystem ?? DEFAULT_ATPROTO_SOURCE_SYSTEM,
      observedAt,
      trustBoundary: input.trustBoundary ?? normalizedOptions.defaultTrustBoundary ?? DEFAULT_PROTOCOL_TRUST_BOUNDARY,
      opaqueSourceId: `atproto:${atUri}:${operation}`
    }
  });
}
