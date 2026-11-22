import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOMMENDATION_STATE_DOMAINS,
  RECOMMENDATION_GLOBAL_CATALOG_V1,
  RecommendationProfilePersistenceError,
  assertRecommendationCandidateEventStore,
  assertRecommendationStateStorageManifest,
  bootstrapRecommendationProfileFromOnboarding,
  createInMemoryRecommendationCandidateEventStore,
  createRecommendationProfileStoreRecord,
  createRecommendationProfileSubjectKey,
  evaluateRecommendationStatePlacement,
  getRecommendationStateDomainMetadata,
  readRecommendationCandidateSourceAdapter,
  readRecommendationProfileStoreRecordSafely,
  transitionRecommendationProfilePersistence,
  writeRecommendationProfileStoreRecordSafely,
  type RecommendationCandidateSourceAdapter,
  type RecommendationCandidateSourceAdapterQuery,
  type RecommendationConsentPolicy,
  type RecommendationProcessingBoundary,
  type RecommendationProfilePersistenceAdapter,
  type RecommendationProfileSnapshot,
  type RecommendationProfileStoreRecord,
  type RecommendationStateDomain,
  type RecommendationStateStorageAdapterManifest,
  type RecommendationStorageAuthority
} from "../src/index.js";
import {
  createRecommendationLoopsStarterKitClient,
  createRecommendationMastodonCollectionClient,
  createRecommendationPixelfedStarterKitClient,
  type RecommendationCuratedAccountSetTransportRequest
} from "../src/recommendation/activitypub-curated-account-sets.js";
import { createRecommendationAtprotoQueryLabelsClient } from "../src/recommendation/atproto-query-labels-client.js";
import type { RecommendationDiscoveredLabeler } from "../src/recommendation/labeler-discovery.js";

// A signal's privacyBoundary and a store manifest's processingBoundary use the same words and have to
// agree. `local_only` means the interests are processed on the user's device, and the store is device
// owned. `server_allowed` means a server processes them, and the only server that may hold subject-level
// interests is one the user owns, such as a pod. These tests pin down that pairing, that provider and
// operator stores never hold subject-level state, and that remote requests carry no profile content.

const SUBJECT = "user-123";
const NOW = new Date().toISOString();
const BOUNDARIES: readonly RecommendationProcessingBoundary[] = ["local_only", "server_allowed", "aggregate_only"];
const SUBJECT_LEVEL_DOMAINS = RECOMMENDATION_STATE_DOMAINS.filter((domain) => getRecommendationStateDomainMetadata(domain).subjectLevel);

const LOCAL: RecommendationStateStorageAdapterManifest = { adapterId: "local", domains: ["interest_profile"], authority: "device_owned", processingBoundary: "local_only", persistence: "persistent", requiresNetwork: false, supportsOffline: true, userExportable: true, userDeletable: true, encryptedAtRest: false };
const POD: RecommendationStateStorageAdapterManifest = { ...LOCAL, adapterId: "pod", authority: "user_owned", processingBoundary: "server_allowed", requiresNetwork: true, supportsOffline: false };
const POLICY: RecommendationConsentPolicy = { subjectId: SUBJECT, allowedDataUses: ["local_personalization"], privateDataUses: ["local_personalization"], serverSideDataUses: ["local_personalization"] };

function manifest(domains: readonly RecommendationStateDomain[], authority: RecommendationStorageAuthority, processingBoundary: RecommendationProcessingBoundary): RecommendationStateStorageAdapterManifest {
  const onDevice = authority === "device_owned";
  return { ...POD, adapterId: `${authority}-${processingBoundary}`, domains, authority, processingBoundary, requiresNetwork: !onDevice, supportsOffline: onDevice };
}

function snapshot(): RecommendationProfileSnapshot {
  const entry = { target: { kind: "canonical_interest" as const, key: "books.fiction" }, score: 0.75, confidence: 0.8, signalCount: 1, positiveSignalCount: 1, negativeSignalCount: 0, neutralSignalCount: 0, privacyBoundaries: ["local_only" as const], protocols: ["app_local" as const], sourceVisibilities: ["local_only" as const], updatedAt: "2026-10-01T00:00:00.000Z" };
  return { schemaVersion: "recommendation-profile.v1", updatedAt: "2026-10-01T00:00:00.000Z", signalCount: 1, entries: [entry] };
}

class MemoryAdapter implements RecommendationProfilePersistenceAdapter {
  readonly records = new Map<string, unknown>();
  calls = 0;
  constructor(readonly storageManifest: RecommendationStateStorageAdapterManifest) {}
  async readProfileRecord(subjectKey: string): Promise<unknown | null> { this.calls += 1; return this.records.get(subjectKey) ?? null; }
  async writeProfileRecord(value: RecommendationProfileStoreRecord): Promise<void> { this.calls += 1; this.records.set(value.subjectKey, value); }
  async deleteProfileRecord(subjectKey: string): Promise<void> { this.calls += 1; this.records.delete(subjectKey); }
}

test("no subject-level state domain is ever placeable with a provider or shared operator, whatever boundary is claimed", () => {
  assert.ok(SUBJECT_LEVEL_DOMAINS.length >= 10);
  for (const domain of SUBJECT_LEVEL_DOMAINS) {
    for (const authority of ["provider_owned", "shared_operator"] as const) {
      for (const boundary of BOUNDARIES) {
        const candidate = manifest([domain], authority, boundary);
        assert.equal(evaluateRecommendationStatePlacement(candidate, domain).decision, "deny", `${domain} ${authority} ${boundary}`);
        assert.throws(() => assertRecommendationStateStorageManifest(candidate), TypeError);
      }
    }
  }
});

test("the manifest boundary has to match who runs the store: a device cannot claim server_allowed and a pod cannot claim local_only", () => {
  for (const domain of SUBJECT_LEVEL_DOMAINS) {
    assert.equal(evaluateRecommendationStatePlacement(manifest([domain], "device_owned", "server_allowed"), domain).decision, "deny");
    assert.equal(evaluateRecommendationStatePlacement(manifest([domain], "user_owned", "local_only"), domain).decision, "deny");
    assert.equal(evaluateRecommendationStatePlacement(manifest([domain], "user_owned", "aggregate_only"), domain).decision, "deny");
    assert.equal(evaluateRecommendationStatePlacement(manifest([domain], "device_owned", "aggregate_only"), domain).decision, "deny");
    assert.equal(evaluateRecommendationStatePlacement(manifest([domain], "device_owned", "local_only"), domain).decision, "allow");
    assert.equal(evaluateRecommendationStatePlacement(manifest([domain], "user_owned", "server_allowed"), domain).decision, "allow");
  }
});

test("the only authorities the library can express are the four known ones, so a PDS has to be declared as one of them and an unknown authority fails closed", () => {
  for (const authority of ["pds", "atproto_pds", "user_pds", "atproto_repo", ""]) {
    const claim = { ...POD, authority } as unknown as RecommendationStateStorageAdapterManifest;
    assert.throws(() => assertRecommendationStateStorageManifest(claim), TypeError, authority);
    assert.throws(() => evaluateRecommendationStatePlacement(claim, "interest_profile"), TypeError, authority);
  }
});

test("profile persistence refuses provider-owned and shared-operator adapters for every target and every operation", async () => {
  for (const authority of ["provider_owned", "shared_operator"] as const) {
    for (const boundary of BOUNDARIES) {
      for (const storageTarget of ["local_app", "user_pod", "server_profile", "provider_hosted", "ephemeral_session"] as const) {
        const adapter = new MemoryAdapter(manifest(["interest_profile"], authority, boundary));
        const label = `${authority} ${boundary} ${storageTarget}`;
        await assert.rejects(writeRecommendationProfileStoreRecordSafely(adapter, { subjectId: SUBJECT, profile: snapshot(), writtenAt: NOW, storageTarget, policy: POLICY }), TypeError, label);
        await assert.rejects(readRecommendationProfileStoreRecordSafely(adapter, { subjectId: SUBJECT, storageTarget }), TypeError, label);
        assert.equal(adapter.calls, 0, label);
        assert.equal(adapter.records.size, 0, label);
      }
    }
  }
});

test("even a user-owned adapter cannot be used for the server_profile or provider_hosted targets", async () => {
  for (const storageTarget of ["server_profile", "provider_hosted"] as const) {
    const adapter = new MemoryAdapter(POD);
    await assert.rejects(
      writeRecommendationProfileStoreRecordSafely(adapter, { subjectId: SUBJECT, profile: snapshot(), writtenAt: NOW, storageTarget, policy: POLICY }),
      (error: unknown) => error instanceof RecommendationProfilePersistenceError && error.reason === "persistence.deny.storage_placement_policy"
    );
    assert.equal(adapter.calls, 0);
  }
});

test("onboarding bootstrap never reaches a provider-owned adapter, and writes nothing when the target is a server or provider", async () => {
  for (const authority of ["provider_owned", "shared_operator"] as const) {
    for (const storageTarget of ["user_pod", "server_profile", "provider_hosted"] as const) {
      const adapter = new MemoryAdapter(manifest(["interest_profile"], authority, "server_allowed"));
      await assert.rejects(bootstrapRecommendationProfileFromOnboarding({
        subjectId: SUBJECT, storageTarget, catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selectedTopicIds: ["gaming"],
        selectedAt: "2026-05-22T00:00:00.000Z", policy: POLICY, persistence: { adapter }
      }), /placement policy|placement_policy|not.*allowed|deny/iu, `${authority} ${storageTarget}`);
      assert.equal(adapter.records.size, 0, `${authority} ${storageTarget}`);
      assert.equal(adapter.calls, 0, `${authority} ${storageTarget}`);
    }
  }
});

test("the candidate event store refuses provider-owned and shared-operator placements for every boundary", () => {
  for (const authority of ["provider_owned", "shared_operator"] as const) {
    for (const boundary of BOUNDARIES) {
      const store = createInMemoryRecommendationCandidateEventStore(manifest(["candidate_lifecycle_events"], authority, boundary));
      assert.throws(() => assertRecommendationCandidateEventStore(store), TypeError, `${authority} ${boundary}`);
    }
  }
  assert.doesNotThrow(() => assertRecommendationCandidateEventStore(createInMemoryRecommendationCandidateEventStore(manifest(["candidate_lifecycle_events"], "user_owned", "server_allowed"))));
});

test("the profile move refuses a provider-owned destination or source, including for the event stores, before touching anything", async () => {
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  const record = createRecommendationProfileStoreRecord({ subjectId: SUBJECT, profile: snapshot(), writtenAt: "2026-10-01T00:00:01.000Z" });
  for (const authority of ["provider_owned", "shared_operator"] as const) {
    const bad = manifest(["interest_profile"], authority, "server_allowed");
    const badEvents = manifest(["candidate_lifecycle_events"], authority, "server_allowed");
    const goodEvents = (m: RecommendationStateStorageAdapterManifest) => createInMemoryRecommendationCandidateEventStore({ ...m, domains: ["candidate_lifecycle_events"] });
    const cases = [
      { from: { adapter: new MemoryAdapter(LOCAL), storageTarget: "local_app" }, to: { adapter: new MemoryAdapter(bad), storageTarget: "user_pod" } },
      { from: { adapter: new MemoryAdapter(bad), storageTarget: "user_pod" }, to: { adapter: new MemoryAdapter(LOCAL), storageTarget: "local_app" } },
      { from: { adapter: new MemoryAdapter(LOCAL), storageTarget: "local_app", candidateEventStore: goodEvents(LOCAL) }, to: { adapter: new MemoryAdapter(POD), storageTarget: "user_pod", candidateEventStore: createInMemoryRecommendationCandidateEventStore(badEvents) } },
      { from: { adapter: new MemoryAdapter(LOCAL), storageTarget: "local_app", candidateEventStore: createInMemoryRecommendationCandidateEventStore(badEvents) }, to: { adapter: new MemoryAdapter(POD), storageTarget: "user_pod", candidateEventStore: goodEvents(POD) } }
    ] as const;
    for (const [index, move] of cases.entries()) {
      (move.from.adapter as MemoryAdapter).records.set(key, record);
      await assert.rejects(
        transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: move.from as never, to: move.to as never, policy: POLICY, now: NOW, retry: { sleep: async () => undefined } }),
        /placement policy|placement_policy/u,
        `${authority} case ${index}`
      );
      assert.equal((move.to.adapter as MemoryAdapter).records.size, 0, `${authority} case ${index}`);
      assert.equal((move.from.adapter as MemoryAdapter).records.has(key), true, `${authority} case ${index}`);
    }
  }
});

test("signals are relabelled server_allowed for the pod and local_only for the device, and the content is untouched", async () => {
  const local = new MemoryAdapter(LOCAL);
  const pod = new MemoryAdapter(POD);
  const key = createRecommendationProfileSubjectKey({ subjectId: SUBJECT });
  // Start from a profile the onboarding path built, not a hand-made one.
  const boot = await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT, catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selectedTopicIds: ["gaming", "apple"],
    selectedAt: "2026-05-22T00:00:00.000Z", policy: POLICY, persistence: { adapter: local }
  });
  assert.equal(boot.persisted, true);
  const boundariesOf = (record: unknown) => (record as RecommendationProfileStoreRecord).profile.entries.flatMap((entry) => entry.privacyBoundaries);
  const withoutLabels = (record: unknown) => (record as RecommendationProfileStoreRecord).profile.entries.map(({ privacyBoundaries: _labels, ...rest }) => rest);
  const original = local.records.get(key) as RecommendationProfileStoreRecord;
  assert.ok(original.profile.entries.length > 0);
  assert.ok(boundariesOf(original).every((boundary) => boundary === "local_only"));

  const retry = { sleep: async () => undefined };
  const up = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: { adapter: local, storageTarget: "local_app" }, to: { adapter: pod, storageTarget: "user_pod" }, policy: POLICY, now: NOW, retry });
  assert.equal(up.outcome, "moved");
  const inPod = pod.records.get(key) as RecommendationProfileStoreRecord;
  assert.ok(boundariesOf(inPod).every((boundary) => boundary === "server_allowed"), "every entry carries the pod's label");
  assert.deepEqual(withoutLabels(inPod), withoutLabels(original));

  const down = await transitionRecommendationProfilePersistence({ subjectId: SUBJECT, from: { adapter: pod, storageTarget: "user_pod" }, to: { adapter: local, storageTarget: "local_app" }, policy: null, now: NOW, retry });
  assert.equal(down.outcome, "moved");
  const back = local.records.get(key) as RecommendationProfileStoreRecord;
  assert.ok(boundariesOf(back).every((boundary) => boundary === "local_only"));
  assert.deepEqual(back.profile, original.profile);
  assert.equal(pod.records.size, 0);
});

test("onboarding straight to a user pod labels the signals server_allowed", async () => {
  const pod = new MemoryAdapter(POD);
  await bootstrapRecommendationProfileFromOnboarding({
    subjectId: SUBJECT, storageTarget: "user_pod", catalog: RECOMMENDATION_GLOBAL_CATALOG_V1, selectedTopicIds: ["gaming"],
    selectedAt: "2026-05-22T00:00:00.000Z", policy: POLICY, persistence: { adapter: pod }
  });
  const stored = [...pod.records.values()] as RecommendationProfileStoreRecord[];
  assert.equal(stored.length, 1);
  assert.ok(stored[0]!.profile.entries.length > 0);
  assert.ok(stored[0]!.profile.entries.every((entry) => entry.privacyBoundaries.every((boundary) => boundary === "server_allowed")));
});

// What a remote server is asked. Sentinels stand in for profile and signal content; none may appear.
const INTEREST = "sentinel-interest-gaming-4f2a";
const LANGUAGE = "sentinel-lang-xx";
const REQUEST_ID = "sentinel-request-subject-9c1d";
const SUBJECT_SENTINEL = "sentinel-subject-77be";

test("a remote candidate source never sees interests, languages or the raw request ID", async () => {
  const seen: RecommendationCandidateSourceAdapterQuery[] = [];
  const remote: RecommendationCandidateSourceAdapter = {
    id: "remote.discovery", protocols: ["atproto"], candidateKinds: ["feed"], authority: "untrusted_hint", transport: "remote",
    privacy: { sourceVisibility: "atproto_public_repo", accessBasis: "atproto_public_repo", containsPrivateData: false, containsThirdPartyData: true, serverSideProcessing: true, providerPolicyAllowsProcessing: true },
    capabilities: ["discover", "returns_public_metadata", "returns_untrusted_hints", "supports_pagination"],
    evaluateProviderPolicy: (query) => { seen.push(query); return true; },
    read: (query) => { seen.push(query); return { candidates: [] }; }
  };
  await readRecommendationCandidateSourceAdapter(remote, { requestId: REQUEST_ID, candidateKinds: ["feed"], canonicalInterestIds: [INTEREST], languages: [LANGUAGE], limit: 10 });
  assert.ok(seen.length >= 1);
  for (const query of seen) {
    const serialized = JSON.stringify(query);
    for (const token of [INTEREST, LANGUAGE, REQUEST_ID]) assert.equal(serialized.includes(token), false, token);
    assert.deepEqual(Object.keys(query).sort(), ["candidateKinds", "limit", "requestId"]);
  }
});

test("the curated account-set clients send only a fixed URL, with no subject, interest or profile content", async () => {
  const authorization = { status: "authorized" as const, subjectId: SUBJECT_SENTINEL, checkedAt: "2026-08-02T13:00:00Z", sourceVisibility: "public" as const, accessBasis: "public_web" as const };
  const requests: RecommendationCuratedAccountSetTransportRequest[] = [];
  const transport = { async get(request: RecommendationCuratedAccountSetTransportRequest) { requests.push(request); return { body: {}, observedAt: "2026-08-02T13:00:00Z" }; } };
  const clients = [
    createRecommendationMastodonCollectionClient({ baseUrl: "https://social.example", collectionId: "123", transport }),
    createRecommendationLoopsStarterKitClient({ baseUrl: "https://loops.example", starterKitId: "kit-1", transport }),
    createRecommendationPixelfedStarterKitClient({ documentUrl: "https://pixel.example/starter-kits/1.json", transport })
  ];
  for (const client of clients) {
    // The parse of the empty body may fail. What was sent is what matters.
    await client.read({ subjectId: SUBJECT_SENTINEL, authorization }).catch(() => undefined);
  }
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.deepEqual(Object.keys(request).sort(), ["requiresAuthentication", "url"]);
    assert.equal(JSON.stringify(request).includes(SUBJECT_SENTINEL), false);
    assert.equal(new URL(request.url).search, "");
  }
});

test("the ATProto label query puts only the caller's URI patterns, sources, limit and cursor in the URL, never the subject", async () => {
  const did = "did:plc:querylabelsservice";
  const labeler: RecommendationDiscoveredLabeler = { discoveryKey: "k", labelerDid: did, serviceEndpoint: "https://labels.example.com", source: "user_provided", discoveredAt: "2026-08-01T20:00:00Z", verification: "did_document", declaredLabelValues: [], declaredSubjectTypes: [], declaredSubjectCollections: [], requiresExplicitSubscription: true };
  const urls: string[] = [];
  const client = createRecommendationAtprotoQueryLabelsClient({ async request(input) { urls.push(input.url); return { status: 200, body: { labels: [] } }; } });
  await client.queryPage({ subjectId: SUBJECT_SENTINEL, labeler, subscription: { subjectId: SUBJECT_SENTINEL, labelerDid: did, source: "atproto", subscribedAt: "2026-08-01T20:01:00Z" }, uriPatterns: ["at://did:plc:author/*"], limit: 5 });
  assert.equal(urls.length, 1);
  assert.equal(urls[0]!.includes(SUBJECT_SENTINEL), false);
  const url = new URL(urls[0]!);
  assert.deepEqual([...new Set([...url.searchParams.keys()])].sort(), ["limit", "uriPatterns"]);
});
