import test from "node:test";
import assert from "node:assert/strict";

import {
  addExplicitInterest,
  createLocalPreferenceProfile,
  decayLocalPreferenceProfile,
  deserializeLocalPreferenceProfile,
  serializeLocalPreferenceProfile
} from "../src/index.js";

test("local preference decay reduces stale interest weights", () => {
  const profile = addExplicitInterest(
    createLocalPreferenceProfile(0),
    "gaming.playstation",
    0
  );

  const decayed = decayLocalPreferenceProfile(profile, {
    now: 1000 * 60 * 60 * 24 * 365
  });

  const original = profile.interests[0]?.weight ?? 0;
  const next = decayed.interests[0]?.weight ?? 0;

  assert.ok(next < original);
});

test("local preference serialization round-trips safely", () => {
  const profile = addExplicitInterest(
    createLocalPreferenceProfile(1),
    "gaming.playstation",
    2
  );

  const restored = deserializeLocalPreferenceProfile(
    serializeLocalPreferenceProfile(profile)
  );

  assert.deepEqual(restored, profile);
});

test("local preference deserialization rejects invalid schema", () => {
  assert.throws(() => {
    deserializeLocalPreferenceProfile(
      JSON.stringify({
        schemaVersion: "invalid"
      })
    );
  });
});
