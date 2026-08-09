import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecommendationBlueskyProfileFeatureCapabilities,
  deriveRecommendationProfilePinnedInterestEvidence
} from "../src/index.js";

const POLICY = {
  accountEligible: true,
  providerAllowsRecommendation: true,
  blocked: false,
  muted: false,
  domainBlocked: false,
  capabilities: createRecommendationBlueskyProfileFeatureCapabilities()
} as const;

function keywordsFor(description: string, keywords: readonly string[]): readonly string[] {
  return deriveRecommendationProfilePinnedInterestEvidence({
    protocol: "atproto",
    accountId: "did:plc:compound",
    accountUri: "at://did:plc:compound/app.bsky.actor.profile/self",
    profile: { description },
    keywords,
    policy: POLICY,
    observedAt: "2026-08-09T13:30:00Z"
  }).map((entry) => entry.keyword);
}

test("camel and Pascal case hashtags match spaced interest keywords", () => {
  assert.deepEqual(
    keywordsFor("Building #OpenSource tools for #ClimateScience", ["open source", "climate science"]),
    ["open source", "climate science"]
  );
});

test("acronym-containing compound hashtags expose conservative phrase alternatives", () => {
  assert.deepEqual(
    keywordsFor("Interested in #OpenAIResearch and #OAuthSecurity", ["open ai research", "oauth security"]),
    ["open ai research", "oauth security"]
  );
});

test("separator-delimited hashtags match equivalent spaced keywords", () => {
  assert.deepEqual(
    keywordsFor("Working on #Open_Source and #Local-First systems", ["open source", "local first"]),
    ["open source", "local first"]
  );
});

test("all-lowercase compounds are not dictionary-segmented", () => {
  assert.deepEqual(
    keywordsFor("Building #opensource systems", ["open source"]),
    []
  );
});

test("compound expansion does not make substrings into interests", () => {
  assert.deepEqual(
    keywordsFor("Building #OpenSourceSecurity", ["source", "security", "open source"]),
    []
  );
});
