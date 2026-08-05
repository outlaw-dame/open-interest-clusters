import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  createRecommendationActivityPubPublicOutboxSourceAdapter,
  type RecommendationActivityPubOutboxAuthorizer,
  type RecommendationActivityPubOutboxTransportResponse,
  type RecommendationActivityPubPublicOutboxSourceAdapterInput
} from "./activitypub-public-outbox-source-adapter.js";
import { createActivityPodsSourceContext } from "./protocol-source-contexts.js";
import {
  normalizeRecommendationSourceAdapterReadRequest,
  normalizeRecommendationSourceItem,
  type RecommendationSourceAdapter,
  type RecommendationSourceAdapterReadRequest,
  type RecommendationSourceAdapterReadResult
} from "./source-adapter.js";

export const ACTIVITYPODS_PUBLIC_OUTBOX_RECOMMENDATION_SOURCE_ADAPTER_ID =
  "activitypods-public-outbox-source-adapter" as const;
export const DEFAULT_ACTIVITYPODS_PUBLIC_OUTBOX_SOURCE_SYSTEM = "activitypods.public-outbox.v1" as const;
export const ACTIVITYPODS_READ_OUTBOX_RIGHT = "http://activitypods.org/ns/core#ReadOutbox" as const;

export const RECOMMENDATION_ACTIVITYPODS_OUTBOX_NOTIFICATION_TYPES = [
  "Add",
  "Remove",
  "Create",
  "Update",
  "Delete"
] as const;

export type RecommendationActivityPodsOutboxNotificationType =
  typeof RECOMMENDATION_ACTIVITYPODS_OUTBOX_NOTIFICATION_TYPES[number];

export const RECOMMENDATION_ACTIVITYPODS_OUTBOX_MUTATION_ACTIONS = [
  "public_refetch_required",
  "retract",
  "invalidate_snapshot",
  "disable_source"
] as const;

export type RecommendationActivityPodsOutboxMutationAction =
  typeof RECOMMENDATION_ACTIVITYPODS_OUTBOX_MUTATION_ACTIONS[number];

export interface RecommendationActivityPodsActorBinding {
  webId: string;
  inboxUri: string;
  outboxUri: string;
  proxyUri?: string;
  sparqlEndpointUri?: string;
}

export interface RecommendationActivityPodsResourceTransportRequest {
  url: string;
  authentication: "anonymous";
  jsonLdContext: "https://www.w3.org/ns/activitystreams";
  signal?: AbortSignal;
}

export interface RecommendationActivityPodsResourceTransport {
  get(
    request: RecommendationActivityPodsResourceTransportRequest
  ): RecommendationActivityPubOutboxTransportResponse | Promise<RecommendationActivityPubOutboxTransportResponse>;
}

export interface RecommendationActivityPodsPublicOutboxSourceAdapterInput
  extends Omit<RecommendationActivityPubPublicOutboxSourceAdapterInput, "actorUrl" | "transport" | "adapter"> {
  webId: string;
  transport: RecommendationActivityPodsResourceTransport;
  adapter?: RecommendationActivityPubPublicOutboxSourceAdapterInput["adapter"];
}

export interface RecommendationActivityPodsOutboxGrantInput {
  subjectId: string;
  webId: string;
  applicationActorUri: string;
  applicationRegistrationUri: string;
  accessGrantUri: string;
  dataGrantUri?: string;
  specialRights: readonly string[];
  grantedAt: string;
  checkedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface RecommendationActivityPodsOutboxGrant {
  subjectId: string;
  webId: string;
  applicationActorUri: string;
  applicationRegistrationUri: string;
  accessGrantUri: string;
  dataGrantUri?: string;
  specialRights: readonly string[];
  grantedAt: string;
  checkedAt: string;
  expiresAt?: string;
}

export interface RecommendationActivityPodsOutboxNotificationTransportRequest {
  topic: string;
  applicationActorUri: string;
  accessGrantUri: string;
  authentication: "application";
  jsonLdContext: "https://www.w3.org/ns/solid/notifications-context/v1";
  signal?: AbortSignal;
}

export interface RecommendationActivityPodsOutboxNotificationTransport {
  subscribe(request: RecommendationActivityPodsOutboxNotificationTransportRequest): AsyncIterable<unknown>;
}

export interface RecommendationActivityPodsOutboxAuthorizationRequest {
  subjectId: string;
  webId: string;
  applicationActorUri: string;
}

export type RecommendationActivityPodsOutboxAuthorizer = (
  request: RecommendationActivityPodsOutboxAuthorizationRequest
) => RecommendationActivityPodsOutboxGrantInput | RecommendationActivityPodsOutboxGrant |
  Promise<RecommendationActivityPodsOutboxGrantInput | RecommendationActivityPodsOutboxGrant>;

export interface RecommendationActivityPodsOutboxMutation {
  action: RecommendationActivityPodsOutboxMutationAction;
  notificationType: RecommendationActivityPodsOutboxNotificationType;
  topic: string;
  observedAt: string;
  dedupeKey: string;
  notificationId?: string;
  resourceUri?: string;
}

export interface RecommendationActivityPodsWatchOutboxInput {
  subjectId: string;
  webId: string;
  applicationActorUri: string;
  actorDocument: unknown;
  transport: RecommendationActivityPodsOutboxNotificationTransport;
  authorize: RecommendationActivityPodsOutboxAuthorizer;
  maxFrames?: number;
  maxMutations?: number;
  signal?: AbortSignal;
  onMutation?: (mutation: RecommendationActivityPodsOutboxMutation) => void | Promise<void>;
}

export interface RecommendationActivityPodsWatchOutboxResult {
  actor: RecommendationActivityPodsActorBinding;
  mutations: readonly RecommendationActivityPodsOutboxMutation[];
  frames: number;
  duplicates: number;
  truncated: boolean;
}

const MAX_URL_LENGTH = 4_096;
const MAX_SUBJECT_ID_LENGTH = 512;
const MAX_RIGHTS = 64;
const DEFAULT_MAX_FRAMES = 1_000;
const MAX_FRAMES = 10_000;
const DEFAULT_MAX_MUTATIONS = 10_000;
const MAX_MUTATIONS = 100_000;
const ACTIVITYSTREAMS_LINK_TYPES = new Set<string>([
  "Link",
  "as:Link",
  "https://www.w3.org/ns/activitystreams#Link"
]);
const READ_OUTBOX_RIGHTS = new Set<string>([
  "apods:ReadOutbox",
  ACTIVITYPODS_READ_OUTBOX_RIGHT,
  "https://activitypods.org/ns/core#ReadOutbox"
]);
const NOTIFICATION_TYPE_ALIASES: Readonly<Record<string, RecommendationActivityPodsOutboxNotificationType>> =
  Object.freeze({
    Add: "Add",
    "as:Add": "Add",
    "https://www.w3.org/ns/activitystreams#Add": "Add",
    Remove: "Remove",
    "as:Remove": "Remove",
    "https://www.w3.org/ns/activitystreams#Remove": "Remove",
    Create: "Create",
    "as:Create": "Create",
    "https://www.w3.org/ns/activitystreams#Create": "Create",
    Update: "Update",
    "as:Update": "Update",
    "https://www.w3.org/ns/activitystreams#Update": "Update",
    Delete: "Delete",
    "as:Delete": "Delete",
    "https://www.w3.org/ns/activitystreams#Delete": "Delete"
  });

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
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  return value;
}

function typeValues(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return [];
}

function linkTarget(value: unknown, label: string): string {
  if (typeof value === "string") return boundedString(value, MAX_URL_LENGTH, label);
  if (!isPlainRecord(value)) throw new TypeError(`Invalid ActivityPods ${label}.`);
  const isLink = typeValues(value.type).some((type) => ACTIVITYSTREAMS_LINK_TYPES.has(type));
  if (isLink && typeof value.href === "string") return boundedString(value.href, MAX_URL_LENGTH, label);
  const id = typeof value.id === "string" ? value.id : typeof value["@id"] === "string" ? value["@id"] : undefined;
  if (id !== undefined) return boundedString(id, MAX_URL_LENGTH, label);
  if (typeof value.href === "string") return boundedString(value.href, MAX_URL_LENGTH, label);
  throw new TypeError(`Invalid ActivityPods ${label}.`);
}

function safeHttpsUrl(value: unknown, label: string, expectedOrigin?: string): URL {
  const raw = boundedString(value, MAX_URL_LENGTH, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/u, "");
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
    hostname.includes(":") ||
    (expectedOrigin !== undefined && url.origin !== expectedOrigin)
  ) {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  url.hostname = hostname;
  return url;
}

function timestamp(value: unknown, label: string): string {
  const normalized = boundedString(value, MAX_URL_LENGTH, label);
  normalizeRecommendationSourceAdapterReadRequest({ subjectId: "activitypods", since: normalized });
  return normalized;
}

function endpointValue(endpoints: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (endpoints[key] !== undefined) return endpoints[key];
  }
  return undefined;
}

export function normalizeRecommendationActivityPodsActorBinding(
  value: unknown,
  expectedWebId: string
): RecommendationActivityPodsActorBinding {
  if (!isPlainRecord(value)) throw new TypeError("Invalid ActivityPods actor document.");
  const webIdUrl = safeHttpsUrl(expectedWebId, "WebID");
  const origin = webIdUrl.origin;
  const rawId = value.id ?? value["@id"];
  const webId = safeHttpsUrl(linkTarget(rawId, "actor WebID"), "actor WebID", origin).toString();
  if (webId !== webIdUrl.toString()) throw new TypeError("ActivityPods actor/WebID identity mismatch.");

  const inboxUri = safeHttpsUrl(linkTarget(value.inbox, "actor inbox"), "actor inbox", origin).toString();
  const outboxUri = safeHttpsUrl(linkTarget(value.outbox, "actor outbox"), "actor outbox", origin).toString();

  if (value.publicKey !== undefined) {
    if (!isPlainRecord(value.publicKey)) throw new TypeError("Invalid ActivityPods actor public key.");
    const owner = safeHttpsUrl(
      linkTarget(value.publicKey.owner, "public-key owner"),
      "public-key owner",
      origin
    ).toString();
    if (owner !== webId) throw new TypeError("ActivityPods public-key owner mismatch.");
  }

  const binding: RecommendationActivityPodsActorBinding = { webId, inboxUri, outboxUri };
  if (value.endpoints !== undefined) {
    if (!isPlainRecord(value.endpoints)) throw new TypeError("Invalid ActivityPods actor endpoints.");
    const proxy = endpointValue(value.endpoints, [
      "proxyUrl",
      "as:proxyUrl",
      "https://www.w3.org/ns/activitystreams#proxyUrl"
    ]);
    const sparql = endpointValue(value.endpoints, [
      "void:sparqlEndpoint",
      "http://rdfs.org/ns/void#sparqlEndpoint",
      "https://rdfs.org/ns/void#sparqlEndpoint"
    ]);
    if (proxy !== undefined) {
      binding.proxyUri = safeHttpsUrl(linkTarget(proxy, "proxy endpoint"), "proxy endpoint", origin).toString();
    }
    if (sparql !== undefined) {
      binding.sparqlEndpointUri = safeHttpsUrl(
        linkTarget(sparql, "SPARQL endpoint"),
        "SPARQL endpoint",
        origin
      ).toString();
    }
  }
  return Object.freeze(binding);
}

function positiveInteger(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`Invalid ActivityPods ${label}.`);
  }
  return value;
}

function normalizeRights(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RIGHTS) {
    throw new TypeError("Invalid ActivityPods special rights.");
  }
  const rights = new Set<string>();
  for (const right of value) {
    const normalized = boundedString(right, 256, "special right");
    rights.add(READ_OUTBOX_RIGHTS.has(normalized) ? ACTIVITYPODS_READ_OUTBOX_RIGHT : normalized);
  }
  if (!rights.has(ACTIVITYPODS_READ_OUTBOX_RIGHT)) {
    throw new TypeError("ActivityPods outbox access requires apods:ReadOutbox.");
  }
  return Object.freeze([...rights].sort());
}

export function normalizeRecommendationActivityPodsOutboxGrant(
  input: RecommendationActivityPodsOutboxGrantInput | RecommendationActivityPodsOutboxGrant
): RecommendationActivityPodsOutboxGrant {
  if (!isPlainRecord(input)) throw new TypeError("Invalid ActivityPods outbox grant.");
  const subjectId = boundedString(input.subjectId, MAX_SUBJECT_ID_LENGTH, "grant subject ID");
  const webIdUrl = safeHttpsUrl(input.webId, "grant WebID");
  const origin = webIdUrl.origin;
  const applicationActorUri = safeHttpsUrl(input.applicationActorUri, "application actor URI").toString();
  const applicationRegistrationUri = safeHttpsUrl(
    input.applicationRegistrationUri,
    "application registration URI",
    origin
  ).toString();
  const accessGrantUri = safeHttpsUrl(input.accessGrantUri, "access grant URI", origin).toString();
  const dataGrantUri = input.dataGrantUri === undefined
    ? undefined
    : safeHttpsUrl(input.dataGrantUri, "data grant URI", origin).toString();
  const specialRights = normalizeRights(input.specialRights);
  const grantedAt = timestamp(input.grantedAt, "grant timestamp");
  const checkedAt = timestamp(input.checkedAt, "grant check timestamp");
  const expiresAt = input.expiresAt === undefined ? undefined : timestamp(input.expiresAt, "grant expiration timestamp");
  const revokedAt = input.revokedAt === undefined ? undefined : timestamp(input.revokedAt, "grant revocation timestamp");

  if (Date.parse(grantedAt) > Date.parse(checkedAt)) throw new TypeError("ActivityPods grant predates its issuance check.");
  if (revokedAt !== undefined) throw new TypeError("ActivityPods outbox grant has been revoked.");
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(checkedAt)) {
    throw new TypeError("ActivityPods outbox grant has expired.");
  }

  const grant: RecommendationActivityPodsOutboxGrant = {
    subjectId,
    webId: webIdUrl.toString(),
    applicationActorUri,
    applicationRegistrationUri,
    accessGrantUri,
    specialRights,
    grantedAt,
    checkedAt
  };
  if (dataGrantUri !== undefined) grant.dataGrantUri = dataGrantUri;
  if (expiresAt !== undefined) grant.expiresAt = expiresAt;
  return Object.freeze(grant);
}

function mapPublicActivityPodsResult(result: RecommendationSourceAdapterReadResult): RecommendationSourceAdapterReadResult {
  const items = result.items.map((item) => normalizeRecommendationSourceItem({
    kind: item.kind,
    context: createActivityPodsSourceContext({
      resourceScope: item.context.sourceVisibility === "unlisted" ? "unlisted" : "public",
      containsThirdPartyData: item.context.containsThirdPartyData,
      serverSideProcessing: item.context.serverSideProcessing,
      providerPolicyAllowsProcessing: item.context.providerPolicyAllowsProcessing
    }),
    provenance: item.provenance
  }));
  const mapped: RecommendationSourceAdapterReadResult = { items: Object.freeze(items) };
  if (result.cursor !== undefined) mapped.cursor = result.cursor;
  return Object.freeze(mapped);
}

export function createRecommendationActivityPodsPublicOutboxSourceAdapter(
  input: RecommendationActivityPodsPublicOutboxSourceAdapterInput
): RecommendationSourceAdapter {
  if (!isPlainRecord(input) || !isPlainRecord(input.transport) || typeof input.transport.get !== "function") {
    throw new TypeError("Invalid ActivityPods public outbox source adapter input.");
  }
  const webId = safeHttpsUrl(input.webId, "public outbox WebID").toString();
  const adapterOptions = {
    id: ACTIVITYPODS_PUBLIC_OUTBOX_RECOMMENDATION_SOURCE_ADAPTER_ID,
    sourceSystem: DEFAULT_ACTIVITYPODS_PUBLIC_OUTBOX_SOURCE_SYSTEM,
    ...(input.adapter ?? {})
  };
  const authorize: RecommendationActivityPubOutboxAuthorizer = input.authorize;
  const activityPubAdapter = createRecommendationActivityPubPublicOutboxSourceAdapter({
    actorUrl: webId,
    authorize,
    adapter: adapterOptions,
    ...(input.maxActivitiesPerRead === undefined ? {} : { maxActivitiesPerRead: input.maxActivitiesPerRead }),
    ...(input.maxPagesPerRead === undefined ? {} : { maxPagesPerRead: input.maxPagesPerRead }),
    ...(input.maxItemsPerPage === undefined ? {} : { maxItemsPerPage: input.maxItemsPerPage }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    transport: {
      async get(request) {
        const response = await input.transport.get({
          url: request.url,
          authentication: "anonymous",
          jsonLdContext: "https://www.w3.org/ns/activitystreams",
          ...(request.signal === undefined ? {} : { signal: request.signal })
        });
        if (request.url !== webId) return response;
        if (!isPlainRecord(response) || !isPlainRecord(response.body)) {
          throw new TypeError("Invalid ActivityPods actor transport response.");
        }
        const binding = normalizeRecommendationActivityPodsActorBinding(response.body, webId);
        return {
          observedAt: response.observedAt,
          body: {
            ...response.body,
            id: binding.webId,
            inbox: binding.inboxUri,
            outbox: binding.outboxUri
          }
        };
      }
    }
  });

  return Object.freeze({
    id: activityPubAdapter.id,
    protocol: "activitypods",
    capabilities: activityPubAdapter.capabilities,
    async read(request: RecommendationSourceAdapterReadRequest): Promise<RecommendationSourceAdapterReadResult> {
      return mapPublicActivityPodsResult(await activityPubAdapter.read(request));
    }
  });
}

function normalizeNotificationType(value: unknown): RecommendationActivityPodsOutboxNotificationType {
  const matches = new Set<RecommendationActivityPodsOutboxNotificationType>();
  for (const type of typeValues(value)) {
    const normalized = NOTIFICATION_TYPE_ALIASES[type];
    if (normalized !== undefined) matches.add(normalized);
  }
  if (matches.size !== 1) throw new TypeError("Invalid ActivityPods outbox notification type.");
  return [...matches][0] as RecommendationActivityPodsOutboxNotificationType;
}

function optionalNotificationUri(value: unknown, label: string, origin: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return safeHttpsUrl(linkTarget(value, label), label, origin).toString();
}

function notificationFrame(value: unknown): { body: Record<string, unknown>; observedAt: string } {
  if (!isPlainRecord(value) || !isPlainRecord(value.body)) {
    throw new TypeError("Invalid ActivityPods notification frame.");
  }
  return { body: value.body, observedAt: timestamp(value.observedAt, "notification observation timestamp") };
}

function normalizeNotificationMutation(
  body: Record<string, unknown>,
  observedAt: string,
  actor: RecommendationActivityPodsActorBinding
): RecommendationActivityPodsOutboxMutation {
  const notificationType = normalizeNotificationType(body.type);
  const origin = new URL(actor.webId).origin;
  const topic = optionalNotificationUri(body.topic, "notification topic", origin) ?? actor.outboxUri;
  if (topic !== actor.outboxUri) throw new TypeError("ActivityPods notification topic mismatch.");
  const notificationId = body.id === undefined && body["@id"] === undefined
    ? undefined
    : safeHttpsUrl(linkTarget(body.id ?? body["@id"], "notification ID"), "notification ID", origin).toString();
  const objectUri = optionalNotificationUri(body.object, "notification object", origin);
  const targetUri = optionalNotificationUri(body.target, "notification target", origin);

  let action: RecommendationActivityPodsOutboxMutationAction;
  let resourceUri: string | undefined;
  if (notificationType === "Add" || notificationType === "Remove") {
    if (targetUri !== actor.outboxUri || objectUri === undefined) {
      throw new TypeError("ActivityPods collection notification is not bound to the outbox.");
    }
    action = notificationType === "Add" ? "public_refetch_required" : "retract";
    resourceUri = objectUri;
  } else {
    if (targetUri !== undefined && targetUri !== actor.outboxUri) {
      throw new TypeError("ActivityPods resource notification target mismatch.");
    }
    if (objectUri !== undefined && objectUri !== actor.outboxUri) {
      throw new TypeError("ActivityPods resource notification object mismatch.");
    }
    action = notificationType === "Delete"
      ? "disable_source"
      : "invalidate_snapshot";
  }

  const dedupeKey = notificationId ?? [notificationType, topic, resourceUri ?? "", observedAt].join("|");
  const mutation: RecommendationActivityPodsOutboxMutation = {
    action,
    notificationType,
    topic,
    observedAt,
    dedupeKey
  };
  if (notificationId !== undefined) mutation.notificationId = notificationId;
  if (resourceUri !== undefined) mutation.resourceUri = resourceUri;
  return Object.freeze(mutation);
}

function sameGrantIdentity(
  left: RecommendationActivityPodsOutboxGrant,
  right: RecommendationActivityPodsOutboxGrant
): boolean {
  return (
    left.subjectId === right.subjectId &&
    left.webId === right.webId &&
    left.applicationActorUri === right.applicationActorUri &&
    left.applicationRegistrationUri === right.applicationRegistrationUri &&
    left.accessGrantUri === right.accessGrantUri &&
    left.dataGrantUri === right.dataGrantUri
  );
}

function assertGrantBinding(
  grant: RecommendationActivityPodsOutboxGrant,
  input: RecommendationActivityPodsWatchOutboxInput,
  actor: RecommendationActivityPodsActorBinding
): void {
  if (
    grant.subjectId !== input.subjectId ||
    grant.webId !== actor.webId ||
    grant.applicationActorUri !== safeHttpsUrl(input.applicationActorUri, "watcher application actor URI").toString()
  ) {
    throw new TypeError("ActivityPods outbox grant identity mismatch.");
  }
}

export async function watchRecommendationActivityPodsOutbox(
  input: RecommendationActivityPodsWatchOutboxInput
): Promise<RecommendationActivityPodsWatchOutboxResult> {
  if (
    !isPlainRecord(input) ||
    !isPlainRecord(input.transport) ||
    typeof input.transport.subscribe !== "function" ||
    typeof input.authorize !== "function"
  ) {
    throw new TypeError("Invalid ActivityPods outbox watcher input.");
  }
  const subjectId = boundedString(input.subjectId, MAX_SUBJECT_ID_LENGTH, "watcher subject ID");
  const webId = safeHttpsUrl(input.webId, "watcher WebID").toString();
  const applicationActorUri = safeHttpsUrl(input.applicationActorUri, "watcher application actor URI").toString();
  const actor = normalizeRecommendationActivityPodsActorBinding(input.actorDocument, webId);
  const maximumFrames = positiveInteger(input.maxFrames, DEFAULT_MAX_FRAMES, MAX_FRAMES, "maximum notification frames");
  const maximumMutations = positiveInteger(
    input.maxMutations,
    DEFAULT_MAX_MUTATIONS,
    MAX_MUTATIONS,
    "maximum notification mutations"
  );
  const authorizationRequest = Object.freeze({ subjectId, webId, applicationActorUri });
  const initialGrant = normalizeRecommendationActivityPodsOutboxGrant(await input.authorize(authorizationRequest));
  assertGrantBinding(initialGrant, input, actor);

  const stream = input.transport.subscribe({
    topic: actor.outboxUri,
    applicationActorUri,
    accessGrantUri: initialGrant.accessGrantUri,
    authentication: "application",
    jsonLdContext: "https://www.w3.org/ns/solid/notifications-context/v1",
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
  const mutations: RecommendationActivityPodsOutboxMutation[] = [];
  const seen = new Set<string>();
  let frames = 0;
  let duplicates = 0;
  let truncated = false;

  for await (const rawFrame of stream) {
    if (frames >= maximumFrames || mutations.length >= maximumMutations) {
      truncated = true;
      break;
    }
    if (input.signal?.aborted === true) throw new Error("ActivityPods outbox watcher aborted.");
    const currentGrant = normalizeRecommendationActivityPodsOutboxGrant(await input.authorize(authorizationRequest));
    assertGrantBinding(currentGrant, input, actor);
    if (!sameGrantIdentity(initialGrant, currentGrant)) {
      throw new TypeError("ActivityPods outbox grant identity changed during subscription.");
    }

    const frame = notificationFrame(rawFrame);
    frames += 1;
    const mutation = normalizeNotificationMutation(frame.body, frame.observedAt, actor);
    if (seen.has(mutation.dedupeKey)) {
      duplicates += 1;
      continue;
    }
    seen.add(mutation.dedupeKey);
    mutations.push(mutation);
    await input.onMutation?.(mutation);
  }

  return Object.freeze({
    actor,
    mutations: Object.freeze(mutations),
    frames,
    duplicates,
    truncated
  });
}
