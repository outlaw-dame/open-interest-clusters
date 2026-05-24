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
const MAX_LIST_ITEMS = 64;
const CONTROL_CODE_BLOCK_SIZE = 32;
const C1_CONTROL_CODE_BLOCK = 4;
const AP_EVENT_TYPES = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_EVENT_TYPES);
const AP_OBJECT_TYPES = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_OBJECT_TYPES);
const AP_UNDO_TYPES = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_UNDO_TYPES);
const AT_OPS = new Set<string>(RECOMMENDATION_ATPROTO_NORMALIZED_OPERATIONS);
const AT_COLLECTIONS = new Set<string>(RECOMMENDATION_ATPROTO_NORMALIZED_COLLECTIONS);
const AT_REPOSITORY_VISIBILITIES = new Set<string>(["public_repo", "unknown"]);
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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || Math.floor(code / CONTROL_CODE_BLOCK_SIZE) === C1_CONTROL_CODE_BLOCK) return true;
  }
  return false;
}

function boundedString(value: unknown, label: string, maxLength = MAX_ID_LENGTH): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || hasControlCharacter(value)) {
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

function known<T extends string>(set: ReadonlySet<string>, value: unknown, label: string): T {
  if (typeof value !== "string" || !set.has(value)) throw new TypeError(`Invalid ${label}.`);
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

function optionalHttpUrl(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeHttpUrl(value, label);
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

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const stripped = value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return stripped.length === 0 ? undefined : stripped.slice(0, MAX_TEXT_LENGTH);
}

function addTag(tags: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const tag = value.trim().replace(/^#/u, "");
  if (/^[\p{Letter}\p{Number}_]{1,80}$/u.test(tag)) tags.add(tag);
}

function mastodonTags(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = new Set<string>();
  for (const item of value) {
    if (isPlainRecord(item)) addTag(tags, item.name);
    else addTag(tags, item);
    if (tags.size >= MAX_LIST_ITEMS) break;
  }
  return tags.size === 0 ? undefined : Object.freeze([...tags].sort());
}

function activityPubTags(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = new Set<string>();
  for (const item of value) {
    if (isPlainRecord(item)) addTag(tags, item.name);
    if (tags.size >= MAX_LIST_ITEMS) break;
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
  const normalized = raw.trim().replace(/^@/u, "").toLocaleLowerCase("und");
  if (normalized.length === 0 || normalized.length > MAX_ID_LENGTH || /[\s/:#?]/u.test(normalized)) throw new TypeError("Invalid Mastodon provider handle.");
  return normalized;
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
  if (Array.isArray(value)) {
    for (const item of value) add(item);
  } else add(value);
  return Object.freeze(output);
}

function activityPubVisibility(raw: Record<string, unknown>, fallback: RecommendationActivityPubVisibility | undefined): RecommendationActivityPubVisibility {
  if (typeof raw.visibility === "string" && AP_VISIBILITIES.has(raw.visibility)) return raw.visibility as RecommendationActivityPubVisibility;
  const to = recipients(raw.to);
  const cc = recipients(raw.cc);
  const bto = recipients(raw.bto);
  const bcc = recipients(raw.bcc);
  if (bto.length > 0 || bcc.length > 0) return "mentioned_only";
  if (to.some((item) => PUBLIC_RECIPIENTS.has(item))) return "public";
  if (cc.some((item) => PUBLIC_RECIPIENTS.has(item))) return "unlisted";
  if (to.concat(cc).some((item) => item.toLocaleLowerCase("en-US").endsWith("/followers"))) return "followers_only";
  if (to.length > 0 || cc.length > 0) return "mentioned_only";
  return fallback ?? "unknown";
}

function normalizeFlags(input: RecommendationProtocolProviderRecordFlags): RecommendationProtocolProviderRecordFlags {
  const flags: RecommendationProtocolProviderRecordFlags = {};
  if (input.projectionMode !== undefined) {
    if (input.projectionMode !== "native" && input.projectionMode !== "mirrored") throw new TypeError("Invalid provider projection mode.");
    flags.projectionMode = input.projectionMode;
  }
  if (input.trustBoundary !== undefined) flags.trustBoundary = input.trustBoundary;
  if (input.containsThirdPartyData !== undefined) flags.containsThirdPartyData = input.containsThirdPartyData;
  if (input.serverSideProcessing !== undefined) flags.serverSideProcessing = input.serverSideProcessing;
  if (input.providerPolicyAllowsProcessing !== undefined) flags.providerPolicyAllowsProcessing = input.providerPolicyAllowsProcessing;
  return Object.freeze(flags);
}

function addActivityPubFlags(
  event: RecommendationActivityPubNormalizedEvent,
  flags: RecommendationProtocolProviderRecordFlags
): RecommendationActivityPubNormalizedEvent {
  return Object.freeze({
    ...event,
    ...(flags.projectionMode === undefined ? {} : { projectionMode: flags.projectionMode }),
    ...(flags.trustBoundary === undefined ? {} : { trustBoundary: flags.trustBoundary }),
    ...(flags.containsThirdPartyData === undefined ? {} : { containsThirdPartyData: flags.containsThirdPartyData }),
    ...(flags.serverSideProcessing === undefined ? {} : { serverSideProcessing: flags.serverSideProcessing }),
    ...(flags.providerPolicyAllowsProcessing === undefined ? {} : { providerPolicyAllowsProcessing: flags.providerPolicyAllowsProcessing })
  });
}

function addAtprotoFlags(
  event: RecommendationAtprotoNormalizedRecordEvent,
  flags: RecommendationProtocolProviderRecordFlags
): RecommendationAtprotoNormalizedRecordEvent {
  return Object.freeze({
    ...event,
    ...(flags.projectionMode === undefined ? {} : { projectionMode: flags.projectionMode }),
    ...(flags.trustBoundary === undefined ? {} : { trustBoundary: flags.trustBoundary }),
    ...(flags.containsThirdPartyData === undefined ? {} : { containsThirdPartyData: flags.containsThirdPartyData }),
    ...(flags.serverSideProcessing === undefined ? {} : { serverSideProcessing: flags.serverSideProcessing }),
    ...(flags.providerPolicyAllowsProcessing === undefined ? {} : { providerPolicyAllowsProcessing: flags.providerPolicyAllowsProcessing })
  });
}

export function mapActivityPubProviderActivityToNormalizedEvent(
  input: RecommendationActivityPubProviderActivityMapInput
): RecommendationActivityPubNormalizedEvent {
  if (!isPlainRecord(input) || !isPlainRecord(input.rawActivity)) throw new TypeError("Invalid ActivityPub provider record mapping input.");
  const raw = input.rawActivity;
  const type = known<RecommendationActivityPubNormalizedEventType>(AP_EVENT_TYPES, raw.type, "ActivityPub provider activity type");
  const object = raw.object;
  const objectRecord = isPlainRecord(object) ? object : undefined;
  const objectType = objectRecord !== undefined && typeof objectRecord.type === "string" && AP_OBJECT_TYPES.has(objectRecord.type)
    ? objectRecord.type as RecommendationActivityPubNormalizedObjectType
    : "Unknown";
  const actorUri = recordUrl(raw.actor) ?? optionalHttpUrl(input.fallbackActorUri, "ActivityPub fallback actor URI");
  if (actorUri === undefined) throw new TypeError("Invalid ActivityPub provider actor URI.");
  const objectId = recordUrl(object);
  const publishedAt = optionalTimestamp(objectRecord?.published ?? raw.published, "ActivityPub provider published timestamp");
  const updatedAt = optionalTimestamp(objectRecord?.updated ?? raw.updated, "ActivityPub provider updated timestamp");
  const plaintext = objectRecord === undefined ? undefined : cleanText(objectRecord.content) ?? cleanText(objectRecord.summary) ?? cleanText(objectRecord.name);
  const tags = objectRecord === undefined ? undefined : activityPubTags(objectRecord.tag);
  const flags = normalizeFlags(input);
  const event: RecommendationActivityPubNormalizedEvent = {
    type,
    activityId: firstHttpUrl("ActivityPub provider activity id", raw.id, raw.url),
    actorUri,
    ...(objectId === undefined ? {} : { objectId }),
    objectType,
    visibility: activityPubVisibility(raw, input.fallbackVisibility),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    observedAt: timestamp(input.observedAt, "ActivityPub provider observed timestamp"),
    ...(plaintext === undefined ? {} : { plaintext }),
    ...(tags === undefined ? {} : { tags })
  };
  if (type === "Undo") {
    const undoType = objectRecord !== undefined && typeof objectRecord.type === "string" && AP_UNDO_TYPES.has(objectRecord.type)
      ? objectRecord.type as RecommendationActivityPubNormalizedUndoType
      : undefined;
    if (undoType === undefined) throw new TypeError("Invalid ActivityPub provider undo type.");
    event.undoType = undoType;
  }
  return addActivityPubFlags(event, flags);
}

export function mapMastodonProviderStatusToActivityPubNormalizedEvent(
  input: RecommendationMastodonProviderStatusMapInput
): RecommendationActivityPubNormalizedEvent {
  if (!isPlainRecord(input) || !isPlainRecord(input.rawStatus)) throw new TypeError("Invalid Mastodon provider status mapping input.");
  const raw = input.rawStatus;
  const account = isPlainRecord(raw.account) ? raw.account : undefined;
  if (account === undefined) throw new TypeError("Invalid Mastodon provider account.");
  const boosted = isPlainRecord(raw.reblog) ? raw.reblog : undefined;
  const source = boosted ?? raw;
  const sourceAccount = isPlainRecord(source.account) ? source.account : account;
  const actorHandle = mastodonHandle(account);
  const targetActorUri = boosted === undefined ? undefined : recordUrl(sourceAccount);
  const targetHandle = boosted === undefined ? undefined : mastodonHandle(sourceAccount);
  const plaintext = cleanText(source.content) ?? cleanText(source.spoiler_text);
  const tags = mastodonTags(source.tags);
  const publishedAt = optionalTimestamp(raw.created_at, "Mastodon provider created timestamp");
  const updatedAt = optionalTimestamp(raw.edited_at, "Mastodon provider edited timestamp");
  const flags = normalizeFlags(input);
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
    ...(language(source.language) === undefined ? {} : { language: language(source.language) }),
    ...(tags === undefined ? {} : { tags })
  };
  return addActivityPubFlags(event, flags);
}

function atUriFromParts(repositoryDid: string, collection: RecommendationAtprotoNormalizedCollection, rkey: string | undefined): string {
  if (rkey === undefined) throw new TypeError("Invalid ATProto provider record key.");
  return `at://${repositoryDid}/${collection}/${boundedString(rkey, "ATProto provider record key")}`;
}

function subjectUri(value: unknown): string | undefined {
  if (!isPlainRecord(value)) return undefined;
  return optionalString(value.uri, "ATProto provider subject URI");
}

function subjectDid(value: unknown): string | undefined {
  if (typeof value === "string") return value.startsWith("did:") ? boundedString(value, "ATProto provider subject DID") : undefined;
  if (!isPlainRecord(value)) return undefined;
  const subject = optionalString(value.did, "ATProto provider subject DID") ?? optionalString(value.subject, "ATProto provider subject DID");
  return subject?.startsWith("did:") === true ? subject : undefined;
}

function firstLanguage(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return language(value[0]);
}

function atprotoContent(collection: RecommendationAtprotoNormalizedCollection, record: Record<string, unknown> | undefined): RecommendationProtocolContentInput {
  const content: RecommendationProtocolContentInput = {};
  if (record === undefined) return content;
  if (collection === "app.bsky.feed.post") {
    const text = cleanText(record.text);
    const lang = firstLanguage(record.langs);
    if (text !== undefined) content.plaintext = text;
    if (lang !== undefined) content.language = lang;
    return content;
  }
  if (collection === "app.bsky.actor.profile") {
    const title = cleanText(record.displayName);
    const text = cleanText(record.description);
    if (title !== undefined) content.title = title;
    if (text !== undefined) content.plaintext = text;
  }
  if (collection === "com.atproto.label.defs#label") {
    const text = cleanText(record.val);
    if (text !== undefined) content.plaintext = text;
  }
  return content;
}

export function mapAtprotoProviderRecordToNormalizedEvent(
  input: RecommendationAtprotoProviderRecordMapInput
): RecommendationAtprotoNormalizedRecordEvent {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ATProto provider record mapping input.");
  const operation = known<RecommendationAtprotoNormalizedOperation>(AT_OPS, input.operation, "ATProto provider operation");
  const collection = known<RecommendationAtprotoNormalizedCollection>(AT_COLLECTIONS, input.collection, "ATProto provider collection");
  const repositoryDid = boundedString(input.repositoryDid, "ATProto provider repository DID");
  const record = input.record === undefined || input.record === null ? undefined : input.record;
  if (record !== undefined && !isPlainRecord(record)) throw new TypeError("Invalid ATProto provider record.");
  const subject = record?.subject;
  const resolvedSubjectAtUri = subjectUri(subject) ?? optionalString(record?.uri, "ATProto provider subject URI");
  const resolvedSubjectDid = subjectDid(subject) ?? subjectDid(resolvedSubjectAtUri);
  const createdAt = optionalTimestamp(record?.createdAt ?? record?.cts, "ATProto provider created timestamp");
  const indexedAt = optionalTimestamp(input.indexedAt, "ATProto provider indexed timestamp");
  const repositoryVisibility = input.repositoryVisibility === undefined
    ? "public_repo"
    : known<RecommendationAtprotoRepositoryVisibility>(AT_REPOSITORY_VISIBILITIES, input.repositoryVisibility, "ATProto repository visibility");
  const flags = normalizeFlags(input);
  const event: RecommendationAtprotoNormalizedRecordEvent = {
    operation,
    repositoryDid,
    collection,
    ...(input.rkey === undefined ? {} : { rkey: boundedString(input.rkey, "ATProto provider record key") }),
    atUri: optionalString(input.atUri, "ATProto provider AT URI") ?? atUriFromParts(repositoryDid, collection, input.rkey),
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
  return addAtprotoFlags(event, flags);
}
