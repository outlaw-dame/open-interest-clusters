import {
  RECOMMENDATION_PROTOCOLS,
  type RecommendationAccessBasis,
  type RecommendationProtocol,
  type RecommendationSourceVisibility
} from "./consent.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  createActivityPodsSourceContext,
  type RecommendationActivityPodsResourceScope,
  type RecommendationActivityPodsSourceContextInput,
  type RecommendationSolidAccessMode
} from "./protocol-source-contexts.js";
import {
  RECOMMENDATION_SOURCE_ADAPTER_CAPABILITIES,
  RECOMMENDATION_SOURCE_TRUST_BOUNDARIES,
  normalizeRecommendationSourceAdapterReadRequest,
  normalizeRecommendationSourceItem,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterCapability,
  type RecommendationSourceAdapterReadRequest,
  type RecommendationSourceAdapterReadResult,
  type RecommendationSourceContext,
  type RecommendationSourceItem,
  type RecommendationSourceItemKind,
  type RecommendationSourceTrustBoundary
} from "./source-adapter.js";

export const CANONICAL_RECOMMENDATION_SOURCE_ADAPTER_ID = "canonical-recommendation-source" as const;

export const CANONICAL_RECOMMENDATION_VISIBILITIES = [
  "public",
  "unlisted",
  "followers",
  "direct",
  "acl_controlled",
  "local_only",
  "unknown"
] as const;

export type CanonicalRecommendationVisibility = typeof CANONICAL_RECOMMENDATION_VISIBILITIES[number];

export const CANONICAL_RECOMMENDATION_PROJECTION_MODES = ["native", "mirrored"] as const;

export type CanonicalRecommendationProjectionMode = typeof CANONICAL_RECOMMENDATION_PROJECTION_MODES[number];

export const CANONICAL_RECOMMENDATION_EVENT_KINDS = [
  "PostCreate",
  "PostEdit",
  "PostDelete",
  "PostInteractionPolicyUpdate",
  "PollCreate",
  "PollEdit",
  "PollDelete",
  "PollVoteAdd",
  "ReactionAdd",
  "ReactionRemove",
  "ShareAdd",
  "ShareRemove",
  "FollowAdd",
  "FollowRemove",
  "ProfileUpdate",
  "AccountState",
  "ReportCreate",
  "DirectMessage"
] as const;

export type CanonicalRecommendationEventKind = typeof CANONICAL_RECOMMENDATION_EVENT_KINDS[number];

export interface CanonicalRecommendationActorRef {
  canonicalAccountId?: string | null;
  did?: string | null;
  webId?: string | null;
  activityPubActorUri?: string | null;
  handle?: string | null;
}

export interface CanonicalRecommendationObjectRef {
  canonicalObjectId?: string | null;
  atUri?: string | null;
  cid?: string | null;
  activityPubObjectId?: string | null;
  canonicalUrl?: string | null;
}

export interface CanonicalRecommendationContentSummary {
  kind?: "note" | "article" | "profile" | "reaction" | "follow" | "share" | "poll" | "unknown";
  title?: string | null;
  summary?: string | null;
  plaintext?: string | null;
  language?: string | null;
  tags?: readonly string[];
  links?: readonly string[];
  externalUrl?: string | null;
  linkPreviewUrl?: string | null;
}

export interface CanonicalRecommendationActivityPodsContext {
  resourceScope?: RecommendationActivityPodsResourceScope;
  solidAccessMode?: RecommendationSolidAccessMode;
  isOwner?: boolean;
}

export interface CanonicalRecommendationEvent {
  canonicalEventId?: string;
  canonicalIntentId?: string;
  kind: CanonicalRecommendationEventKind;
  sourceProtocol: RecommendationProtocol;
  sourceEventId: string;
  visibility: CanonicalRecommendationVisibility;
  actor?: CanonicalRecommendationActorRef;
  object?: CanonicalRecommendationObjectRef;
  subject?: CanonicalRecommendationActorRef;
  content?: CanonicalRecommendationContentSummary;
  createdAt: string;
  observedAt: string;
  projectionMode?: CanonicalRecommendationProjectionMode;
  activityPods?: CanonicalRecommendationActivityPodsContext;
  trustBoundary?: RecommendationSourceTrustBoundary;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface CanonicalRecommendationSourceOptions {
  adapterId?: string;
  sourceSystem?: string;
  includeMirroredEvents?: boolean;
  defaultTrustBoundary?: RecommendationSourceTrustBoundary;
  containsThirdPartyData?: boolean;
  serverSideProcessing?: boolean;
  providerPolicyAllowsProcessing?: boolean;
}

export interface CanonicalRecommendationSourceAdapterOptions extends CanonicalRecommendationSourceOptions {
  events: readonly CanonicalRecommendationEvent[] | (() => readonly CanonicalRecommendationEvent[] | Promise<readonly CanonicalRecommendationEvent[]>);
  capabilities?: readonly RecommendationSourceAdapterCapability[];
}

interface ParsedRfc3339Timestamp {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  fractionalSeconds?: string;
  zone: string;
}

const MAX_CANONICAL_ID_LENGTH = 2_048;
const MAX_SOURCE_SYSTEM_LENGTH = 256;
const MAX_ADAPTER_ID_LENGTH = 256;
const DEFAULT_CANONICAL_SOURCE_SYSTEM = "canonical.v1";
const DEFAULT_CANONICAL_TRUST_BOUNDARY: RecommendationSourceTrustBoundary = "unknown";
const STRICT_RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u;
const PROTOCOL_SET = new Set<string>(RECOMMENDATION_PROTOCOLS);
const VISIBILITY_SET = new Set<string>(CANONICAL_RECOMMENDATION_VISIBILITIES);
const PROJECTION_MODE_SET = new Set<string>(CANONICAL_RECOMMENDATION_PROJECTION_MODES);
const EVENT_KIND_SET = new Set<string>(CANONICAL_RECOMMENDATION_EVENT_KINDS);
const TRUST_BOUNDARY_SET = new Set<string>(RECOMMENDATION_SOURCE_TRUST_BOUNDARIES);
const ADAPTER_CAPABILITY_SET = new Set<string>(RECOMMENDATION_SOURCE_ADAPTER_CAPABILITIES);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !hasUnsafeControlCharacter(value.replaceAll("\t", "").replaceAll("\n", "").replaceAll("\r", ""))
  );
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isNonEmptyString(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isKnownProtocol(value: unknown): value is RecommendationProtocol {
  return typeof value === "string" && PROTOCOL_SET.has(value);
}

function isKnownVisibility(value: unknown): value is CanonicalRecommendationVisibility {
  return typeof value === "string" && VISIBILITY_SET.has(value);
}

function isKnownProjectionMode(value: unknown): value is CanonicalRecommendationProjectionMode {
  return typeof value === "string" && PROJECTION_MODE_SET.has(value);
}

function isKnownEventKind(value: unknown): value is CanonicalRecommendationEventKind {
  return typeof value === "string" && EVENT_KIND_SET.has(value);
}

function isKnownTrustBoundary(value: unknown): value is RecommendationSourceTrustBoundary {
  return typeof value === "string" && TRUST_BOUNDARY_SET.has(value);
}

function isKnownAdapterCapability(value: unknown): value is RecommendationSourceAdapterCapability {
  return typeof value === "string" && ADAPTER_CAPABILITY_SET.has(value);
}

function assertBoundedString(value: string, label: string, maxLength: number): void {
  if (value.length > maxLength) {
    throw new TypeError(`${label} is too long.`);
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function fractionalMillis(fractionalSeconds: string | undefined): number {
  if (fractionalSeconds === undefined) {
    return 0;
  }

  return Number.parseInt(fractionalSeconds.slice(0, 3).padEnd(3, "0"), 10);
}

function timezoneOffsetMillis(zone: string): number {
  if (zone === "Z") {
    return 0;
  }

  const sign = zone[0] === "+" ? 1 : -1;
  const offsetHour = Number.parseInt(zone.slice(1, 3), 10);
  const offsetMinute = Number.parseInt(zone.slice(4, 6), 10);
  return sign * ((offsetHour * 60 + offsetMinute) * 60_000);
}

function parseStrictRfc3339Timestamp(value: unknown): ParsedRfc3339Timestamp | null {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const match = STRICT_RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const second = Number.parseInt(match[6] ?? "", 10);
  const fractionalSeconds = match[7];
  const zone = match[8] ?? "";

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 60
  ) {
    return null;
  }

  if (zone !== "Z") {
    const offsetHour = Number.parseInt(zone.slice(1, 3), 10);
    const offsetMinute = Number.parseInt(zone.slice(4, 6), 10);
    if (offsetHour > 23 || offsetMinute > 59) {
      return null;
    }
  }

  const parsed: ParsedRfc3339Timestamp = {
    year,
    month,
    day,
    hour,
    minute,
    second,
    zone
  };
  if (fractionalSeconds !== undefined) {
    parsed.fractionalSeconds = fractionalSeconds;
  }

  return parsed;
}

function utcMillisFromParsedTimestamp(parsed: ParsedRfc3339Timestamp): number {
  const second = Math.min(parsed.second, 59);
  const millis = fractionalMillis(parsed.fractionalSeconds);

  if (parsed.year >= 0 && parsed.year < 100) {
    const date = new Date(0);
    date.setUTCFullYear(parsed.year, parsed.month - 1, parsed.day);
    date.setUTCHours(parsed.hour, parsed.minute, second, millis);
    return date.getTime();
  }

  return Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, second, millis);
}

function timestampMillis(value: unknown, errorMessage: string): number {
  const parsed = parseStrictRfc3339Timestamp(value);
  if (parsed === null) {
    throw new TypeError(errorMessage);
  }

  const utcMillis = utcMillisFromParsedTimestamp(parsed);
  if (!Number.isFinite(utcMillis)) {
    throw new TypeError(errorMessage);
  }

  return utcMillis + (parsed.second === 60 ? 1_000 : 0) - timezoneOffsetMillis(parsed.zone);
}

function assertTimestamp(value: string): void {
  timestampMillis(value, "Invalid canonical recommendation event timestamp.");
}

function parseSinceTimestamp(value: string | undefined): number | undefined {
  return value === undefined
    ? undefined
    : timestampMillis(value, "Invalid canonical recommendation source adapter since timestamp.");
}

function eventObservedAtMillis(event: CanonicalRecommendationEvent): number {
  return timestampMillis(event.observedAt, "Invalid canonical recommendation event timestamp.");
}

function isActorRef(value: unknown): value is CanonicalRecommendationActorRef {
  if (value === undefined) {
    return true;
  }

  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CanonicalRecommendationActorRef>;
  return (
    isOptionalNullableString(candidate.canonicalAccountId) &&
    isOptionalNullableString(candidate.did) &&
    isOptionalNullableString(candidate.webId) &&
    isOptionalNullableString(candidate.activityPubActorUri) &&
    isOptionalNullableString(candidate.handle)
  );
}

function isObjectRef(value: unknown): value is CanonicalRecommendationObjectRef {
  if (value === undefined) {
    return true;
  }

  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CanonicalRecommendationObjectRef>;
  return (
    isOptionalNullableString(candidate.canonicalObjectId) &&
    isOptionalNullableString(candidate.atUri) &&
    isOptionalNullableString(candidate.cid) &&
    isOptionalNullableString(candidate.activityPubObjectId) &&
    isOptionalNullableString(candidate.canonicalUrl)
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isContentSummary(value: unknown): value is CanonicalRecommendationContentSummary {
  if (value === undefined) {
    return true;
  }

  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CanonicalRecommendationContentSummary>;
  return (
    (candidate.kind === undefined ||
      candidate.kind === "note" ||
      candidate.kind === "article" ||
      candidate.kind === "profile" ||
      candidate.kind === "reaction" ||
      candidate.kind === "follow" ||
      candidate.kind === "share" ||
      candidate.kind === "poll" ||
      candidate.kind === "unknown") &&
    isOptionalNullableString(candidate.title) &&
    isOptionalNullableString(candidate.summary) &&
    isOptionalNullableString(candidate.plaintext) &&
    isOptionalNullableString(candidate.language) &&
    (candidate.tags === undefined || isStringArray(candidate.tags)) &&
    (candidate.links === undefined || isStringArray(candidate.links)) &&
    isOptionalNullableString(candidate.externalUrl) &&
    isOptionalNullableString(candidate.linkPreviewUrl)
  );
}

function isActivityPodsContext(value: unknown): value is CanonicalRecommendationActivityPodsContext {
  if (value === undefined) {
    return true;
  }

  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CanonicalRecommendationActivityPodsContext>;
  return (
    (candidate.resourceScope === undefined ||
      candidate.resourceScope === "public" ||
      candidate.resourceScope === "unlisted" ||
      candidate.resourceScope === "acl_controlled" ||
      candidate.resourceScope === "local_only" ||
      candidate.resourceScope === "unknown") &&
    (candidate.solidAccessMode === undefined ||
      candidate.solidAccessMode === "read" ||
      candidate.solidAccessMode === "append" ||
      candidate.solidAccessMode === "write" ||
      candidate.solidAccessMode === "control" ||
      candidate.solidAccessMode === "none" ||
      candidate.solidAccessMode === "unknown") &&
    isOptionalBoolean(candidate.isOwner)
  );
}

export function isCanonicalRecommendationEvent(value: unknown): value is CanonicalRecommendationEvent {
  if (!isObject(value)) {
    return false;
  }

  const candidate = value as Partial<CanonicalRecommendationEvent>;
  return (
    isOptionalNonEmptyString(candidate.canonicalEventId) &&
    isOptionalNonEmptyString(candidate.canonicalIntentId) &&
    isKnownEventKind(candidate.kind) &&
    isKnownProtocol(candidate.sourceProtocol) &&
    isNonEmptyString(candidate.sourceEventId) &&
    isKnownVisibility(candidate.visibility) &&
    isNonEmptyString(candidate.createdAt) &&
    isNonEmptyString(candidate.observedAt) &&
    (candidate.projectionMode === undefined || isKnownProjectionMode(candidate.projectionMode)) &&
    isActorRef(candidate.actor) &&
    isActorRef(candidate.subject) &&
    isObjectRef(candidate.object) &&
    isContentSummary(candidate.content) &&
    isActivityPodsContext(candidate.activityPods) &&
    (candidate.trustBoundary === undefined || isKnownTrustBoundary(candidate.trustBoundary)) &&
    isOptionalBoolean(candidate.containsThirdPartyData) &&
    isOptionalBoolean(candidate.serverSideProcessing) &&
    isOptionalBoolean(candidate.providerPolicyAllowsProcessing)
  );
}

function cloneActorRef(ref: CanonicalRecommendationActorRef | undefined): CanonicalRecommendationActorRef | undefined {
  if (ref === undefined) {
    return undefined;
  }

  const next: CanonicalRecommendationActorRef = {};
  if (ref.canonicalAccountId !== undefined) next.canonicalAccountId = ref.canonicalAccountId;
  if (ref.did !== undefined) next.did = ref.did;
  if (ref.webId !== undefined) next.webId = ref.webId;
  if (ref.activityPubActorUri !== undefined) next.activityPubActorUri = ref.activityPubActorUri;
  if (ref.handle !== undefined) next.handle = ref.handle;
  return Object.freeze(next);
}

function cloneObjectRef(ref: CanonicalRecommendationObjectRef | undefined): CanonicalRecommendationObjectRef | undefined {
  if (ref === undefined) {
    return undefined;
  }

  const next: CanonicalRecommendationObjectRef = {};
  if (ref.canonicalObjectId !== undefined) next.canonicalObjectId = ref.canonicalObjectId;
  if (ref.atUri !== undefined) next.atUri = ref.atUri;
  if (ref.cid !== undefined) next.cid = ref.cid;
  if (ref.activityPubObjectId !== undefined) next.activityPubObjectId = ref.activityPubObjectId;
  if (ref.canonicalUrl !== undefined) next.canonicalUrl = ref.canonicalUrl;
  return Object.freeze(next);
}

function cloneContentSummary(summary: CanonicalRecommendationContentSummary | undefined): CanonicalRecommendationContentSummary | undefined {
  if (summary === undefined) {
    return undefined;
  }

  const next: CanonicalRecommendationContentSummary = {};
  if (summary.kind !== undefined) next.kind = summary.kind;
  if (summary.title !== undefined) next.title = summary.title;
  if (summary.summary !== undefined) next.summary = summary.summary;
  if (summary.plaintext !== undefined) next.plaintext = summary.plaintext;
  if (summary.language !== undefined) next.language = summary.language;
  if (summary.tags !== undefined) next.tags = Object.freeze([...summary.tags]);
  if (summary.links !== undefined) next.links = Object.freeze([...summary.links]);
  if (summary.externalUrl !== undefined) next.externalUrl = summary.externalUrl;
  if (summary.linkPreviewUrl !== undefined) next.linkPreviewUrl = summary.linkPreviewUrl;
  return Object.freeze(next);
}

function cloneActivityPodsContext(
  context: CanonicalRecommendationActivityPodsContext | undefined
): CanonicalRecommendationActivityPodsContext | undefined {
  if (context === undefined) {
    return undefined;
  }

  const next: CanonicalRecommendationActivityPodsContext = {};
  if (context.resourceScope !== undefined) next.resourceScope = context.resourceScope;
  if (context.solidAccessMode !== undefined) next.solidAccessMode = context.solidAccessMode;
  if (context.isOwner !== undefined) next.isOwner = context.isOwner;
  return Object.freeze(next);
}

export function normalizeCanonicalRecommendationEvent(value: unknown): CanonicalRecommendationEvent {
  if (!isCanonicalRecommendationEvent(value)) {
    throw new TypeError("Invalid canonical recommendation event.");
  }

  assertTimestamp(value.createdAt);
  assertTimestamp(value.observedAt);
  if (value.canonicalEventId !== undefined) assertBoundedString(value.canonicalEventId, "Canonical event id", MAX_CANONICAL_ID_LENGTH);
  if (value.canonicalIntentId !== undefined) assertBoundedString(value.canonicalIntentId, "Canonical intent id", MAX_CANONICAL_ID_LENGTH);
  assertBoundedString(value.sourceEventId, "Canonical source event id", MAX_CANONICAL_ID_LENGTH);

  const next: CanonicalRecommendationEvent = {
    kind: value.kind,
    sourceProtocol: value.sourceProtocol,
    sourceEventId: value.sourceEventId,
    visibility: value.visibility,
    createdAt: value.createdAt,
    observedAt: value.observedAt
  };

  if (value.canonicalEventId !== undefined) next.canonicalEventId = value.canonicalEventId;
  if (value.canonicalIntentId !== undefined) next.canonicalIntentId = value.canonicalIntentId;
  const actor = cloneActorRef(value.actor);
  if (actor !== undefined) next.actor = actor;
  const object = cloneObjectRef(value.object);
  if (object !== undefined) next.object = object;
  const subject = cloneActorRef(value.subject);
  if (subject !== undefined) next.subject = subject;
  const content = cloneContentSummary(value.content);
  if (content !== undefined) next.content = content;
  if (value.projectionMode !== undefined) next.projectionMode = value.projectionMode;
  const activityPods = cloneActivityPodsContext(value.activityPods);
  if (activityPods !== undefined) next.activityPods = activityPods;
  if (value.trustBoundary !== undefined) next.trustBoundary = value.trustBoundary;
  if (value.containsThirdPartyData !== undefined) next.containsThirdPartyData = value.containsThirdPartyData;
  if (value.serverSideProcessing !== undefined) next.serverSideProcessing = value.serverSideProcessing;
  if (value.providerPolicyAllowsProcessing !== undefined) next.providerPolicyAllowsProcessing = value.providerPolicyAllowsProcessing;

  return Object.freeze(next);
}

function canonicalVisibilityToSourceVisibility(
  protocol: RecommendationProtocol,
  visibility: CanonicalRecommendationVisibility
): RecommendationSourceVisibility {
  if (protocol === "atproto" && (visibility === "public" || visibility === "unlisted")) {
    return "atproto_public_repo";
  }

  switch (visibility) {
    case "public":
      return "public";
    case "unlisted":
      return "unlisted";
    case "followers":
      return "followers_only";
    case "direct":
      return "mentioned_only";
    case "acl_controlled":
      return "acl_controlled";
    case "local_only":
      return "local_only";
    case "unknown":
      return "unknown";
  }
}

function defaultCanonicalAccessBasis(
  protocol: RecommendationProtocol,
  visibility: CanonicalRecommendationVisibility,
  sourceVisibility: RecommendationSourceVisibility
): RecommendationAccessBasis {
  if (sourceVisibility === "atproto_public_repo") {
    return "atproto_public_repo";
  }

  if (protocol === "activitypods" && visibility === "acl_controlled") {
    return "unknown";
  }

  switch (visibility) {
    case "public":
    case "unlisted":
      return "public_web";
    case "followers":
      return "follower_relationship";
    case "direct":
      return "mentioned_recipient";
    case "acl_controlled":
      return "unknown";
    case "local_only":
      return "provider_policy";
    case "unknown":
      return "unknown";
  }
}

function isPrivateSourceVisibility(visibility: RecommendationSourceVisibility): boolean {
  return (
    visibility === "followers_only" ||
    visibility === "mentioned_only" ||
    visibility === "mutuals_only" ||
    visibility === "local_only" ||
    visibility === "acl_controlled"
  );
}

function addOptionalContextFlags(
  context: RecommendationSourceContext,
  event: CanonicalRecommendationEvent,
  options: CanonicalRecommendationSourceOptions
): RecommendationSourceContext {
  const next: RecommendationSourceContext = { ...context };
  const containsThirdPartyData = event.containsThirdPartyData ?? options.containsThirdPartyData;
  const serverSideProcessing = event.serverSideProcessing ?? options.serverSideProcessing;
  const providerPolicyAllowsProcessing = event.providerPolicyAllowsProcessing ?? options.providerPolicyAllowsProcessing;

  if (containsThirdPartyData !== undefined) next.containsThirdPartyData = containsThirdPartyData;
  if (serverSideProcessing !== undefined) next.serverSideProcessing = serverSideProcessing;
  if (providerPolicyAllowsProcessing !== undefined) next.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;

  return Object.freeze(next);
}

function activityPodsResourceScopeFromCanonicalVisibility(
  visibility: CanonicalRecommendationVisibility
): RecommendationActivityPodsResourceScope {
  switch (visibility) {
    case "public":
      return "public";
    case "unlisted":
      return "unlisted";
    case "acl_controlled":
    case "followers":
    case "direct":
      return "acl_controlled";
    case "local_only":
      return "local_only";
    case "unknown":
      return "unknown";
  }
}

function createActivityPodsContextInput(
  event: CanonicalRecommendationEvent,
  options: CanonicalRecommendationSourceOptions
): RecommendationActivityPodsSourceContextInput {
  const input: RecommendationActivityPodsSourceContextInput = {
    resourceScope: event.activityPods?.resourceScope ?? activityPodsResourceScopeFromCanonicalVisibility(event.visibility)
  };
  if (event.activityPods?.solidAccessMode !== undefined) input.solidAccessMode = event.activityPods.solidAccessMode;
  if (event.activityPods?.isOwner !== undefined) input.isOwner = event.activityPods.isOwner;
  const containsThirdPartyData = event.containsThirdPartyData ?? options.containsThirdPartyData;
  const serverSideProcessing = event.serverSideProcessing ?? options.serverSideProcessing;
  const providerPolicyAllowsProcessing = event.providerPolicyAllowsProcessing ?? options.providerPolicyAllowsProcessing;
  if (containsThirdPartyData !== undefined) input.containsThirdPartyData = containsThirdPartyData;
  if (serverSideProcessing !== undefined) input.serverSideProcessing = serverSideProcessing;
  if (providerPolicyAllowsProcessing !== undefined) input.providerPolicyAllowsProcessing = providerPolicyAllowsProcessing;
  return input;
}

export function createCanonicalRecommendationSourceContext(
  eventInput: CanonicalRecommendationEvent,
  options: CanonicalRecommendationSourceOptions = {}
): RecommendationSourceContext {
  const event = normalizeCanonicalRecommendationEvent(eventInput);

  if (event.sourceProtocol === "activitypods") {
    return addOptionalContextFlags(
      createActivityPodsSourceContext(createActivityPodsContextInput(event, options)),
      event,
      options
    );
  }

  const sourceVisibility = canonicalVisibilityToSourceVisibility(event.sourceProtocol, event.visibility);
  return addOptionalContextFlags(
    Object.freeze({
      protocol: event.sourceProtocol,
      sourceVisibility,
      accessBasis: defaultCanonicalAccessBasis(event.sourceProtocol, event.visibility, sourceVisibility),
      containsPrivateData: isPrivateSourceVisibility(sourceVisibility)
    }),
    event,
    options
  );
}

function canonicalEventIdentity(event: CanonicalRecommendationEvent): string {
  return event.canonicalEventId ?? event.canonicalIntentId ?? `${event.sourceProtocol}:${event.sourceEventId}:${event.kind}`;
}

function canonicalEventKindToSourceItemKind(kind: CanonicalRecommendationEventKind): RecommendationSourceItemKind {
  switch (kind) {
    case "ProfileUpdate":
    case "AccountState":
      return "profile";
    case "FollowAdd":
    case "FollowRemove":
      return "follow";
    case "ReactionAdd":
    case "ReactionRemove":
    case "ShareAdd":
    case "ShareRemove":
    case "PollVoteAdd":
      return "reaction";
    case "ReportCreate":
      return "label";
    case "PostCreate":
    case "PostEdit":
    case "PostDelete":
    case "PostInteractionPolicyUpdate":
    case "PollCreate":
    case "PollEdit":
    case "PollDelete":
    case "DirectMessage":
      return "post";
  }
}

function shouldIncludeCanonicalEvent(event: CanonicalRecommendationEvent, options: CanonicalRecommendationSourceOptions): boolean {
  return options.includeMirroredEvents === true || event.projectionMode !== "mirrored";
}

function normalizeSourceSystem(value: string | undefined): string {
  const sourceSystem = value ?? DEFAULT_CANONICAL_SOURCE_SYSTEM;
  if (!isNonEmptyString(sourceSystem)) {
    throw new TypeError("Invalid canonical recommendation source system.");
  }
  assertBoundedString(sourceSystem, "Canonical source system", MAX_SOURCE_SYSTEM_LENGTH);
  return sourceSystem;
}

function normalizeAdapterId(value: string | undefined): string {
  const adapterId = value ?? CANONICAL_RECOMMENDATION_SOURCE_ADAPTER_ID;
  if (!isNonEmptyString(adapterId)) {
    throw new TypeError("Invalid canonical recommendation source adapter id.");
  }
  assertBoundedString(adapterId, "Canonical source adapter id", MAX_ADAPTER_ID_LENGTH);
  return adapterId;
}

function normalizeTrustBoundary(
  event: CanonicalRecommendationEvent,
  options: CanonicalRecommendationSourceOptions
): RecommendationSourceTrustBoundary {
  return event.trustBoundary ?? options.defaultTrustBoundary ?? DEFAULT_CANONICAL_TRUST_BOUNDARY;
}

export function createCanonicalRecommendationSourceItem(
  eventInput: CanonicalRecommendationEvent,
  options: CanonicalRecommendationSourceOptions = {}
): RecommendationSourceItem | null {
  const event = normalizeCanonicalRecommendationEvent(eventInput);
  if (!shouldIncludeCanonicalEvent(event, options)) {
    return null;
  }

  return normalizeRecommendationSourceItem({
    kind: canonicalEventKindToSourceItemKind(event.kind),
    context: createCanonicalRecommendationSourceContext(event, options),
    provenance: {
      adapterId: normalizeAdapterId(options.adapterId),
      sourceSystem: normalizeSourceSystem(options.sourceSystem),
      observedAt: event.observedAt,
      trustBoundary: normalizeTrustBoundary(event, options),
      opaqueSourceId: canonicalEventIdentity(event)
    }
  });
}

function resolveAdapterEvents(
  events: CanonicalRecommendationSourceAdapterOptions["events"]
): readonly CanonicalRecommendationEvent[] | Promise<readonly CanonicalRecommendationEvent[]> {
  return typeof events === "function" ? events() : events;
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }

  if (!/^\d+$/u.test(cursor)) {
    throw new TypeError("Invalid canonical recommendation source adapter cursor.");
  }

  const offset = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset)) {
    throw new TypeError("Invalid canonical recommendation source adapter cursor.");
  }

  return offset;
}

function normalizeCapabilities(
  capabilities: readonly RecommendationSourceAdapterCapability[] | undefined
): readonly RecommendationSourceAdapterCapability[] {
  const values = capabilities ?? ["read_public", "read_private_with_authorization", "supports_incremental_sync"];
  if (values.some((capability) => !isKnownAdapterCapability(capability))) {
    throw new TypeError("Invalid canonical recommendation source adapter capability.");
  }

  return Object.freeze([...values]);
}

function createReadOptions(
  adapterId: string,
  sourceSystem: string,
  options: CanonicalRecommendationSourceAdapterOptions
): CanonicalRecommendationSourceOptions {
  const readOptions: CanonicalRecommendationSourceOptions = { adapterId, sourceSystem };
  if (options.includeMirroredEvents !== undefined) readOptions.includeMirroredEvents = options.includeMirroredEvents;
  if (options.defaultTrustBoundary !== undefined) readOptions.defaultTrustBoundary = options.defaultTrustBoundary;
  if (options.containsThirdPartyData !== undefined) readOptions.containsThirdPartyData = options.containsThirdPartyData;
  if (options.serverSideProcessing !== undefined) readOptions.serverSideProcessing = options.serverSideProcessing;
  if (options.providerPolicyAllowsProcessing !== undefined) {
    readOptions.providerPolicyAllowsProcessing = options.providerPolicyAllowsProcessing;
  }
  return Object.freeze(readOptions);
}

function readCanonicalSourceItems(
  events: readonly CanonicalRecommendationEvent[],
  readOptions: CanonicalRecommendationSourceOptions,
  offset: number,
  limit: number,
  sinceMillis: number | undefined
): RecommendationSourceAdapterReadResult {
  const seen = new Set<string>();
  const page: RecommendationSourceItem[] = [];
  let acceptedCount = 0;
  let hasMore = false;

  for (const event of events) {
    if (sinceMillis !== undefined && eventObservedAtMillis(event) < sinceMillis) {
      continue;
    }

    if (!shouldIncludeCanonicalEvent(event, readOptions)) {
      continue;
    }

    const normalizedEvent = normalizeCanonicalRecommendationEvent(event);
    const id = canonicalEventIdentity(normalizedEvent);
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);

    if (acceptedCount < offset) {
      acceptedCount += 1;
      continue;
    }

    if (page.length >= limit) {
      hasMore = true;
      break;
    }

    const item = createCanonicalRecommendationSourceItem(normalizedEvent, readOptions);
    if (item === null) {
      continue;
    }

    page.push(item);
    acceptedCount += 1;
  }

  const result: RecommendationSourceAdapterReadResult = {
    items: Object.freeze(page)
  };
  if (hasMore) {
    result.cursor = String(offset + page.length);
  }

  return Object.freeze(result);
}

export function createCanonicalRecommendationSourceAdapter(
  options: CanonicalRecommendationSourceAdapterOptions
): RecommendationSourceAdapter {
  if (!isObject(options)) {
    throw new TypeError("Invalid canonical recommendation source adapter options.");
  }

  const adapterId = normalizeAdapterId(options.adapterId);
  const sourceSystem = normalizeSourceSystem(options.sourceSystem);
  if (options.defaultTrustBoundary !== undefined && !isKnownTrustBoundary(options.defaultTrustBoundary)) {
    throw new TypeError("Invalid canonical recommendation source adapter trust boundary.");
  }

  const capabilities = normalizeCapabilities(options.capabilities);
  const readOptions = createReadOptions(adapterId, sourceSystem, options);

  return Object.freeze({
    id: adapterId,
    protocol: "app_local",
    capabilities,
    async read(request: RecommendationSourceAdapterReadRequest): Promise<RecommendationSourceAdapterReadResult> {
      const safeRequest = normalizeRecommendationSourceAdapterReadRequest(request);
      const offset = parseCursor(safeRequest.cursor);
      const limit = safeRequest.limit ?? 100;
      const sinceMillis = parseSinceTimestamp(safeRequest.since);
      const events = await resolveAdapterEvents(options.events);
      return readCanonicalSourceItems(events, readOptions, offset, limit, sinceMillis);
    }
  });
}
