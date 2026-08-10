import assert from "node:assert/strict";
import test from "node:test";

import {
  RecommendationProviderProbeError,
  discoverRecommendationProviderCapabilities,
  normalizeRecommendationProviderDiscoveryObservation,
  recommendationProviderCapabilityState,
  type RecommendationProviderDescriptor,
  type RecommendationProviderDiscoveryCache,
  type RecommendationProviderDiscoveryObservation,
  type RecommendationProviderDiscoveryProbe
} from "../src/recommendation/provider-discovery.js";

const NOW = "2026-08-10T12:00:00.000Z";
const EXPIRY = "2026-08-10T13:00:00.000Z";

function observation(
  overrides: Partial<RecommendationProviderDiscoveryObservation> = {}
): RecommendationProviderDiscoveryObservation {
  return {
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    protocolBindings: [{
      protocol: "activitypub",
      endpoint: "https://provider.example/users/alice",
      authority: "protocol_native",
      verification: "verified"
    }],
    applicationProfiles: ["generic_activitypub"],
    capabilities: [{
      capability: "profile",
      state: "supported",
      authority: "protocol_native",
      protocol: "activitypub"
    }],
    observedAt: NOW,
    expiresAt: EXPIRY,
    ...overrides
  };
}

function probe(
  id: string,
  value: RecommendationProviderDiscoveryObservation | (() => RecommendationProviderDiscoveryObservation | Promise<RecommendationProviderDiscoveryObservation>)
): RecommendationProviderDiscoveryProbe {
  return {
    id,
    probe: typeof value === "function" ? value : () => value
  };
}

test("normalizes a closed bounded provider observation", () => {
  const normalized = normalizeRecommendationProviderDiscoveryObservation(observation());
  assert.equal(normalized.providerId, "provider.example");
  assert.equal(normalized.protocolBindings[0]?.protocol, "activitypub");
  assert.ok(Object.isFrozen(normalized));
  assert.throws(
    () => normalizeRecommendationProviderDiscoveryObservation({ ...observation(), subjectId: "alice" }),
    /invalid recommendation provider discovery observation/iu
  );
  assert.throws(
    () => normalizeRecommendationProviderDiscoveryObservation({
      ...observation(),
      protocolBindings: [{
        protocol: "unknown",
        authority: "provider_probe",
        verification: "asserted"
      }]
    }),
    /unknown protocol binding/iu
  );
});

test("keeps ActivityPub and ATProto bindings additive for a dual-protocol provider", async () => {
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    now: () => new Date(NOW),
    probes: [
      probe("activitypub", observation()),
      probe("atproto", observation({
        protocolBindings: [{
          protocol: "atproto",
          endpoint: "https://pds.provider.example",
          authority: "protocol_native",
          verification: "verified"
        }],
        applicationProfiles: ["generic_atproto", "bluesky_compatible"],
        capabilities: [{
          capability: "feeds",
          state: "supported",
          authority: "protocol_native",
          protocol: "atproto"
        }]
      }))
    ]
  });
  assert.deepEqual(descriptor.protocolBindings.map((entry) => entry.protocol), ["activitypub", "atproto"]);
  assert.deepEqual(descriptor.applicationProfiles, ["bluesky_compatible", "generic_activitypub", "generic_atproto"]);
  assert.equal(recommendationProviderCapabilityState(descriptor, "profile", "activitypub"), "supported");
  assert.equal(recommendationProviderCapabilityState(descriptor, "feeds", "atproto"), "supported");
});

test("ActivityPods can be ActivityPub plus user-owned storage without ATProto", async () => {
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "pod.example",
    applicationId: "https://app.example/actor",
    now: () => new Date(NOW),
    probes: [probe("activitypods", observation({
      providerId: "pod.example",
      applicationId: "https://app.example/actor",
      protocolBindings: [{
        protocol: "activitypods",
        endpoint: "https://pod.example",
        authority: "authenticated_registration",
        verification: "verified"
      }, {
        protocol: "activitypub",
        endpoint: "https://app.example/actor",
        authority: "protocol_native",
        verification: "verified"
      }],
      applicationProfiles: ["activitypods", "generic_activitypub"],
      capabilities: [{
        capability: "user_owned_storage",
        state: "supported",
        authority: "authenticated_registration",
        protocol: "activitypods"
      }, {
        capability: "acl_authorization",
        state: "supported",
        authority: "authenticated_registration",
        protocol: "activitypods"
      }]
    }))]
  });
  assert.deepEqual(descriptor.protocolBindings.map((entry) => entry.protocol), ["activitypods", "activitypub"]);
  assert.equal(descriptor.protocolBindings.some((entry) => entry.protocol === "atproto"), false);
  assert.equal(recommendationProviderCapabilityState(descriptor, "user_owned_storage", "activitypods"), "supported");
});

test("higher-authority capability evidence wins and same-authority conflicts fail closed to unknown", async () => {
  const higher = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    now: () => new Date(NOW),
    probes: [
      probe("weak", observation({
        capabilities: [{ capability: "feeds", state: "supported", authority: "provider_probe", protocol: "activitypub" }]
      })),
      probe("strong", observation({
        capabilities: [{ capability: "feeds", state: "unsupported", authority: "protocol_native", protocol: "activitypub" }]
      }))
    ]
  });
  assert.equal(recommendationProviderCapabilityState(higher, "feeds", "activitypub"), "unsupported");

  const conflict = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    now: () => new Date(NOW),
    probes: [
      probe("one", observation({
        capabilities: [{ capability: "labels", state: "supported", authority: "protocol_native", protocol: "activitypub" }]
      })),
      probe("two", observation({
        capabilities: [{ capability: "labels", state: "unsupported", authority: "protocol_native", protocol: "activitypub" }]
      }))
    ]
  });
  assert.equal(recommendationProviderCapabilityState(conflict, "labels", "activitypub"), "unknown");
});

test("conflicting strong application identities fail closed", async () => {
  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example",
      now: () => new Date(NOW),
      probes: [
        probe("one", observation({ applicationId: "https://app-one.example/client.json" })),
        probe("two", observation({ applicationId: "https://app-two.example/client.json" }))
      ]
    }),
    /conflicting recommendation provider application identity evidence/iu
  );
});

test("provider identity mismatch is never merged", async () => {
  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example",
      now: () => new Date(NOW),
      probes: [probe("wrong-provider", observation({ providerId: "evil.example" }))]
    }),
    /mismatched provider identity/iu
  );
});

test("non-retryable failures are isolated while a valid independent probe can succeed", async () => {
  let failedCalls = 0;
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    now: () => new Date(NOW),
    probes: [{
      id: "bad",
      probe: () => {
        failedCalls += 1;
        throw new RecommendationProviderProbeError("auth_denied", false);
      }
    }, probe("good", observation())]
  });
  assert.equal(failedCalls, 1);
  assert.equal(descriptor.providerId, "provider.example");
});

test("retryable failures use bounded exponential backoff and stop after success", async () => {
  let calls = 0;
  const delays: number[] = [];
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    now: () => new Date(NOW),
    retry: { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 25 },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    probes: [probe("flaky", () => {
      calls += 1;
      if (calls < 3) throw new RecommendationProviderProbeError("transient_upstream", true);
      return observation();
    })]
  });
  assert.equal(descriptor.providerId, "provider.example");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("arbitrary thrown errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example",
      now: () => new Date(NOW),
      retry: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0 },
      probes: [{ id: "invalid", probe: () => { calls += 1; throw new Error("secret upstream body"); } }]
    }),
    /no current trusted observations/iu
  );
  assert.equal(calls, 1);
});

test("stale and malformed cache entries are deleted and self-healed from probes", async () => {
  const deletes: string[] = [];
  let writes = 0;
  const stale: RecommendationProviderDescriptor = {
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    detectedAt: "2026-08-10T10:00:00.000Z",
    expiresAt: "2026-08-10T11:00:00.000Z",
    protocolBindings: [],
    applicationProfiles: [],
    capabilities: []
  };
  const cache: RecommendationProviderDiscoveryCache = {
    read: () => stale,
    delete: (key) => { deletes.push(key); },
    write: () => { writes += 1; }
  };
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    now: () => new Date(NOW),
    cache,
    probes: [probe("fresh", observation())]
  });
  assert.equal(descriptor.expiresAt, EXPIRY);
  assert.equal(deletes.length, 1);
  assert.equal(writes, 1);
});

test("fresh cache avoids probes and remains scoped to provider plus application identity", async () => {
  let calls = 0;
  const cached: RecommendationProviderDescriptor = {
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    detectedAt: NOW,
    expiresAt: EXPIRY,
    protocolBindings: observation().protocolBindings,
    applicationProfiles: observation().applicationProfiles,
    capabilities: observation().capabilities
  };
  const cache: RecommendationProviderDiscoveryCache = {
    read: () => cached,
    write: () => { throw new Error("must not write"); }
  };
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://app.example/client-metadata.json",
    now: () => new Date(NOW),
    cache,
    probes: [probe("unused", () => { calls += 1; return observation(); })]
  });
  assert.equal(calls, 0);
  assert.equal(descriptor.providerId, "provider.example");
});

test("expired probe observations cannot resurrect stale capabilities", async () => {
  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example",
      now: () => new Date(NOW),
      probes: [probe("expired", observation({
        observedAt: "2026-08-10T10:00:00.000Z",
        expiresAt: "2026-08-10T11:00:00.000Z"
      }))]
    }),
    /no current trusted observations/iu
  );
});

test("aborted discovery stops before probe execution", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  let calls = 0;
  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example",
      signal: controller.signal,
      probes: [probe("unused", () => { calls += 1; return observation(); })]
    }),
    /cancelled/iu
  );
  assert.equal(calls, 0);
});

test("unknown capability is the safe default when no evidence exists", async () => {
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    now: () => new Date(NOW),
    probes: [probe("basic", observation())]
  });
  assert.equal(recommendationProviderCapabilityState(descriptor, "user_owned_storage"), "unknown");
});

test("bounded inputs reject duplicate probes and unsafe identifiers", async () => {
  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example",
      probes: [probe("same", observation()), probe("same", observation())]
    }),
    /duplicate recommendation provider discovery probe id/iu
  );
  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example\nattacker",
      probes: [probe("safe", observation())]
    }),
    /invalid recommendation provider id/iu
  );
});
