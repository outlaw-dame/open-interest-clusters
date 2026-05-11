import test from "node:test";
import assert from "node:assert/strict";

import {
  addExplicitInterest,
  applyLocalFeedback,
  createLocalPreferenceProfile,
  scoreLocalPreference
} from "../src/index.js";

test("explicit interests increase local weight", () => {
  const profile = addExplicitInterest(
    createLocalPreferenceProfile(1),
    "gaming.playstation",
    2
  );

  const score = scoreLocalPreference(profile, "gaming.playstation");

  assert.ok(score.weight > 0);
  assert.equal(score.reason, "explicit_interest");
});

test("local feedback produces local preference score", () => {
  const profile = applyLocalFeedback(
    createLocalPreferenceProfile(1),
    {
      clusterId: "gaming.playstation",
      eventType: "follow",
      occurredAt: 2
    }
  );

  const score = scoreLocalPreference(profile, "gaming.playstation");

  assert.ok(score.banditScore > 0);
  assert.equal(score.reason, "local_feedback");
});

test("combined local preference scoring merges explicit and feedback signals", () => {
  const explicit = addExplicitInterest(
    createLocalPreferenceProfile(1),
    "gaming.playstation",
    2
  );

  const profile = applyLocalFeedback(explicit, {
    clusterId: "gaming.playstation",
    eventType: "save",
    occurredAt: 3
  });

  const score = scoreLocalPreference(profile, "gaming.playstation");

  assert.equal(score.reason, "combined");
  assert.ok(score.weight > 20);
});
