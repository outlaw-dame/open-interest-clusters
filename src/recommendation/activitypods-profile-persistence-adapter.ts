import {
  normalizeRecommendationActivityPodsResourceGrantEvidence,
  requireRecommendationActivityPodsResourceOperation,
  type RecommendationActivityPodsResourceGrantEvidenceInput,
  type RecommendationActivityPodsResourceOperation
} from "./activitypods-authorization.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import type {
  RecommendationProfilePersistenceAdapter,
  RecommendationProfileStoreRecord
} from "./profile-store-persistence.js";

export interface RecommendationActivityPodsProfileCodec {
  encode(record: RecommendationProfileStoreRecord): unknown | Promise<unknown>;
  decode(document: unknown): unknown | Promise<unknown>;
}

export interface RecommendationActivityPodsProfileTransportRequest {
  resourceUri: string;
  mediaType: "application/ld+json";
  jsonLdContext?: string;
  signal?: AbortSignal;
}

export interface RecommendationActivityPodsProfileTransportWriteRequest
  extends RecommendationActivityPodsProfileTransportRequest {
  document: unknown;
}

export type RecommendationActivityPodsProfileTransportReadResult =
  | { status: "not_found" }
  | { status: "found"; document: unknown };

export interface RecommendationActivityPodsProfileTransport {
  read(
    request: RecommendationActivityPodsProfileTransportRequest
  ):
    | RecommendationActivityPodsProfileTransportReadResult
    | Promise<RecommendationActivityPodsProfileTransportReadResult>;
  write(request: RecommendationActivityPodsProfileTransportWriteRequest): void | Promise<void>;
  delete(request: RecommendationActivityPodsProfileTransportRequest): void | Promise<void>;
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
  ownerActorUri: string;
  ownerWebId: string;
  storageRootUri: string;
  profileContainerUri: string;
  jsonLdContext?: string;
  signal?: AbortSignal;
  transport: RecommendationActivityPodsProfileTransport;
  codec: RecommendationActivityPodsProfileCodec;
  authorize: RecommendationActivityPodsProfileAuthorizer;
}

const MAX_IDENTIFIER_LENGTH = 2_048;
const MAX_SUBJECT_KEY_LENGTH = 512;
const PROFILE_EXTENSION = ".jsonld";

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

function isPathWithin(childUri: string, parentUri: string): boolean {
  const child = new URL(childUri);
  const parent = new URL(parentUri);
  return child.origin === parent.origin && child.pathname.startsWith(parent.pathname);
}

function subjectKey(value: unknown): string {
  const normalized = boundedString(value, MAX_SUBJECT_KEY_LENGTH, "subject key");
  if (normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
    throw new TypeError("Invalid ActivityPods profile subject key.");
  }
  return normalized;
}

function profileResourceUri(containerUri: string, key: string): string {
  const url = new URL(`${encodeURIComponent(key)}${PROFILE_EXTENSION}`, containerUri);
  if (!isPathWithin(url.toString(), containerUri)) {
    throw new TypeError("ActivityPods profile resource escaped its container.");
  }
  return url.toString();
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
  return Object.freeze({ status: "found", document: value.document });
}

function transportRequest(
  resourceUri: string,
  jsonLdContext: string | undefined,
  signal: AbortSignal | undefined
): RecommendationActivityPodsProfileTransportRequest {
  const request: RecommendationActivityPodsProfileTransportRequest = {
    resourceUri,
    mediaType: "application/ld+json"
  };
  if (jsonLdContext !== undefined) request.jsonLdContext = jsonLdContext;
  if (signal !== undefined) request.signal = signal;
  return request;
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
    typeof input.authorize !== "function"
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
  const storageRootUri = httpsUrl(input.storageRootUri, "storage root URI", true);
  const profileContainerUri = httpsUrl(input.profileContainerUri, "container URI", true);
  if (!isPathWithin(profileContainerUri, storageRootUri)) {
    throw new TypeError("ActivityPods profile container must be within the owner storage root.");
  }
  if (new URL(storageRootUri).origin !== new URL(ownerActorUri).origin) {
    throw new TypeError("ActivityPods profile storage must use the owner Pod authority.");
  }
  const jsonLdContext = input.jsonLdContext === undefined
    ? undefined
    : httpsUrl(input.jsonLdContext, "JSON-LD context URI");

  const requireAuthorization = async (
    operation: RecommendationActivityPodsResourceOperation,
    resourceUri: string,
    key: string
  ): Promise<void> => {
    const grant = requireRecommendationActivityPodsResourceOperation(
      normalizeRecommendationActivityPodsResourceGrantEvidence(
        await input.authorize(operation, resourceUri, key)
      ),
      operation
    );
    if (
      grant.subjectId !== configuredSubjectId ||
      grant.applicationActorUri !== applicationActorUri ||
      grant.ownerActorUri !== ownerActorUri ||
      grant.ownerWebId !== ownerWebId ||
      grant.resourceUri !== resourceUri
    ) {
      throw new TypeError("ActivityPods profile grant does not match the configured subject, application, owner, or resource.");
    }
  };

  return Object.freeze({
    async readProfileRecord(rawSubjectKey: string): Promise<unknown | null> {
      const key = subjectKey(rawSubjectKey);
      const resourceUri = profileResourceUri(profileContainerUri, key);
      await requireAuthorization("read", resourceUri, key);
      const result = normalizeReadResult(
        await input.transport.read(transportRequest(resourceUri, jsonLdContext, input.signal))
      );
      if (result.status === "not_found") return null;
      return input.codec.decode(result.document);
    },

    async writeProfileRecord(record: RecommendationProfileStoreRecord): Promise<void> {
      if (!isPlainRecord(record)) throw new TypeError("Invalid ActivityPods profile store record.");
      const key = subjectKey(record.subjectKey);
      const resourceUri = profileResourceUri(profileContainerUri, key);
      await requireAuthorization("write", resourceUri, key);
      const document = await input.codec.encode(record);
      const request: RecommendationActivityPodsProfileTransportWriteRequest = {
        ...transportRequest(resourceUri, jsonLdContext, input.signal),
        document
      };
      await input.transport.write(request);
    },

    async deleteProfileRecord(rawSubjectKey: string): Promise<void> {
      const key = subjectKey(rawSubjectKey);
      const resourceUri = profileResourceUri(profileContainerUri, key);
      await requireAuthorization("delete", resourceUri, key);
      await input.transport.delete(transportRequest(resourceUri, jsonLdContext, input.signal));
    }
  });
}
