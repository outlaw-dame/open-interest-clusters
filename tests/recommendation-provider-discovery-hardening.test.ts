import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverRecommendationProviderCapabilities,
  type RecommendationProviderDiscoveryCache,
  type RecommendationProviderDiscoveryObservation
} from "../src/recommendation/provider-discovery.js";

const NOW = "2026-08-10T12:00:00.000Z";
const EXPIRY = "2026-08-10T13:00:00.000Z";

function providerProbeObservation(
  overrides: Partial<RecommendationProviderDiscoveryObservation> = {}
): RecommendationProviderDiscoveryObservation {
  return {
    providerId: "provider.example",
    applicationId: "https://untrusted-branding.example/client.json",
    protocolBindings: [{
      protocol: "activitypub",
      endpoint: "https://provider.example/users/alice",
      authority: "provider_probe",
      verification: "asserted"
    }],
    applicationProfiles: ["mastodon_compatible"],
    capabilities: [{
      capability: "posts",
      state: "supported",
      authority: "provider_probe",
      protocol: "activitypub"
    }],
    observedAt: NOW,
    expiresAt: EXPIRY,
    ...overrides
  };
}

function providerOnlyObservation(): RecommendationProviderDiscoveryObservation {
  const observed = providerProbeObservation({ applicationProfiles: [] });
  const { applicationId: _applicationId, ...providerOnly } = observed;
  return providerOnly;
}

test("weak provider fingerprinting cannot become the sole application identity or compatibility profile", async () => {
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    now: () => new Date(NOW),
    probes: [{ id: "server-fingerprint", probe: () => providerProbeObservation() }]
  });

  assert.equal(descriptor.applicationId, undefined);
  assert.deepEqual(descriptor.applicationProfiles, []);
  assert.equal(descriptor.protocolBindings[0]?.authority, "provider_probe");
  assert.equal(descriptor.capabilities[0]?.capability, "posts");
});

test("explicit caller application identity is not rewritten by weak provider branding", async () => {
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://trusted-app.example/client.json",
    now: () => new Date(NOW),
    probes: [{ id: "server-fingerprint", probe: () => providerProbeObservation() }]
  });

  assert.equal(descriptor.applicationId, "https://trusted-app.example/client.json");
  assert.deepEqual(descriptor.applicationProfiles, []);
});

test("application profiles require matching strong application identity evidence", async () => {
  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    applicationId: "https://trusted-app.example/client.json",
    now: () => new Date(NOW),
    probes: [
      { id: "weak", probe: () => providerProbeObservation() },
      {
        id: "strong",
        probe: () => providerProbeObservation({
          applicationId: "https://trusted-app.example/client.json",
          protocolBindings: [{
            protocol: "activitypub",
            endpoint: "https://provider.example/users/alice",
            authority: "protocol_native",
            verification: "verified"
          }],
          applicationProfiles: ["generic_activitypub"]
        })
      }
    ]
  });

  assert.deepEqual(descriptor.applicationProfiles, ["generic_activitypub"]);
});

test("cache read, delete, and write failures cannot override fresh verified discovery", async () => {
  let probeCalls = 0;
  const cache: RecommendationProviderDiscoveryCache = {
    read: () => { throw new Error("cache unavailable"); },
    delete: () => { throw new Error("delete unavailable"); },
    write: () => { throw new Error("write unavailable"); }
  };

  const descriptor = await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    now: () => new Date(NOW),
    cache,
    probes: [{
      id: "fresh",
      probe: () => {
        probeCalls += 1;
        return providerOnlyObservation();
      }
    }]
  });

  assert.equal(probeCalls, 1);
  assert.equal(descriptor.providerId, "provider.example");
});

test("a cache miss does not trigger deletion", async () => {
  let deletes = 0;
  const cache: RecommendationProviderDiscoveryCache = {
    read: () => undefined,
    delete: () => { deletes += 1; },
    write: () => undefined
  };

  await discoverRecommendationProviderCapabilities({
    providerId: "provider.example",
    now: () => new Date(NOW),
    cache,
    probes: [{ id: "fresh", probe: () => providerOnlyObservation() }]
  });

  assert.equal(deletes, 0);
});

test("cache descriptors with duplicate protocol identities are rejected and self-healed", async () => {
  let deletes = 0;
  let probeCalls = 0;
  const cache: RecommendationProviderDiscoveryCache = {
    read: () => ({
      providerId: "provider.example",
      detectedAt: NOW,
      expiresAt: EXPIRY,
      protocolBindings: [
        {
          protocol: "activitypub",
          endpoint: "https://provider.example/users/alice",
          authority: "protocol_native",
          verification: "verified"
        },
        {
          protocol: "activitypub",
          endpoint: "https://provider.example/users/alice",
          authority: "provider_probe",
          verification: "asserted"
        }
      ],
      applicationProfiles: [],
      capabilities: []
    }),
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
        probeCalls += 1;
        return providerOnlyObservation();
      }
    }]
  });

  assert.equal(deletes, 1);
  assert.equal(probeCalls, 1);
  assert.equal(descriptor.providerId, "provider.example");
});
