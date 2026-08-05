import {
  normalizeRecommendationActivityPodsBoxGrantEvidence,
  type RecommendationActivityPodsBoxGrantEvidenceInput,
  type RecommendationActivityPodsBoxType
} from "./activitypods-authorization.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import { mapActivityPubProviderActivityToNormalizedEvent } from "./protocol-source-provider-records.js";
import {
  createActivityPubRecommendationSourceItem,
  RECOMMENDATION_ACTIVITYPUB_NORMALIZED_EVENT_TYPES,
  RECOMMENDATION_ACTIVITYPUB_NORMALIZED_OBJECT_TYPES,
  type RecommendationProtocolSourceNormalizerOptions
} from "./protocol-source-normalizers.js";
import {
  normalizeRecommendationSourceAdapterReadRequest,
  normalizeRecommendationSourceAdapterReadResult,
  normalizeRecommendationSourceItem,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterCapability,
  type RecommendationSourceAdapterReadRequest,
  type RecommendationSourceAdapterReadResult,
  type RecommendationSourceItem
} from "./source-adapter.js";

export const RECOMMENDATION_ACTIVITYPODS_NOTIFICATION_TYPES = [
  "Create",
  "Update",
  "Delete",
  "Add",
  "Remove"
] as const;
export type RecommendationActivityPodsNotificationType =
  typeof RECOMMENDATION_ACTIVITYPODS_NOTIFICATION_TYPES[number];

export const RECOMMENDATION_ACTIVITYPODS_LIVE_RETRACTION_REASONS = [
  "resource_deleted",
  "collection_item_removed"
] as const;
export type RecommendationActivityPodsLiveRetractionReason =
  typeof RECOMMENDATION_ACTIVITYPODS_LIVE_RETRACTION_REASONS[number];

export interface RecommendationActivityPodsLiveNotificationInput {
  id: string;
  type: RecommendationActivityPodsNotificationType;
  boxType: RecommendationActivityPodsBoxType;
  actorUri: string;
  targetUri: string;
  objectUri?: string;
  dereferencedActivity?: unknown;
  observedAt: string;
}

export interface RecommendationActivityPodsLiveTransportRequest {
  ownerActorUri: string;
  boxType: RecommendationActivityPodsBoxType;
  boxUri: string;
  limit: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface RecommendationActivityPodsLiveTransportResult {
  notifications: readonly RecommendationActivityPodsLiveNotificationInput[];
  cursor?: string;
}

export interface RecommendationActivityPodsLiveTransport {
  read(
    request: RecommendationActivityPodsLiveTransportRequest
  ): RecommendationActivityPodsLiveTransportResult | Promise<RecommendationActivityPodsLiveTransportResult>;
}

export type RecommendationActivityPodsLiveAuthorizer = (
  request: RecommendationSourceAdapterReadRequest,
  boxType: RecommendationActivityPodsBoxType,
  boxUri: string
) =>
  | RecommendationActivityPodsBoxGrantEvidenceInput
  | Promise<RecommendationActivityPodsBoxGrantEvidenceInput>;

export interface RecommendationActivityPodsLiveSourceAdapterInput {
  ownerActorUri: string;
  ownerWebId: string;
  applicationActorUri: string;
  boxType: RecommendationActivityPodsBoxType;
  boxUri: string;
  maxNotificationsPerRead?: number;
  signal?: AbortSignal;
  transport: RecommendationActivityPodsLiveTransport;
  authorize: RecommendationActivityPodsLiveAuthorizer;
  adapterId?: string;
  sourceSystem?: string;
  normalizerOptions?: Omit<RecommendationProtocolSourceNormalizerOptions, "adapterId" | "sourceSystem">;
  onIgnored?: (event: RecommendationActivityPodsIgnoredNotificationEvent) => void;
}

export interface RecommendationActivityPodsLiveRetraction {
  notificationId: string;
  sourceObjectUri: string;
  targetCollectionUri: string;
  observedAt: string;
  reason: RecommendationActivityPodsLiveRetractionReason;
}

export const RECOMMENDATION_ACTIVITYPODS_IGNORED_REASONS = [
  "inbox_not_interest_source",
  "control_activity",
  "unsupported_activity",
  "not_explicitly_public",
  "missing_activity"
] as const;
export type RecommendationActivityPodsIgnoredReason =
  typeof RECOMMENDATION_ACTIVITYPODS_IGNORED_REASONS[number];

export interface RecommendationActivityPodsIgnoredNotificationEvent {
  boxType: RecommendationActivityPodsBoxType;
  notificationType: RecommendationActivityPodsNotificationType;
  reason: RecommendationActivityPodsIgnoredReason;
}

export interface RecommendationActivityPodsLiveReadResult extends RecommendationSourceAdapterReadResult {
  retractions: readonly RecommendationActivityPodsLiveRetraction[];
  ignoredCount: number;
}

export type RecommendationActivityPodsLiveSourceAdapter = RecommendationSourceAdapter & {
  readChanges(request: RecommendationSourceAdapterReadRequest): Promise<RecommendationActivityPodsLiveReadResult>;
};

const DEFAULT_ADAPTER_ID = "activitypods-live-source-adapter";
const DEFAULT_SOURCE_SYSTEM = "activitypods.solid-notifications.v1";
const DEFAULT_MAX_NOTIFICATIONS = 100;
const MAX_NOTIFICATIONS = 500;
const MAX_IDENTIFIER_LENGTH = 2_048;
const MAX_CURSOR_LENGTH = 1_024;
const NOTIFICATION_TYPE_SET = new Set<string>(RECOMMENDATION_ACTIVITYPODS_NOTIFICATION_TYPES);
const ACTIVITY_TYPE_SET = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_EVENT_TYPES);
const OBJECT_TYPE_SET = new Set<string>(RECOMMENDATION_ACTIVITYPUB_NORMALIZED_OBJECT_TYPES);
const CAPABILITIES: readonly RecommendationSourceAdapterCapability[] = Object.freeze([
  "read_public",
  "read_private_with_authorization",
  "supports_incremental_sync",
  "supports_deletion_events"
]);
const PUBLIC_RECIPIENTS = new Set<string>([
  "https://www.w3.org/ns/activitystreams#Public",
  "as:Public",
  "Public"
]);
const CONTROL_TYPE_SUFFIXES = Object.freeze([
  "ApplicationRegistration",
  "AccessGrant",
  "DataGrant",
  "AccessNeed",
  "AccessNeedGroup",
  "AccessAuthorization",
  "DataAuthorization"
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(`Invalid ActivityPods live ${label}.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const normalized = boundedString(value, MAX_IDENTIFIER_LENGTH, label);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "activitypods-live", since: normalized });
  return normalized;
}

function httpsUrl(value: unknown, label: string): string {
  const raw = boundedString(value, MAX_IDENTIFIER_LENGTH, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`Invalid ActivityPods live ${label}.`);
  }
  const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.+$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname.includes(":")
  ) {
    throw new TypeError(`Invalid ActivityPods live ${label}.`);
  }
  url.hostname = hostname;
  return url.toString();
}

function optionalHttpsUrl(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : httpsUrl(value, label);
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_NOTIFICATIONS) {
    throw new TypeError("Invalid ActivityPods live maximum notifications per read.");
  }
  return value;
}

function notificationType(value: unknown): RecommendationActivityPodsNotificationType {
  if (typeof value !== "string" || !NOTIFICATION_TYPE_SET.has(value)) {
    throw new TypeError("Invalid ActivityPods live notification type.");
  }
  return value as RecommendationActivityPodsNotificationType;
}

function normalizeNotification(value: unknown): RecommendationActivityPodsLiveNotificationInput {
  if (!isPlainRecord(value)) throw new TypeError("Invalid ActivityPods live notification.");
  const boxType = value.boxType;
  if (boxType !== "inbox" && boxType !== "outbox") throw new TypeError("Invalid ActivityPods live notification box type.");
  const output: RecommendationActivityPodsLiveNotificationInput = {
    id: httpsUrl(value.id, "notification ID"),
    type: notificationType(value.type),
    boxType,
    actorUri: httpsUrl(value.actorUri, "notification owner actor URI"),
    targetUri: httpsUrl(value.targetUri, "notification target URI"),
    observedAt: timestamp(value.observedAt, "notification observation time")
  };
  const objectUri = optionalHttpsUrl(value.objectUri, "notification object URI");
  if (objectUri !== undefined) output.objectUri = objectUri;
  if (value.dereferencedActivity !== undefined) {
    if (!isPlainRecord(value.dereferencedActivity)) {
      throw new TypeError("Invalid ActivityPods live dereferenced activity.");
    }
    output.dereferencedActivity = value.dereferencedActivity;
  }
  return Object.freeze(output);
}

function normalizeTransportResult(value: unknown, maximum: number): RecommendationActivityPodsLiveTransportResult {
  if (!isPlainRecord(value) || !Array.isArray(value.notifications) || value.notifications.length > maximum) {
    throw new TypeError("Invalid ActivityPods live transport result.");
  }
  const output: RecommendationActivityPodsLiveTransportResult = {
    notifications: Object.freeze(value.notifications.map(normalizeNotification))
  };
  if (value.cursor !== undefined) output.cursor = boundedString(value.cursor, MAX_CURSOR_LENGTH, "cursor");
  return Object.freeze(output);
}

function typeValues(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return [];
}

function firstKnownType(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  for (const type of typeValues(value)) {
    if (allowed.has(type)) return type;
  }
  return undefined;
}

function typeSuffix(value: string): string {
  const hash = value.lastIndexOf("#");
  const slash = value.lastIndexOf("/");
  const colon = value.lastIndexOf(":");
  return value.slice(Math.max(hash, slash, colon) + 1);
}

function isControlActivity(activity: Record<string, unknown>): boolean {
  const activityTypes = typeValues(activity.type).map(typeSuffix);
  if (activityTypes.includes("Accept") || activityTypes.includes("Reject")) return true;
  const object = isPlainRecord(activity.object) ? activity.object : undefined;
  const objectTypes = typeValues(object?.type).map(typeSuffix);
  return objectTypes.some((type) => CONTROL_TYPE_SUFFIXES.includes(type));
}

function mapperCompatibleActivity(activity: Record<string, unknown>): Record<string, unknown> | undefined {
  const activityType = firstKnownType(activity.type, ACTIVITY_TYPE_SET);
  if (activityType === undefined) return undefined;
  const rawObject = activity.object;
  let normalizedObject = rawObject;
  if (isPlainRecord(rawObject) && rawObject.type !== undefined) {
    const objectType = firstKnownType(rawObject.type, OBJECT_TYPE_SET);
    if (objectType === undefined) return undefined;
    if (rawObject.type !== objectType) normalizedObject = Object.freeze({ ...rawObject, type: objectType });
  }
  if (activity.type === activityType && normalizedObject === rawObject) return activity;
  return Object.freeze({
    ...activity,
    type: activityType,
    ...(normalizedObject === undefined ? {} : { object: normalizedObject })
  });
}

function hasRecipient(value: unknown, recipients: ReadonlySet<string>): boolean {
  if (typeof value === "string") return recipients.has(value);
  if (Array.isArray(value)) return value.some((item) => hasRecipient(item, recipients));
  if (isPlainRecord(value)) {
    if (typeof value.id === "string") return recipients.has(value.id);
    if (typeof value.href === "string") return recipients.has(value.href);
  }
  return false;
}

function hasAnyRecipient(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.some(hasAnyRecipient);
  return isPlainRecord(value) && (typeof value.id === "string" || typeof value.href === "string");
}

function isExplicitlyPublic(activity: Record<string, unknown>): boolean {
  const object = isPlainRecord(activity.object) ? activity.object : undefined;
  if (
    hasAnyRecipient(activity.bto) ||
    hasAnyRecipient(activity.bcc) ||
    hasAnyRecipient(object?.bto) ||
    hasAnyRecipient(object?.bcc)
  ) {
    return false;
  }
  return (
    hasRecipient(activity.to, PUBLIC_RECIPIENTS) ||
    hasRecipient(activity.cc, PUBLIC_RECIPIENTS) ||
    hasRecipient(activity.audience, PUBLIC_RECIPIENTS) ||
    hasRecipient(object?.to, PUBLIC_RECIPIENTS) ||
    hasRecipient(object?.cc, PUBLIC_RECIPIENTS) ||
    hasRecipient(object?.audience, PUBLIC_RECIPIENTS)
  );
}

function activityActorUri(activity: Record<string, unknown>): string | undefined {
  const actor = activity.actor;
  if (typeof actor === "string") return httpsUrl(actor, "activity actor URI");
  if (isPlainRecord(actor)) {
    if (typeof actor.id === "string") return httpsUrl(actor.id, "activity actor URI");
    if (typeof actor.href === "string") return httpsUrl(actor.href, "activity actor URI");
  }
  return undefined;
}

function publicActivityPodsItem(
  activity: Record<string, unknown>,
  observedAt: string,
  ownerActorUri: string,
  adapterId: string,
  sourceSystem: string,
  normalizerOptions: Omit<RecommendationProtocolSourceNormalizerOptions, "adapterId" | "sourceSystem">,
  providerPolicyAllowsProcessing: boolean | undefined
): RecommendationSourceItem | null {
  const normalizedEvent = mapActivityPubProviderActivityToNormalizedEvent({
    rawActivity: activity,
    observedAt,
    fallbackActorUri: ownerActorUri,
    fallbackVisibility: "public",
    trustBoundary: "user_owned",
    containsThirdPartyData: true,
    serverSideProcessing: true,
    ...(providerPolicyAllowsProcessing === undefined ? {} : { providerPolicyAllowsProcessing })
  });
  const source = createActivityPubRecommendationSourceItem(normalizedEvent, {
    ...normalizerOptions,
    adapterId,
    sourceSystem,
    defaultTrustBoundary: "user_owned",
    containsThirdPartyData: true,
    serverSideProcessing: true,
    ...(providerPolicyAllowsProcessing === undefined ? {} : { providerPolicyAllowsProcessing })
  });
  if (source === null) return null;
  return normalizeRecommendationSourceItem({
    kind: source.kind,
    context: {
      ...source.context,
      protocol: "activitypods",
      sourceVisibility: "public",
      accessBasis: "solid_acl_read",
      containsPrivateData: false,
      containsThirdPartyData: true,
      serverSideProcessing: true,
      ...(providerPolicyAllowsProcessing === undefined ? {} : { providerPolicyAllowsProcessing })
    },
    provenance: source.provenance
  });
}

function notifyIgnored(
  callback: RecommendationActivityPodsLiveSourceAdapterInput["onIgnored"],
  event: RecommendationActivityPodsIgnoredNotificationEvent
): void {
  if (callback === undefined) return;
  try {
    callback(Object.freeze(event));
  } catch {
    // Privacy-safe counters and diagnostics must not break ingestion.
  }
}

function retractionFromNotification(
  notification: RecommendationActivityPodsLiveNotificationInput
): RecommendationActivityPodsLiveRetraction | undefined {
  if (notification.type !== "Delete" && notification.type !== "Remove") return undefined;
  if (notification.objectUri === undefined) return undefined;
  return Object.freeze({
    notificationId: notification.id,
    sourceObjectUri: notification.objectUri,
    targetCollectionUri: notification.targetUri,
    observedAt: notification.observedAt,
    reason: notification.type === "Delete" ? "resource_deleted" : "collection_item_removed"
  });
}

export function createRecommendationActivityPodsLiveSourceAdapter(
  input: RecommendationActivityPodsLiveSourceAdapterInput
): RecommendationActivityPodsLiveSourceAdapter {
  if (
    !isPlainRecord(input) ||
    !isPlainRecord(input.transport) ||
    typeof input.transport.read !== "function" ||
    typeof input.authorize !== "function"
  ) {
    throw new TypeError("Invalid ActivityPods live source adapter input.");
  }
  const ownerActorUri = httpsUrl(input.ownerActorUri, "owner actor URI");
  const ownerWebId = httpsUrl(input.ownerWebId, "owner WebID");
  if (ownerActorUri !== ownerWebId) throw new TypeError("ActivityPods live owner actor must equal the owner WebID.");
  const applicationActorUri = httpsUrl(input.applicationActorUri, "application actor URI");
  if (applicationActorUri === ownerActorUri) {
    throw new TypeError("ActivityPods live application actor must be distinct from the owner actor.");
  }
  if (input.boxType !== "inbox" && input.boxType !== "outbox") {
    throw new TypeError("Invalid ActivityPods live box type.");
  }
  const boxType = input.boxType;
  const boxUri = httpsUrl(input.boxUri, "box URI");
  if (new URL(boxUri).origin !== new URL(ownerActorUri).origin) {
    throw new TypeError("ActivityPods live box must use the owner Pod authority.");
  }
  const maximum = positiveInteger(input.maxNotificationsPerRead, DEFAULT_MAX_NOTIFICATIONS);
  const adapterId = boundedString(input.adapterId ?? DEFAULT_ADAPTER_ID, 256, "adapter ID");
  const sourceSystem = boundedString(input.sourceSystem ?? DEFAULT_SOURCE_SYSTEM, 256, "source system");
  const normalizerOptions = input.normalizerOptions === undefined
    ? Object.freeze({})
    : isPlainRecord(input.normalizerOptions)
      ? Object.freeze({ ...input.normalizerOptions })
      : undefined;
  if (normalizerOptions === undefined) throw new TypeError("Invalid ActivityPods live normalizer options.");

  const readChanges = async (
    rawRequest: RecommendationSourceAdapterReadRequest
  ): Promise<RecommendationActivityPodsLiveReadResult> => {
    const request = normalizeRecommendationSourceAdapterReadRequest(rawRequest);
    if (request.since !== undefined) {
      throw new TypeError("ActivityPods live ingestion uses opaque notification cursors, not timestamps.");
    }
    const grant = normalizeRecommendationActivityPodsBoxGrantEvidence(
      await input.authorize(request, boxType, boxUri)
    );
    if (
      grant.subjectId !== request.subjectId ||
      grant.applicationActorUri !== applicationActorUri ||
      grant.ownerActorUri !== ownerActorUri ||
      grant.ownerWebId !== ownerWebId ||
      grant.boxType !== boxType ||
      grant.boxUri !== boxUri
    ) {
      throw new TypeError("ActivityPods live grant does not match the configured application, owner, or box.");
    }
    if (grant.providerPolicyAllowsProcessing === false) {
      throw new TypeError("ActivityPods provider policy denies live processing.");
    }
    const requestedLimit = request.limit === undefined ? maximum : Math.min(request.limit, maximum);
    const transportRequest: RecommendationActivityPodsLiveTransportRequest = {
      ownerActorUri,
      boxType,
      boxUri,
      limit: requestedLimit
    };
    if (request.cursor !== undefined) transportRequest.cursor = request.cursor;
    if (input.signal !== undefined) transportRequest.signal = input.signal;
    const transportResult = normalizeTransportResult(
      await input.transport.read(transportRequest),
      requestedLimit
    );
    const seen = new Set<string>();
    const items: RecommendationSourceItem[] = [];
    const retractions: RecommendationActivityPodsLiveRetraction[] = [];
    let ignoredCount = 0;

    for (const notification of transportResult.notifications) {
      if (seen.has(notification.id)) continue;
      seen.add(notification.id);
      if (
        notification.actorUri !== ownerActorUri ||
        notification.boxType !== boxType ||
        notification.targetUri !== boxUri
      ) {
        throw new TypeError("ActivityPods live notification owner or box binding mismatch.");
      }
      if (boxType === "inbox") {
        ignoredCount += 1;
        notifyIgnored(input.onIgnored, {
          boxType,
          notificationType: notification.type,
          reason: "inbox_not_interest_source"
        });
        continue;
      }
      const retraction = retractionFromNotification(notification);
      if (retraction !== undefined) {
        retractions.push(retraction);
        continue;
      }
      if (!isPlainRecord(notification.dereferencedActivity)) {
        ignoredCount += 1;
        notifyIgnored(input.onIgnored, {
          boxType,
          notificationType: notification.type,
          reason: "missing_activity"
        });
        continue;
      }
      const activity = notification.dereferencedActivity;
      if (isControlActivity(activity)) {
        ignoredCount += 1;
        notifyIgnored(input.onIgnored, {
          boxType,
          notificationType: notification.type,
          reason: "control_activity"
        });
        continue;
      }
      const normalizedActivity = mapperCompatibleActivity(activity);
      if (normalizedActivity === undefined) {
        ignoredCount += 1;
        notifyIgnored(input.onIgnored, {
          boxType,
          notificationType: notification.type,
          reason: "unsupported_activity"
        });
        continue;
      }
      const actorUri = activityActorUri(normalizedActivity);
      if (actorUri !== ownerActorUri) {
        throw new TypeError("ActivityPods live activity actor mismatch.");
      }
      if (!isExplicitlyPublic(normalizedActivity)) {
        ignoredCount += 1;
        notifyIgnored(input.onIgnored, {
          boxType,
          notificationType: notification.type,
          reason: "not_explicitly_public"
        });
        continue;
      }
      const item = publicActivityPodsItem(
        normalizedActivity,
        notification.observedAt,
        ownerActorUri,
        adapterId,
        sourceSystem,
        normalizerOptions,
        grant.providerPolicyAllowsProcessing
      );
      if (item !== null) items.push(item);
    }

    const normalizedResult = normalizeRecommendationSourceAdapterReadResult({
      items,
      ...(transportResult.cursor === undefined ? {} : { cursor: transportResult.cursor })
    });
    return Object.freeze({
      ...normalizedResult,
      retractions: Object.freeze(retractions),
      ignoredCount
    });
  };

  const adapter: RecommendationActivityPodsLiveSourceAdapter = {
    id: adapterId,
    protocol: "activitypods",
    capabilities: CAPABILITIES,
    read: async (request: RecommendationSourceAdapterReadRequest) => {
      const result = await readChanges(request);
      return normalizeRecommendationSourceAdapterReadResult({
        items: result.items,
        ...(result.cursor === undefined ? {} : { cursor: result.cursor })
      });
    },
    readChanges
  };
  return Object.freeze(adapter);
}
