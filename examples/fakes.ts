// Stand-ins for the things an application owns: a clock, a provider that can follow accounts, a
// candidate source, and a place to keep the profile. Nothing here touches the network or the disk.
// Every fake provider keeps a copy of every request it receives so a test can look at what left the app.
import {
  createRecommendationCandidateId,
  type RecommendationCandidate,
  type RecommendationCandidateSourceAdapter,
  type RecommendationAccountProfileResolver,
  type RecommendationCandidateSourceAdapterQuery,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileStoreRecord,
  type RecommendationProviderDescriptor,
  type RecommendationStateStorageAdapterManifest
} from "../src/index.js";

export const REFERENCE_SUBJECT_ID = "reference-user";
export const REFERENCE_PROVIDER_ID = "social.example";

/** A clock the test moves by hand. Timestamps are RFC 3339 strings, which is what the engine takes. */
export interface ReferenceClock {
  now(): string;
  advance(milliseconds: number): string;
}

export function createReferenceClock(start: string): ReferenceClock {
  let current = Date.parse(start);
  if (!Number.isFinite(current)) throw new TypeError("Invalid reference clock start.");
  return {
    now: () => new Date(current).toISOString(),
    advance(milliseconds) {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new RangeError("The clock only moves forward.");
      current += milliseconds;
      return new Date(current).toISOString();
    }
  };
}

/** What the app sends a provider when the user confirms a plan. Identifiers only, never profile data. */
export interface ReferenceProviderMutation {
  action: string;
  providerId: string;
  candidateIds: readonly string[];
  targets: readonly string[];
}

export interface ReferenceProviderService {
  /** Deep copies of every request received, in order. */
  readonly requests: readonly unknown[];
  /** Number of mutations the provider actually accepted. */
  readonly mutationCount: number;
  failNextMutations: number;
  mutate(request: ReferenceProviderMutation): Promise<{ applied: readonly string[] }>;
}

export function createFakeProviderService(): ReferenceProviderService {
  const requests: unknown[] = [];
  let mutationCount = 0;
  const service: ReferenceProviderService = {
    requests,
    get mutationCount() { return mutationCount; },
    failNextMutations: 0,
    async mutate(request) {
      requests.push(structuredClone(request));
      if (service.failNextMutations > 0) {
        service.failNextMutations -= 1;
        throw new Error("fake provider is unavailable");
      }
      mutationCount += 1;
      return { applied: [...request.targets] };
    }
  };
  return service;
}

/** Capabilities the fake provider claims, as discovery would have resolved them. */
export function createFakeProviderDescriptor(detectedAt: string, expiresAt: string, providerId: string = REFERENCE_PROVIDER_ID): RecommendationProviderDescriptor {
  const supported = (capability: "follows" | "starter_packs") => ({ capability, state: "supported" as const, authority: "protocol_native" as const, protocol: "activitypub" as const });
  return {
    providerId,
    detectedAt,
    expiresAt,
    protocolBindings: [{ protocol: "activitypub", authority: "protocol_native", verification: "verified" }],
    applicationProfiles: [],
    capabilities: [supported("follows"), supported("starter_packs")]
  };
}

export interface ReferenceCandidateSource extends RecommendationCandidateSourceAdapter {
  /** Deep copies of every query the source received. */
  readonly queries: readonly unknown[];
  failNextReads: number;
}

/**
 * A remote candidate source that returns fixed candidates. It is declared `remote`, so the engine hands
 * it a redacted query, and the copy it keeps shows exactly what a real remote source would see.
 */
export function createFakeCandidateSource(id: string, candidates: readonly RecommendationCandidate[]): ReferenceCandidateSource {
  const queries: unknown[] = [];
  const source: ReferenceCandidateSource = {
    id,
    protocols: ["activitypub"],
    candidateKinds: ["account", "starter_pack"],
    authority: "provider_native",
    transport: "remote",
    privacy: { sourceVisibility: "public", accessBasis: "public_web", containsPrivateData: false, containsThirdPartyData: false, serverSideProcessing: true, providerPolicyAllowsProcessing: true },
    capabilities: ["discover", "returns_public_metadata", "returns_authority_verified_identity"],
    queries,
    failNextReads: 0,
    read(query: RecommendationCandidateSourceAdapterQuery) {
      const { signal: _signal, ...visible } = query;
      queries.push(structuredClone(visible));
      if (source.failNextReads > 0) {
        source.failNextReads -= 1;
        throw new Error("fake source is unavailable");
      }
      return { candidates };
    }
  };
  return source;
}

/**
 * An account candidate. By default the provider vouches for its own account (`authority_verified`).
 * Pass `verified: false` for one a third party only hinted at, which the engine will not recommend.
 */
export function createFakeAccountCandidate(name: string, observedAt: string, interests: readonly string[], options: { verified?: boolean } = {}): RecommendationCandidate {
  const verified = options.verified ?? true;
  const nativeId = `https://${REFERENCE_PROVIDER_ID}/users/${name}`;
  return {
    candidateId: createRecommendationCandidateId({ kind: "account", protocol: "activitypub", nativeId, provider: REFERENCE_PROVIDER_ID }),
    kind: "account",
    protocol: "activitypub",
    nativeId,
    provider: REFERENCE_PROVIDER_ID,
    verification: verified ? { state: "authority_verified", authority: REFERENCE_PROVIDER_ID, verifiedAt: observedAt } : { state: "source_asserted" },
    availability: "available",
    observedAt,
    metadata: { displayName: name, canonicalInterestIds: [...interests], tags: [], entityIds: [], languages: ["en"] },
    provenance: [{ kind: verified ? "onboarding_interest_match" : "third_party_directory_hint", sourceId: "fake.directory", observedAt, trustBoundary: verified ? "same_provider" : "third_party" }]
  };
}

/** A resolver that knows a fixed set of accounts, and keeps a copy of every reference it is asked about. */
export interface ReferenceAccountResolver extends RecommendationAccountProfileResolver {
  readonly requests: readonly string[];
  /** Accounts that have gone away since they were suggested. */
  readonly gone: Set<string>;
}

/** Every account it knows was active at the clock's current time, so none of them counts as inactive. */
export function createFakeAccountResolver(clock: ReferenceClock): ReferenceAccountResolver {
  const requests: string[] = [];
  const gone = new Set<string>();
  return {
    requests,
    gone,
    resolve(reference) {
      requests.push(reference);
      if (gone.has(reference)) return undefined;
      const name = reference.slice(reference.lastIndexOf("/") + 1);
      return { id: `acct-${name}`, uri: reference, lastActivityAt: clock.now() };
    }
  };
}

export const DEVICE_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  adapterId: "reference-device",
  domains: ["interest_profile", "candidate_lifecycle_events"] as const,
  authority: "device_owned",
  processingBoundary: "local_only",
  persistence: "persistent",
  requiresNetwork: false,
  supportsOffline: true,
  userExportable: true,
  userDeletable: true,
  encryptedAtRest: false
});

export const POD_MANIFEST: RecommendationStateStorageAdapterManifest = Object.freeze({
  ...DEVICE_MANIFEST,
  adapterId: "reference-pod",
  authority: "user_owned",
  processingBoundary: "server_allowed",
  requiresNetwork: true,
  supportsOffline: false
});

export interface ReferenceProfileAdapter extends RecommendationProfilePersistenceAdapter {
  readonly records: ReadonlyMap<string, RecommendationProfileStoreRecord>;
  /** Names of the calls received, in order, such as `write` or `delete`. */
  readonly log: readonly string[];
  failWrites: number;
  failDeletes: number;
}

/** An in-memory profile store. Stands in for IndexedDB or SQLite on a device and for a pod over HTTP. */
export function createInMemoryProfileAdapter(storageManifest: RecommendationStateStorageAdapterManifest): ReferenceProfileAdapter {
  const records = new Map<string, RecommendationProfileStoreRecord>();
  const log: string[] = [];
  const adapter: ReferenceProfileAdapter = {
    storageManifest,
    records,
    log,
    failWrites: 0,
    failDeletes: 0,
    async readProfileRecord(subjectKey) {
      log.push("read");
      const held = records.get(subjectKey);
      return held === undefined ? null : structuredClone(held);
    },
    async writeProfileRecord(record) {
      log.push("write");
      if (adapter.failWrites > 0) { adapter.failWrites -= 1; throw new Error("fake store write failed"); }
      records.set(record.subjectKey, structuredClone(record));
    },
    async deleteProfileRecord(subjectKey) {
      log.push("delete");
      if (adapter.failDeletes > 0) { adapter.failDeletes -= 1; throw new Error("fake store delete failed"); }
      records.delete(subjectKey);
    }
  };
  return adapter;
}
