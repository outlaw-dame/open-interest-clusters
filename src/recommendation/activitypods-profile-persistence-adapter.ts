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
  read(request: RecommendationActivityPodsProfileTransportRequest):
    RecommendationActivityPodsProfileTransportReadResult |
    Promise<RecommendationActivityPodsProfileTransportReadResult>;
  write(request: RecommendationActivityPodsProfileTransportWriteRequest):
    RecommendationActivityPodsProfileTransportWriteResult |
    Promise<RecommendationActivityPodsProfileTransportWriteResult>;
  delete(request: RecommendationActivityPodsProfileTransportDeleteRequest):
    RecommendationActivityPodsProfileTransportDeleteResult |
    Promise<RecommendationActivityPodsProfileTransportDeleteResult>;
}

export type RecommendationActivityPodsProfileAuthorizer = (
  operation: RecommendationActivityPodsResourceOperation,
  resourceUri: string,
  subjectKey: string
) => RecommendationActivityPodsResourceGrantEvidenceInput |
  Promise<RecommendationActivityPodsResourceGrantEvidenceInput>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value !== value.trim() ||
    value.length > maximum || hasUnsafeControlCharacter(value)
  ) throw new TypeError(`Invalid ActivityPods profile ${label}.`);
  return value;
}

function url(value: unknown, label: string, directory = false): string {
  let output: URL;
  try { output = new URL(string(value, MAX_IDENTIFIER_LENGTH, label)); }
  catch { throw new TypeError(`Invalid ActivityPods profile ${label}.`); }
  const host = output.hostname.toLocaleLowerCase("en-US").replace(/\.+$/u, "");
  if (
    output.protocol !== "https:" || output.username !== "" || output.password !== "" ||
    output.hash !== "" || output.search !== "" || host.length === 0 || host === "localhost" ||
    host.endsWith(".localhost") || host.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":") ||
    (directory && !output.pathname.endsWith("/"))
  ) throw new TypeError(`Invalid ActivityPods profile ${label}.`);
  output.hostname = host;
  return output.toString();
}

function within(child: string, parent: string): boolean {
  const childUrl = new URL(child);
  const parentUrl = new URL(parent);
  return childUrl.origin === parentUrl.origin && childUrl.pathname.startsWith(parentUrl.pathname);
}

function contextHeader(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const raw = string(value, MAX_CONTEXT_LENGTH, "JSON-LD context header");
  try { return url(raw, "JSON-LD context header"); }
  catch {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new TypeError("Invalid ActivityPods profile JSON-LD context header."); }
    if (!isRecord(parsed) && !Array.isArray(parsed)) {
      throw new TypeError("Invalid ActivityPods profile JSON-LD context header.");
    }
    return JSON.stringify(parsed);
  }
}

function entityTag(value: unknown): string {
  const output = string(value, MAX_ENTITY_TAG_LENGTH, "entity tag");
  const strong = output.startsWith("\"") && output.endsWith("\"");
  const weak = output.startsWith("W/\"") && output.endsWith("\"");
  if ((!strong && !weak) || output === "\"\"" || output === "W/\"\"") {
    throw new TypeError("Invalid ActivityPods profile entity tag.");
  }
  return output;
}

function strongEntityTag(value: string): string {
  const output = entityTag(value);
  if (output.startsWith("W/")) {
    throw new TypeError("ActivityPods profile conditional mutations require a strong entity tag.");
  }
  return output;
}

function readResult(value: unknown): RecommendationActivityPodsProfileTransportReadResult {
  if (!isRecord(value) || (value.status !== "found" && value.status !== "not_found")) {
    throw new TypeError("Invalid ActivityPods profile transport read result.");
  }
  if (value.status === "not_found") {
    if (Object.keys(value).some((key) => key !== "status")) {
      throw new TypeError("Invalid ActivityPods profile not-found response.");
    }
    return Object.freeze({ status: "not_found" });
  }
  if (!("document" in value)) throw new TypeError("Invalid ActivityPods profile found response.");
  return Object.freeze({ status: "found", document: value.document, entityTag: entityTag(value.entityTag) });
}

function writeResult(value: unknown): RecommendationActivityPodsProfileTransportWriteResult {
  if (!isRecord(value) || (value.status !== "written" && value.status !== "precondition_failed")) {
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

function deleteResult(value: unknown): RecommendationActivityPodsProfileTransportDeleteResult {
  if (
    !isRecord(value) ||
    (value.status !== "deleted" && value.status !== "not_found" && value.status !== "precondition_failed") ||
    Object.keys(value).some((key) => key !== "status")
  ) throw new TypeError("Invalid ActivityPods profile transport delete result.");
  return Object.freeze({ status: value.status }) as RecommendationActivityPodsProfileTransportDeleteResult;
}

function resourceUri(container: string, subjectKey: string): string {
  assertValidRecommendationProfileSubjectKey(subjectKey);
  const output = new URL(
    `${encodeURIComponent(subjectKey)}${RECOMMENDATION_ACTIVITYPODS_PROFILE_EXTENSION}`,
    container
  ).toString();
  if (!within(output, container)) throw new TypeError("ActivityPods profile resource escaped its container.");
  return output;
}

function record(value: unknown): RecommendationProfileStoreRecord {
  const output = normalizeRecommendationProfileStoreRecord(value, { pruneExpiredEntries: false });
  if (output === null) throw new TypeError("Invalid ActivityPods profile store record.");
  return output;
}

export function createRecommendationActivityPodsProfilePersistenceAdapter(
  input: RecommendationActivityPodsProfilePersistenceAdapterInput
): RecommendationProfilePersistenceAdapter {
  if (
    !isRecord(input) || !isRecord(input.transport) || typeof input.transport.read !== "function" ||
    typeof input.transport.write !== "function" || typeof input.transport.delete !== "function" ||
    !isRecord(input.codec) || typeof input.codec.encode !== "function" || typeof input.codec.decode !== "function" ||
    typeof input.authorize !== "function" || (input.now !== undefined && typeof input.now !== "function")
  ) throw new TypeError("Invalid ActivityPods profile persistence adapter input.");

  const subjectId = string(input.subjectId, MAX_IDENTIFIER_LENGTH, "subject ID");
  const applicationActorUri = url(input.applicationActorUri, "application actor URI");
  const ownerActorUri = url(input.ownerActorUri, "owner actor URI");
  const ownerWebId = url(input.ownerWebId, "owner WebID");
  if (ownerActorUri !== ownerWebId) throw new TypeError("ActivityPods profile owner actor must equal the owner WebID.");
  if (applicationActorUri === ownerActorUri) throw new TypeError("ActivityPods profile application actor must be distinct from the owner actor.");
  const ownerOrigin = new URL(ownerWebId).origin;
  const storageRootUri = url(input.storageRootUri, "storage root URI", true);
  const profileContainerUri = url(input.profileContainerUri, "container URI", true);
  const applicationRegistrationUri = url(input.applicationRegistrationUri, "application registration URI");
  const accessGrantUri = url(input.accessGrantUri, "access grant URI");
  const dataGrantUri = url(input.dataGrantUri, "data grant URI");
  for (const [value, label] of [
    [storageRootUri, "storage root URI"], [profileContainerUri, "container URI"],
    [applicationRegistrationUri, "application registration URI"],
    [accessGrantUri, "access grant URI"], [dataGrantUri, "data grant URI"]
  ] as const) {
    if (new URL(value).origin !== ownerOrigin) {
      throw new TypeError(`ActivityPods profile ${label} must use the owner Pod authority.`);
    }
  }
  if (!within(profileContainerUri, storageRootUri)) {
    throw new TypeError("ActivityPods profile container must be within the owner storage root.");
  }
  const shapeTreeUri = url(input.shapeTreeUri, "shape tree URI");
  const jsonLdContext = contextHeader(input.jsonLdContext);

  const authorize = async (
    operation: RecommendationActivityPodsResourceOperation,
    profileResourceUri: string,
    subjectKey: string
  ): Promise<RecommendationActivityPodsResourceGrantEvidence> => {
    const evidence = requireRecommendationActivityPodsResourceOperation(
      await input.authorize(operation, profileResourceUri, subjectKey),
      operation,
      input.now === undefined ? {} : { now: input.now() }
    );
    if (
      evidence.subjectId !== subjectId || evidence.applicationActorUri !== applicationActorUri ||
      evidence.applicationRegistrationUri !== applicationRegistrationUri ||
      evidence.accessGrantUri !== accessGrantUri || evidence.dataGrantUri !== dataGrantUri ||
      evidence.ownerActorUri !== ownerActorUri || evidence.ownerWebId !== ownerWebId ||
      evidence.storageRootUri !== storageRootUri || evidence.containerUri !== profileContainerUri ||
      evidence.resourceUri !== profileResourceUri || evidence.shapeTreeUri !== shapeTreeUri
    ) throw new TypeError("ActivityPods profile grant does not match the configured subject, application, owner, storage, resource, or access need.");
    return evidence;
  };

  const request = (
    profileResourceUri: string,
    evidence: RecommendationActivityPodsResourceGrantEvidence
  ): RecommendationActivityPodsProfileTransportRequest => ({
    resourceUri: profileResourceUri,
    applicationActorUri,
    ownerWebId,
    applicationRegistrationUri: evidence.applicationRegistrationUri,
    accessGrantUri: evidence.accessGrantUri,
    dataGrantUri: evidence.dataGrantUri,
    shapeTreeUri,
    mediaType: RECOMMENDATION_ACTIVITYPODS_PROFILE_MEDIA_TYPE,
    ...(jsonLdContext === undefined ? {} : { jsonLdContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });

  return Object.freeze({
    async readProfileRecord(subjectKey: string): Promise<unknown | null> {
      const profileResourceUri = resourceUri(profileContainerUri, subjectKey);
      const evidence = await authorize("read", profileResourceUri, subjectKey);
      const result = readResult(await input.transport.read(request(profileResourceUri, evidence)));
      if (result.status === "not_found") return null;
      const output = record(await input.codec.decode(result.document));
      if (output.subjectKey !== subjectKey) throw new TypeError("ActivityPods profile document subject key mismatch.");
      return output;
    },

    async writeProfileRecord(value: RecommendationProfileStoreRecord): Promise<RecommendationProfileStoreRecord> {
      const normalized = record(value);
      const profileResourceUri = resourceUri(profileContainerUri, normalized.subjectKey);
      const evidence = await authorize("write", profileResourceUri, normalized.subjectKey);
      const base = request(profileResourceUri, evidence);
      const current = readResult(await input.transport.read(base));
      const document = await input.codec.encode(normalized);
      if (!isRecord(document)) throw new TypeError("Invalid ActivityPods profile encoded document.");
      const result = writeResult(await input.transport.write({
        ...base,
        document,
        condition: current.status === "found"
          ? { kind: "if_match", entityTag: strongEntityTag(current.entityTag) }
          : { kind: "if_none_match", value: "*" }
      }));
      if (result.status === "precondition_failed") throw new RecommendationActivityPodsProfileConflictError();
      return normalized;
    },

    async deleteProfileRecord(subjectKey: string): Promise<void> {
      const profileResourceUri = resourceUri(profileContainerUri, subjectKey);
      const evidence = await authorize("delete", profileResourceUri, subjectKey);
      const base = request(profileResourceUri, evidence);
      const current = readResult(await input.transport.read(base));
      if (current.status === "not_found") return;
      const result = deleteResult(await input.transport.delete({
        ...base,
        condition: { kind: "if_match", entityTag: strongEntityTag(current.entityTag) }
      }));
      if (result.status === "precondition_failed") throw new RecommendationActivityPodsProfileConflictError();
    }
  });
}
