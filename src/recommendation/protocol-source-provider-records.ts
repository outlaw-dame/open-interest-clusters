import type { CanonicalRecommendationProjectionMode } from "./canonical-source-adapter.js";
import type { RecommendationActivityPubVisibility, RecommendationAtprotoRepositoryVisibility } from "./protocol-source-contexts.js";
import {
  RECOMMENDATION_ACTIVITYPUB_NORMALIZED_EVENT_TYPES,
  RECOMMENDATION_ACTIVITYPUB_NORMALIZED_OBJECT_TYPES,
  RECOMMENDATION_ACTIVITYPUB_NORMALIZED_UNDO_TYPES,
  RECOMMENDATION_ATPROTO_NORMALIZED_COLLECTIONS,
  RECOMMENDATION_ATPROTO_NORMALIZED_OPERATIONS,
  type RecommendationActivityPubNormalizedEvent,
  type RecommendationActivityPubNormalizedEventType,
  type RecommendationActivityPubNormalizedObjectType,
  type RecommendationActivityPubNormalizedUndoType,
  type RecommendationAtprotoNormalizedCollection,
  type RecommendationAtprotoNormalizedOperation,
  type RecommendationAtprotoNormalizedRecordEvent,
  type RecommendationProtocolContentInput
} from "./protocol-source-normalizers.js";
import { normalizeRecommendationSourceAdapterReadRequest, type RecommendationSourceTrustBoundary } from "./source-adapter.js";

export interface RecommendationProtocolProviderRecordFlags {
  projectionMode?: CanonicalRecommendationProjectionMode;
  trustBoundary?: RecommendationSourceTrustBoundary;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface RecommendationActivityPubProviderActivityMapInput extends RecommendationProtocolProviderRecordFlags {
  rawActivity: unknown;
  observedAt: string;
  fallbackActorUri?: string;
  fallbackVisibility?: RecommendationActivityPubVisibility;
}

export interface RecommendationMastodonProviderStatusMapInput extends RecommendationProtocolProviderRecordFlags {
  rawStatus: unknown;
  observedAt: string;
}

export interface RecommendationAtprotoProviderRecordMapInput extends RecommendationProtocolProviderRecordFlags {
  operation: RecommendationAtprotoNormalizedOperation;
  repositoryDid: string;
  collection: RecommendationAtprotoNormalizedCollection;
  observedAt: string;
  record?: unknown;
  rkey?: string;
  atUri?: string;
  cid?: string;
  handle?: string;
  repositoryVisibility?: RecommendationAtprotoRepositoryVisibility;
  indexedAt?: string;
}

const MAX_ID_LENGTH = 2_048;
const MAX_TEXT_LENGTH = 20_000;
const MAX_TAGS = 64;
const AP_EVENT_TYPES = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_EVENT_TYPES);
const AP_OBJECT_TYPES = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_OBJECT_TYPES);
const AP_UNDO_TYPES = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_UNDO_TYPES);
const AT_OPS = new Set<string>(RECOMMENDATION_ATPROTO_NORMALIZED_OPERATIONS);
const AT_COLLECTIONS = new Set<string>(RECOMMENDATION_ATPROTO_NORMALIZED_COLLECTIONS);
const AT_VISIBILITIES = new Set<string>(["public_repo", "unknown"]);
const AP_VISIBILITIES = new Set<string>([
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
const PUBLIC_RECIPIENTS = new Set<string>(["https://www.w3.org/ns/activitystreams#Public", "as:Public", "Public"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasUnsafeControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127 || (code >= 128 && code <= 159)) return true;
  }
  return false;
}

function boundedString(value: unknown, label: string, maxLength = MAX_ID_LENGTH): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || hasUnsafeControl(value)) {
    throw new TypeError(`Invalid ${label}.`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string, maxLength = MAX_ID_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined;
  return boundedString(value, label, maxLength);
}

function timestamp(value: unknown, label: string): string {
  const safe = boundedString(value, label);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "protocol-provider-record", since: safe });
  return safe;
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return timestamp(value, label);
}

function known<T extends string>(values: ReadonlySet<string>, value: unknown, label: string): T {
  if (typeof value !== "string" || !values.has(value)) throw new TypeError(`Invalid ${label}.`);
  return value as T;
}

function normalizeHttpUrl(value: unknown, label: string): string {
  const raw = boundedString(value, label);
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

function maybeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return normalizeHttpUrl(value, "provider URL");
  } catch {
    return undefined;
  }
}

function firstHttpUrl(label: string, ...values: readonly unknown[]): string {
  for (const value of values) {
    const url = maybeHttpUrl(value);
    if (url !== undefined) return url;
  }
  throw new TypeError(`Invalid ${label}.`);
}

function recordUrl(value: unknown): string | undefined {
  if (typeof value === "string") return maybeHttpUrl(value);
  if (!isPlainRecord(value)) return undefined;
  return maybeHttpUrl(value.id) ?? maybeHttpUrl(value.url) ?? maybeHttpUrl(value.uri);
}

function actorUrl(value: unknown): string | undefined {
  if (typeof value === "string") return maybeHttpUrl(value);
  if (!isPlainRecord(value)) return undefined;
  return maybeHttpUrl(value.id) ?? maybeHttpUrl(value.uri) ?? maybeHttpUrl(value.url);
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let output = "";
  let inTag = false;
  let tagQuote: string | undefined;
  for (let index = 0; index < value.length && output.length < MAX_TEXT_LENGTH; index += 1) {
    const char = value[index];
    if (char === undefined) continue;
    if (inTag) {
      if (tagQuote !== undefined) {
        if (char === tagQuote) tagQuote = undefined;
        continue;
      }
      if (char === "\"" || char === "'") {
        tagQuote = char;
        continue;
      }
      if (char === ">") inTag = false;
      continue;
    }
    if (char === "<") {
      inTag = true;
      tagQuote = undefined;
      output += " ";
      continue;
    }
    output += char;
  }
  output = output
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .split(" ")
    .filter((part) => part.length > 0)
    .join(" ")
    .trim();
  return output.length === 0 ? undefined : output;
}

function safeTag(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const tag = value.startsWith("#") ? value.slice(1).trim() : value.trim();
  if (tag.length === 0 || tag.length > 80 || hasUnsafeControl(tag)) return undefined;
  return tag;
}

function collectTags(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = new Set<string>();
  for (const item of value) {
    const tag = safeTag(isPlainRecord(item) ? item.name : item);
    if (tag !== undefined) tags.add(tag);
    if (tags.size >= MAX_TAGS) break;
  }
  return tags.size === 0 ? undefined : Object.freeze([...tags].sort());
}

function language(value: unknown): string | undefined {
  const safe = optionalString(value, "provider language", 64);
  return safe === undefined ? undefined : safe.toLocaleLowerCase("und");
}

function mastodonHandle(account: Record<string, unknown>): string | undefined {
  const raw = typeof account.acct === "string" ? account.acct : typeof account.username === "string" ? account.username : undefined;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const handle = (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLocaleLowerCase("und");
  if (handle.length === 0 || handle.length > MAX_ID_LENGTH || hasUnsafeControl(handle) || handle.includes("/") || handle.includes(":")) {
    throw new TypeError("Invalid Mastodon provider handle.");
  }
  return handle;
}

function mastodonVisibility(value: unknown): RecommendationActivityPubVisibility {
  if (value === "public") return "public";
  if (value === "unlisted") return "unlisted";
  if (value === "private") return "followers_only";
  if (value === "direct") return "mentioned_only";
  return "unknown";
}

function recipients(value: unknown): readonly string[] {
  const output: string[] = [];
  const add = (item: unknown): void => {
    if (typeof item === "string") output.push(item);
    else if (isPlainRecord(item) && typeof item.id === "string") output.push(item.id);
  };
  if (Array.isArray(value)) for (const item of value) add(item);
  else add(value);
  return Object.freeze(output);
}

function activityPubVisibility(raw: Record<string, unknown>, fallback: RecommendationActivityPubVisibility | undefined): RecommendationActivityPubVisibility {
  if (typeof raw.visibility === "string" && AP_VISIBILITIES.has(raw.visibility)) return raw.visibility as RecommendationActivityPubVisibility;
  const to = recipients(raw.to);
  const cc = recipients(raw.cc);
  if (recipients(raw.bto).length > 0 || recipients(raw.bcc).length > 0) return "mentioned_only";
  if (to.some((item) => PUBLIC_RECIPIENTS.has(item))) return "public";
  if (cc.some((item) => PUBLIC_RECIPIENTS.has(item))) return "unlisted";
  if (to.concat(cc).some((item) => item.toLocaleLowerCase("en-US").endsWith("/followers"))) return "followers_only";
  if (to.length > 0 || cc.length > 0) return "mentioned_only";
  return fallback ?? "unknown";
}

function flags(input: RecommendationProtocolProviderRecordFlags): RecommendationProtocolProviderRecordFlags {
  const output: RecommendationProtocolProviderRecordFlags = {};
  if (input.projectionMode !== undefined) output.projectionMode = input.projectionMode;
  if (input.trustBoundary !== undefined) output.trustBoundary = input.trustBoundary;
  if (input.containsThirdPartyData !== undefined) output.containsThirdPartyData = input.containsThirdPartyData;
  if (input.serverSideProcessing !== undefined) output.serverSideProcessing = input.serverSideProcessing;
  if (input.providerPolicyAllowsProcessing !== undefined) output.providerPolicyAllowsProcessing = input.providerPolicyAllowsProcessing;
  return Object.freeze(output);
}

function addActivityPubFlags(event: RecommendationActivityPubNormalizedEvent, safeFlags: RecommendationProtocolProviderRecordFlags): RecommendationActivityPubNormalizedEvent {
  return Object.freeze({ ...event, ...safeFlags });
}

function addAtprotoFlags(event: RecommendationAtprotoNormalizedRecordEvent, safeFlags: RecommendationProtocolProviderRecordFlags): RecommendationAtprotoNormalizedRecordEvent {
  return Object.freeze({ ...event, ...safeFlags });
}

export function mapActivityPubProviderActivityToNormalizedEvent(input: RecommendationActivityPubProviderActivityMapInput): RecommendationActivityPubNormalizedEvent {
  if (!isPlainRecord(input) || !isPlainRecord(input.rawActivity)) throw new TypeError("Invalid ActivityPub provider record mapping input.");
  const raw = input.rawActivity;
  const type = known<RecommendationActivityPubNormalizedEventType>(AP_EVENT_TYPES, raw.type, "ActivityPub provider activity type");
  const objectRecord = isPlainRecord(raw.object) ? raw.object : undefined;
  const objectType = objectRecord !== undefined && typeof objectRecord.type === "string" && AP_OBJECT_TYPES.has(objectRecord.type)
    ? objectRecord.type as RecommendationActivityPubNormalizedObjectType
    : "Unknown";
  const resolvedActorUrl = actorUrl(raw.actor) ?? (input.fallbackActorUri === undefined ? undefined : normalizeHttpUrl(input.fallbackActorUri, "ActivityPub fallback actor URI"));
  if (resolvedActorUrl === undefined) throw new TypeError("Invalid ActivityPub provider actor URI.");
  const objectId = recordUrl(raw.object);
  const publishedAt = optionalTimestamp(objectRecord?.published ?? raw.published, "ActivityPub provider published timestamp");
  const updatedAt = optionalTimestamp(objectRecord?.updated ?? raw.updated, "ActivityPub provider updated timestamp");
  const plaintext = objectRecord === undefined ? undefined : cleanText(objectRecord.content) ?? cleanText(objectRecord.summary) ?? cleanText(objectRecord.name);
  const includePlaintext = type === "Create" || type === "Update";
  const tags = objectRecord === undefined ? undefined : collectTags(objectRecord.tag);
  const event: RecommendationActivityPubNormalizedEvent = {
    type,
    activityId: firstHttpUrl("ActivityPub provider activity id", raw.id, raw.url),
    actorUri: resolvedActorUrl,
    ...(objectId === undefined ? {} : { objectId }),
    objectType,
    visibility: activityPubVisibility(raw, input.fallbackVisibility),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    observedAt: timestamp(input.observedAt, "ActivityPub provider observed timestamp"),
    ...(plaintext === undefined || !includePlaintext ? {} : { plaintext }),
    ...(tags === undefined ? {} : { tags })
  };
  if (type === "Undo") {
    const undoType = objectRecord !== undefined && typeof objectRecord.type === "string" && AP_UNDO_TYPES.has(objectRecord.type)
      ? objectRecord.type as RecommendationActivityPubNormalizedUndoType
      : undefined;
    if (undoType === undefined) throw new TypeError("Invalid ActivityPub provider undo type.");
    event.undoType = undoType;
  }
  return addActivityPubFlags(event, flags(input));
}

export function mapMastodonProviderStatusToActivityPubNormalizedEvent(input: RecommendationMastodonProviderStatusMapInput): RecommendationActivityPubNormalizedEvent {
  if (!isPlainRecord(input) || !isPlainRecord(input.rawStatus)) throw new TypeError("Invalid Mastodon provider status mapping input.");
  const raw = input.rawStatus;
  const account = isPlainRecord(raw.account) ? raw.account : undefined;
  if (account === undefined) throw new TypeError("Invalid Mastodon provider account.");
  const boosted = isPlainRecord(raw.reblog) ? raw.reblog : undefined;
  const source = boosted ?? raw;
  const sourceAccount = isPlainRecord(source.account) ? source.account : account;
  const actorHandle = mastodonHandle(account);
  const targetActorUri = boosted === undefined ? undefined : actorUrl(sourceAccount);
  const targetHandle = boosted === undefined ? undefined : mastodonHandle(sourceAccount);
  const plaintext = cleanText(source.content) ?? cleanText(source.spoiler_text);
  const tags = collectTags(source.tags);
  const contentLanguage = language(source.language);
  const publishedAt = optionalTimestamp(raw.created_at, "Mastodon provider created timestamp");
  const updatedAt = optionalTimestamp(raw.edited_at, "Mastodon provider edited timestamp");
  const event: RecommendationActivityPubNormalizedEvent = {
    type: boosted === undefined ? "Create" : "Announce",
    activityId: firstHttpUrl("Mastodon provider activity id", raw.uri, raw.url),
    actorUri: firstHttpUrl("Mastodon provider actor URI", account.uri, account.url),
    ...(actorHandle === undefined ? {} : { actorHandle }),
    objectId: firstHttpUrl("Mastodon provider object id", source.uri, source.url),
    objectType: "Note",
    ...(targetActorUri === undefined ? {} : { targetActorUri }),
    ...(targetHandle === undefined ? {} : { targetHandle }),
    visibility: mastodonVisibility(raw.visibility),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    observedAt: timestamp(input.observedAt, "Mastodon provider observed timestamp"),
    ...(plaintext === undefined || boosted !== undefined ? {} : { plaintext }),
    ...(contentLanguage === undefined ? {} : { language: contentLanguage }),
    ...(tags === undefined ? {} : { tags })
  };
  return addActivityPubFlags(event, flags(input));
}

function atUri(repositoryDid: string, collection: RecommendationAtprotoNormalizedCollection, rkey: string | undefined): string {
  if (rkey === undefined) throw new TypeError("Invalid ATProto provider record key.");
  return `at://${repositoryDid}/${collection}/${boundedString(rkey, "ATProto provider record key")}`;
}

function atUriString(value: unknown, label: string): string | undefined {
  const safe = optionalString(value, label);
  return safe?.startsWith("at://") === true ? safe : undefined;
}

function didString(value: unknown, label: string): string | undefined {
  const safe = optionalString(value, label);
  return safe?.startsWith("did:") === true ? safe : undefined;
}

function subjectUri(value: unknown): string | undefined {
  return isPlainRecord(value) ? atUriString(value.uri, "ATProto provider subject URI") : undefined;
}

function subjectDid(value: unknown): string | undefined {
  if (typeof value === "string") return didString(value, "ATProto provider subject DID");
  if (!isPlainRecord(value)) return undefined;
  return didString(value.did, "ATProto provider subject DID") ?? didString(value.subject, "ATProto provider subject DID") ?? didString(value.uri, "ATProto provider subject DID");
}

function firstLanguage(value: unknown): string | undefined {
  return Array.isArray(value) && value.length > 0 ? language(value[0]) : undefined;
}

function atprotoContent(collection: RecommendationAtprotoNormalizedCollection, record: Record<string, unknown> | undefined): RecommendationProtocolContentInput {
  const content: RecommendationProtocolContentInput = {};
  if (record === undefined) return content;
  if (collection === "app.bsky.feed.post") {
    const plaintext = cleanText(record.text);
    const lang = firstLanguage(record.langs);
    if (plaintext !== undefined) content.plaintext = plaintext;
    if (lang !== undefined) content.language = lang;
    return content;
  }
  if (collection === "app.bsky.actor.profile") {
    const title = cleanText(record.displayName);
    const plaintext = cleanText(record.description);
    if (title !== undefined) content.title = title;
    if (plaintext !== undefined) content.plaintext = plaintext;
    return content;
  }
  return content;
}

export function mapAtprotoProviderRecordToNormalizedEvent(input: RecommendationAtprotoProviderRecordMapInput): RecommendationAtprotoNormalizedRecordEvent {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ATProto provider record mapping input.");
  const operation = known<RecommendationAtprotoNormalizedOperation>(AT_OPS, input.operation, "ATProto provider operation");
  const collection = known<RecommendationAtprotoNormalizedCollection>(AT_COLLECTIONS, input.collection, "ATProto provider collection");
  const repositoryDid = boundedString(input.repositoryDid, "ATProto provider repository DID");
  const record = input.record === undefined || input.record === null ? undefined : input.record;
  if (record !== undefined && !isPlainRecord(record)) throw new TypeError("Invalid ATProto provider record.");
  const subject = record?.subject;
  const resolvedSubjectAtUri = subjectUri(subject) ?? atUriString(record?.uri, "ATProto provider subject URI");
  const resolvedSubjectDid = subjectDid(subject) ?? didString(record?.uri, "ATProto provider subject DID");
  const createdAt = optionalTimestamp(record?.createdAt ?? record?.cts, "ATProto provider created timestamp");
  const indexedAt = optionalTimestamp(input.indexedAt, "ATProto provider indexed timestamp");
  const repositoryVisibility = input.repositoryVisibility === undefined
    ? "public_repo"
    : known<RecommendationAtprotoRepositoryVisibility>(AT_VISIBILITIES, input.repositoryVisibility, "ATProto repository visibility");
  const event: RecommendationAtprotoNormalizedRecordEvent = {
    operation,
    repositoryDid,
    collection,
    ...(input.rkey === undefined ? {} : { rkey: boundedString(input.rkey, "ATProto provider record key") }),
    atUri: optionalString(input.atUri, "ATProto provider AT URI") ?? atUri(repositoryDid, collection, input.rkey),
    ...(input.cid === undefined ? {} : { cid: boundedString(input.cid, "ATProto provider CID") }),
    ...(resolvedSubjectAtUri === undefined ? {} : { subjectAtUri: resolvedSubjectAtUri }),
    ...(resolvedSubjectDid === undefined ? {} : { subjectDid: resolvedSubjectDid }),
    ...(input.handle === undefined ? {} : { handle: boundedString(input.handle, "ATProto provider handle") }),
    repositoryVisibility,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(indexedAt === undefined ? {} : { indexedAt }),
    observedAt: timestamp(input.observedAt, "ATProto provider observed timestamp"),
    ...atprotoContent(collection, record)
  };
  if ((collection === "app.bsky.graph.follow" || collection === "app.bsky.graph.block") && event.subjectDid === undefined) {
    throw new TypeError("Invalid ATProto provider graph subject.");
  }
  if ((collection === "app.bsky.feed.like" || collection === "app.bsky.feed.repost") && event.subjectAtUri === undefined) {
    throw new TypeError("Invalid ATProto provider feed subject.");
  }
  return addAtprotoFlags(event, flags(input));
}
