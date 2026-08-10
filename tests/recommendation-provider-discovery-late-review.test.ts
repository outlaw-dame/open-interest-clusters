import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverRecommendationProviderCapabilities,
  type RecommendationProviderDescriptor,
  type RecommendationProviderDiscoveryCache,
  type RecommendationProviderDiscoveryObservation
} from "../src/recommendation/provider-discovery.js";

const NOW = "2026-08-10T12:00:00.000Z";
const EXPIRY = "2026-08-10T13:00:00.000Z";

function providerOnlyObservation(
  overrides: Partial<RecommendationProviderDiscoveryObservation> = {}
): RecommendationProviderDiscoveryObservation {
  return {
    providerId: "provider.example",
    protocolBindings: [{
      protocol: "activitypub",
      endpoint: "https://provider.example/users/alice",
      authority: "protocol_native",
      verification: "verified"
    }],
    applicationProfiles: [],
    capabilities: [{
      capability: "posts",
      state: "supported",
      authority: "protocol_native",
      protocol: "activitypub"
    }],
    observedAt: NOW,
    expiresAt: EXPIRY,
    ...overrides
  };
}

test("protocol-native bindings cannot promote weak application branding", async () => {
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    now: () => new Date(NOW),
    probes: [{
      id: "mixed-authority",
      probe: () => providerOnlyObservation({
        applicationId: "https://weak-brand.example/client.json",
        applicationAuthority: "provider_probe",
        applicationProfiles: ["mastodon_compatible"]
      })
    }]
  });

  assert.equal(descriptor.protocolBindings[0]?.authority, "protocol_native");
  assert.equal(descriptor.applicationId, undefined);
  assert.deepEqual(descriptor.applicationProfiles, []);
});

test("missing application authority remains weak for backward-compatible observations", async () => {
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    now: () => new Date(NOW),
    probes: [{
      id: "legacy-mixed",
      probe: () => providerOnlyObservation({
        applicationId: "https://legacy-brand.example/client.json",
        applicationProfiles: ["mastodon_compatible"]
      })
    }]
  });

  assert.equal(descriptor.applicationId, undefined);
  assert.deepEqual(descriptor.applicationProfiles, []);
});

test("provider-only cached profiles are rejected and self-healed", async () => {
  let deletes = 0;
  let probes = 0;
  const poisonedCache = {
    providerId: "provider.example",
    detectedAt: NOW,
    expiresAt: EXPIRY,
    protocolBindings: providerOnlyObservation().protocolBindings,
    applicationProfiles: ["mastodon_compatible"],
    capabilities: []
  } as RecommendationProviderDescriptor;
  const cache: RecommendationProviderDiscoveryCache = {
    read: () => poisonedCache,
    delete: () => { deletes += 1; },
    write: () => undefined
  };

  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    now: () => new Date(NOW),
    cache,
    probes: [{
      id: "fresh",
      probe: () => {
        probes += 1;
        return providerOnlyObservation();
      }
    }]
  });

  assert.equal(deletes, 1);
  assert.equal(probes, 1);
  assert.deepEqual(descriptor.applicationProfiles, []);
});

test("cache freshness is rechecked after asynchronous cache reads", async () => {
  const times = [
    new Date("2026-08-10T12:59:59.000Z"),
    new Date("2026-08-10T13:00:00.001Z"),
    new Date("2026-08-10T13:00:00.001Z"),
    new Date("2026-08-10T13:00:00.001Z")
  ];
  let timeIndex = 0;
  let probes = 0;
  const cached: RecommendationProviderDescriptor = {
    providerId: "provider.example",
    detectedAt: NOW,
    expiresAt: EXPIRY,
    protocolBindings: providerOnlyObservation().protocolBindings,
    applicationProfiles: [],
    capabilities: []
  };
  const cache: RecommendationProviderDiscoveryCache = {
    read: async () => cached,
    delete: () => undefined,
    write: () => undefined
  };

  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example",
      now: () => times[Math.min(timeIndex++, times.length - 1)] as Date,
      cache,
      probes: [{
        id: "expired-fresh-probe",
        probe: () => {
          probes += 1;
          return providerOnlyObservation();
        }
      }]
    }),
    /no current trusted observations/iu
  );

  assert.equal(probes, 1);
});

test("probe freshness is rechecked after asynchronous probe completion", async () => {
  const times = [
    new Date("2026-08-10T12:59:59.000Z"),
    new Date("2026-08-10T13:00:00.001Z")
  ];
  let timeIndex = 0;

  await assert.rejects(
    () => discoverRecommendationProviderCapabilities({
      providerId: "provider.example",
      now: () => times[Math.min(timeIndex++, times.length - 1)] as Date,
      probes: [{ id: "slow", probe: async () => providerOnlyObservation() }]
    }),
    /no current trusted observations/iu
  );
});
