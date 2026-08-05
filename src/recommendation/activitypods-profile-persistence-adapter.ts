import {
  requireRecommendationActivityPodsResourceOperation,
  type RecommendationActivityPodsResourceGrantEvidence,
  type RecommendationActivityPodsResourceGrantEvidenceInput,
  type RecommendationActivityPodsResourceOperation
} from "./activitypods-resource-authorization.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import type {
  RecommendationProfilePersistenceAdapter,
  RecommendationProfileStoreRecord
} from "./profile-store-persistence.js";
import { assertValidRecommendationProfileSubjectKey } from "./profile-store-persistence-key.js";
import { normalizeRecommendationProfileStoreRecord } from "./profile-store-persistence-record.js";

export const RECOMMENDATION_ACTIVITYPODS_PROFILE_MEDIA_TYPE = "application/ld+json" as const;
export const RECOMMENDATION_ACTIVITYPODS_PROFILE_EXTENSION = ".jsonld" as const;

export interface RecommendationActivityPodsProfileCodec {
  encode(record: RecommendationProfileStoreRecord): unknown | Promise<unknown>;
  decode(document: unknown): unknown | Promise<unknown>;
}

export interface RecommendationActivityPodsProfileTransportRequest {
  resourceUri: string;
  applicationActorUri: string;
  ownerWebId: string;
  applicationRegistrationUri: string;
  accessGrantUri: string;
  dataGrantUri: string;
  shapeTreeUri: string;
  mediaType: typeof RECOMMENDATION_ACTIVITYPODS_PROFILE_MEDIA_TYPE;
  jsonLdContext?: string;
  signal?: AbortSignal;
}

export interface RecommendationActivityPodsProfileTransportWriteRequest
  extends RecommendationActivityPodsProfileTransportRequest {
  document: unknown;
  condition:
    | { kind: "if_match"; entityTag: string }
    | { kind: "if_none_match"; value: "*" };
}

export interface RecommendationActivityPodsProfileTransportDeleteRequest
  extends RecommendationActivityPodsProfileTransportRequest {
  condition: { kind: "if_match"; entityTag: string };
}

export type RecommendationActivityPodsProfileTransportReadResult =
  | { status: "not_found" }
  | { status: "found"; document: unknown; entityTag: string };

export type RecommendationActivityPodsProfileTransportWriteResult =
  | { status: "written"; entityTag: string }
  | { status: "precondition_failed" };

export type RecommendationActivityPodsProfileTransportDeleteResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "precondition_failed" };

export interface RecommendationActivityPodsProfileTransport {
  read(
    request: RecommendationActivityPodsProfileTransportRequest
  ):
    | RecommendationActivityPodsProfileTransportReadResult
    | Promise<RecommendationActivityPodsProfileTransportReadResult>;
  write(
    request: RecommendationActivityPodsProfileTransportWriteRequest
  ):
    | RecommendationActivityPodsProfileTransportWriteResult
    | Promise<RecommendationActivityPodsProfileTransportWriteResult>;
  delete(
    request: RecommendationActivityPodsProfileTransportDeleteRequest
  ):
    | RecommendationActivityPodsProfileTransportDeleteResult
    | Promise<RecommendationActivityPodsProfileTransportDeleteResult>;
}

export type RecommendationActivityPodsProfileAuthorizer = (
  operation: RecommendationActivityPodsResourceOperation,
  resourceUri: string,
  subjectKey: string
) =>
  | RecommendationActivityPodsResourceGrantEvidenceInput
  | Promise<RecommendationActivityPodsResourceGrantEvidenceInput>;

export interface RecommendationActivityPodsProfilePersistenceAdapterInput {
  subjectId: string;
  applicationActorUri: string;
  applicationRegistrationUri: string;
  accessGrantUri: string;
  dataGrantUri: string;
  ownerActorUri: string;
  ownerWebId: string;
  storageRootUri: string;
  profileContainerUri: string;
  shapeTreeUri: string;
  jsonLdContext?: string;
  signal?: AbortSignal;
  now?: () => string;
  transport: RecommendationActivityPodsProfileTransport;
  codec: RecommendationActivityPodsProfileCodec;
  authorize: RecommendationActivityPodsProfileAuthorizer;
}

export class RecommendationActivityPodsProfileConflictError extends Error {
  readonly code = "activitypods_profile_conflict" as const;

  constructor() {
    super("ActivityPods profile resource changed concurrently.");
    this.name = "RecommendationActivityPodsProfileConflictError";
  }
}

const MAX_IDENTIFIER_LENGTH = 2_048;
const MAX_CONTEXT_LENGTH = 16 * 1_024;
const MAX_ENTITY_TAG_LENGTH = 512;

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
    throw new TypeError(`Invalid ActivityPods profile ${label}.`);
  }
  return value;
}

function httpsUrl(value: unknown, label: string, requireDirectory = false): string {
  const raw = boundedString(value, MAX_IDENTIFIER_LENGTH, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`Invalid ActivityPods profile ${label}.`);
  }
  const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.+$/u, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.search !== "" ||
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname.includes(":") ||
    (requireDirectory && !url.pathname.endsWith("/"))
  ) {
    throw new TypeError(`Invalid ActivityPods profile ${label}.`);
  }
  url.hostname = hostname;
  return url.toString();
}

function isWithin(childUri: string, parentUri: string): boolean {
  const child = new URL(childUri);
  const parent = new URL(parentUri);
  return child.origin === parent.origin && child.pathname.startsWith(parent.pathname);
}

function jsonLdContext(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const raw = boundedString(value, MAX_CONTEXT_LENGTH, "JSON-LD context header");
  try {
    return httpsUrl(raw, "JSON-LD context header");
  } catch {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new TypeError("Invalid ActivityPods profile JSON-LD context header.");
    }
    if (!isPlainRecord(parsed) && !Array.isArray(parsed)) {
      throw new TypeError("Invalid ActivityPods profile JSON-LD context header.");
    }
    return JSON.stringify(parsed);
  }
}

function entityTag(value: unknown): string {
  const tag = boundedString(value, MAX_ENTITY_TAG_LENGTH, "entity tag");
  const strong = tag.startsWith("\"") && tag.endsWith("\"");
  const weak = tag.startsWith("W/\"") && tag.endsWith("\"");
  if ((!strong && !weak) || tag === "\"\"" || tag === "W/\"\"") {
    throw new TypeError("Invalid ActivityPods profile entity tag.");
  }
  return tag;
}

function normalizeReadResult(value: unknown): RecommendationActivityPodsProfileTransportReadResult {
  if (!isPlainRecord(value) || (value.status !== "found" && value.status !== "not_found")) {
    throw new TypeError("Invalid ActivityPods profile transport read result.");
  }
  if (value.status === "not_found") {
    if (Object.keys(value).some((key) => key !== "status")) {
      throw new TypeError("Invalid ActivityPods profile not-found response.");
    }
    return Object.freeze({ status: "not_found" });
  }
  if (!("document" in value)) throw new TypeError("Invalid ActivityPods profile found response.");
  return Object.freeze({
    status: "found",
    document: value.document,
    entityTag: entityTag(value.entityTag)
  });
}

function normalizeWriteResult(value: unknown): RecommendationActivityPodsProfileTransportWriteResult {
  if (!isPlainRecord(value) || (value.status !== "written" && value.status !== "precondition_failed")) {
    throw new TypeError("Invalid ActivityPods profile transport write result.");
  }
  if (value.status === "precondition_failed") {
    if (Object.keys(value).some((key) => key !== "status")) {
      throw new TypeError("Invalid ActivityPods profile transport write result.");
    }
    return Object.freeze({ status: "precondition_failed" });
  }
  return Object.freeze({ status: "written", entityTag: entityTag(value.entityTag) });
}

function normalizeDeleteResult(value: unknown): RecommendationActivityPodsProfileTransportDeleteResult {
  if (
    !isPlainRecord(value) ||
    (value.status !== "deleted" && value.status !== "not_found" && value.status !== "precondition_failed") ||
    Object.keys(value).some((key) => key !== "status")
  ) {
    throw new TypeError("Invalid ActivityPods profile transport delete result.");
  }
  return Object.freeze({ status: value.status }) as RecommendationActivityPodsProfileTransportDeleteResult;
}

function profileResourceUri(containerUri: string, subjectKey: string): string {
  assertValidRecommendationProfileSubjectKey(subjectKey);
  const resourceUri = new URL(
    `${encodeURIComponent(subjectKey)}${RECOMMENDATION_ACTIVITYPODS_PROFILE_EXTENSION}`,
    containerUri
  ).toString();
  if (!isWithin(resourceUri, containerUri)) {
    throw new TypeError("ActivityPods profile resource escaped its container.");
  }
  return resourceUri;
}

function normalizeRecord(value: unknown): RecommendationProfileStoreRecord {
  const record = normalizeRecommendationProfileStoreRecord(value, { pruneExpiredEntries: false });
  if (record === null) throw new TypeError("Invalid ActivityPods profile store record.");
  return record;
}

export function createRecommendationActivityPodsProfilePersistenceAdapter(
  input: RecommendationActivityPodsProfilePersistenceAdapterInput
): RecommendationProfilePersistenceAdapter {
  if (
    !isPlainRecord(input) ||
    !isPlainRecord(input.transport) ||
    typeof input.transport.read !== "function" ||
    typeof input.transport.write !== "function" ||
    typeof input.transport.delete !== "function" ||
    !isPlainRecord(input.codec) ||
    typeof input.codec.encode !== "function" ||
    typeof input.codec.decode !== "function" ||
    typeof input.authorize !== "function" ||
    (input.now !== undefined && typeof input.now !== "function")
  ) {
    throw new TypeError("Invalid ActivityPods profile persistence adapter input.");
  }

  const configuredSubjectId = boundedString(input.subjectId, MAX_IDENTIFIER_LENGTH, "subject ID");
  const applicationActorUri = httpsUrl(input.applicationActorUri, "application actor URI");
  const ownerActorUri = httpsUrl(input.ownerActorUri, "owner actor URI");
  const ownerWebId = httpsUrl(input.ownerWebId, "owner WebID");
  if (ownerActorUri !== ownerWebId) {
    throw new TypeError("ActivityPods profile owner actor must equal the owner WebID.");
  }
  if (applicationActorUri === ownerActorUri) {
    throw new TypeError("ActivityPods profile application actor must be distinct from the owner actor.");
  }
  const ownerOrigin = new URL(ownerWebId).origin;
  const storageRootUri = httpsUrl(input.storageRootUri, "storage root URI", true);
  const profileContainerUri = httpsUrl(input.profileContainerUri, "container URI", true);
  const applicationRegistrationUri = httpsUrl(
    input.applicationRegistrationUri,
    "application registration URI"
  );
  const accessGrantUri = httpsUrl(input.accessGrantUri, "access grant URI");
  const dataGrantUri = httpsUrl(input.dataGrantUri, "data grant URI");
  for (const [uri, label] of [
    [storageRootUri, "storage root URI"],
    [profileContainerUri, "container URI"],
    [applicationRegistrationUri, "application registration URI"],
    [accessGrantUri, "access grant URI"],
    [dataGrantUri, "data grant URI"]
  ] as const) {
    if (new URL(uri).origin !== ownerOrigin) {
      throw new TypeError(`ActivityPods profile ${label} must use the owner Pod authority.`);
    }
  }
  if (!isWithin(profileContainerUri, storageRootUri)) {
    throw new TypeError("ActivityPods profile container must be within the owner storage root.");
  }
  const shapeTreeUri = httpsUrl(input.shapeTreeUri, "shape tree URI");
  const context = jsonLdContext(input.jsonLdContext);

  const authorize = async (
    operation: RecommendationActivityPodsResourceOperation,
    resourceUri: string,
    subjectKey: string
  ): Promise<RecommendationActivityPodsResourceGrantEvidence> => {
    const evidence = requireRecommendationActivityPodsResourceOperation(
      await input.authorize(operation, resourceUri, subjectKey),
      operation,
      { now: input.now?.() }
    );
    if (
      evidence.subjectId !== configuredSubjectId ||
      evidence.applicationActorUri !== applicationActorUri ||
      evidence.applicationRegistrationUri !== applicationRegistrationUri ||
      evidence.accessGrantUri !== accessGrantUri ||
      evidence.dataGrantUri !== dataGrantUri ||
      evidence.ownerActorUri !== ownerActorUri ||
      evidence.ownerWebId !== ownerWebId ||
      evidence.storageRootUri !== storageRootUri ||
      evidence.containerUri !== profileContainerUri ||
      evidence.resourceUri !== resourceUri ||
      evidence.shapeTreeUri !== shapeTreeUri
    ) {
      throw new TypeError(
        "ActivityPods profile grant does not match the configured subject, application, owner, storage, resource, or access need."
      );
    }
    return evidence;
  };

  const request = (
    resourceUri: string,
    evidence: RecommendationActivityPodsResourceGrantEvidence
  ): RecommendationActivityPodsProfileTransportRequest => ({
    resourceUri,
    applicationActorUri,
    ownerWebId,
    applicationRegistrationUri: evidence.applicationRegistrationUri,
    accessGrantUri: evidence.accessGrantUri,
    dataGrantUri: evidence.dataGrantUri,
    shapeTreeUri,
    mediaType: RECOMMENDATION_ACTIVITYPODS_PROFILE_MEDIA_TYPE,
    ...(context === undefined ? {} : { jsonLdContext: context }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });

  return Object.freeze({
    async readProfileRecord(rawSubjectKey: string): Promise<unknown | null> {
      assertValidRecommendationProfileSubjectKey(rawSubjectKey);
      const resourceUri = profileResourceUri(profileContainerUri, rawSubjectKey);
      const evidence = await authorize("read", resourceUri, rawSubjectKey);
      const result = normalizeReadResult(await input.transport.read(request(resourceUri, evidence)));
      if (result.status === "not_found") return null;
      const decoded = await input.codec.decode(result.document);
      const record = normalizeRecord(decoded);
      if (record.subjectKey !== rawSubjectKey) {
        throw new TypeError("ActivityPods profile document subject key mismatch.");
      }
      return record;
    },

    async writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<RecommendationProfileStoreRecord> {
      const normalized = normalizeRecord(record);
      const resourceUri = profileResourceUri(profileContainerUri, normalized.subjectKey);
      const evidence = await authorize("write", resourceUri, normalized.subjectKey);
      const baseRequest = request(resourceUri, evidence);
      const current = normalizeReadResult(await input.transport.read(baseRequest));
      const document = await input.codec.encode(normalized);
      if (!isPlainRecord(document)) {
        throw new TypeError("Invalid ActivityPods profile encoded document.");
      }
      const result = normalizeWriteResult(
        await input.transport.write({
          ...baseRequest,
          document,
          condition: current.status === "found"
            ? { kind: "if_match", entityTag: current.entityTag }
            : { kind: "if_none_match", value: "*" }
        })
      );
      if (result.status === "precondition_failed") {
        throw new RecommendationActivityPodsProfileConflictError();
      }
      return normalized;
    },

    async deleteProfileRecord(rawSubjectKey: string): Promise<void> {
      assertValidRecommendationProfileSubjectKey(rawSubjectKey);
      const resourceUri = profileResourceUri(profileContainerUri, rawSubjectKey);
      const evidence = await authorize("delete", resourceUri, rawSubjectKey);
      const baseRequest = request(resourceUri, evidence);
      const current = normalizeReadResult(await input.transport.read(baseRequest));
      if (current.status === "not_found") return;
      const result = normalizeDeleteResult(
        await input.transport.delete({
          ...baseRequest,
          condition: { kind: "if_match", entityTag: current.entityTag }
        })
      );
      if (result.status === "precondition_failed") {
        throw new RecommendationActivityPodsProfileConflictError();
      }
    }
  });
}
