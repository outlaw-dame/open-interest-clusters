import assert from "node:assert/strict";
import test from "node:test";
import {
  completeRecommendationAtprotoSafetySource,
  createRecommendationAtprotoBlocksClient,
  createRecommendationAtprotoModerationSuggestion,
  createRecommendationAtprotoPreferencesClient,
  evaluateRecommendationAtprotoViewerSafety,
  incompleteRecommendationAtprotoSafetySource,
  unsupportedRecommendationAtprotoSafetySource,
  type RecommendationAtprotoViewerSafetySnapshot
} from "../src/index.js";

const NOW = "2026-08-03T22:00:00.000Z";
const authorization = {
  status: "authorized" as const,
  subjectId: "did:plc:viewer123",
  checkedAt: NOW,
  sourceVisibility: "followers_only" as const,
  accessBasis: "oauth_scope" as const,
  containsPrivateData: true
};

function emptySnapshot(): RecommendationAtprotoViewerSafetySnapshot {
  return {
    subjectDid: "did:plc:viewer123",
    blocks: completeRecommendationAtprotoSafetySource([], NOW),
    mutes: completeRecommendationAtprotoSafetySource([], NOW),
    mutedLists: completeRecommendationAtprotoSafetySource([], NOW),
    mutedWords: completeRecommendationAtprotoSafetySource([], NOW),
    hiddenPosts: completeRecommendationAtprotoSafetySource([], NOW),
    labelPreferences: completeRecommendationAtprotoSafetySource([], NOW),
    domainBlocks: unsupportedRecommendationAtprotoSafetySource()
  };
}

test("ATProto completed empty safety sources are authoritative for new accounts", () => {
  const decision = evaluateRecommendationAtprotoViewerSafety({ snapshot: emptySnapshot(), candidate: { authorDid: "did:plc:candidate123" }, now: NOW });
  assert.equal(decision.evidenceComplete, true);
  assert.equal(decision.eligible, true);
  assert.deepEqual(decision.reasonCodes, []);
});

test("ATProto incomplete safety reads fail closed instead of masquerading as empty", () => {
  const snapshot = { ...emptySnapshot(), blocks: incompleteRecommendationAtprotoSafetySource<string>() };
  const decision = evaluateRecommendationAtprotoViewerSafety({ snapshot, candidate: { authorDid: "did:plc:candidate123" }, now: NOW });
  assert.equal(decision.evidenceComplete, false);
  assert.equal(decision.eligible, false);
  assert.deepEqual(decision.reasonCodes, ["viewer_safety_evidence_incomplete"]);
});

test("ATProto blocks client accepts a successful empty API response", async () => {
  const client = createRecommendationAtprotoBlocksClient({
    serviceUrl: "https://bsky.social",
    transport: { async get(input) { assert.match(input.url, /app\.bsky\.graph\.getBlocks/u); return { body: { blocks: [] }, observedAt: NOW }; } }
  });
  const result = await client.read({ subjectDid: "did:plc:viewer123", authorization });
  assert.equal(result.state, "complete");
  assert.deepEqual(result.items, []);
});

test("ATProto preferences enforce muted words, hidden posts, and label choices", async () => {
  const client = createRecommendationAtprotoPreferencesClient({
    serviceUrl: "https://bsky.social",
    transport: { async get() { return { observedAt: NOW, body: { preferences: [
      { $type: "app.bsky.actor.defs#mutedWordsPref", items: [{ value: "spoiler", targets: ["content"], actorTarget: "all" }] },
      { $type: "app.bsky.actor.defs#hiddenPostsPref", items: ["at://did:plc:author/app.bsky.feed.post/1"] },
      { $type: "app.bsky.actor.defs#contentLabelPref", label: "graphic-media", visibility: "hide" }
    ] } }; } }
  });
  const prefs = await client.read({ subjectDid: "did:plc:viewer123", authorization });
  const snapshot = { ...emptySnapshot(), ...prefs };
  assert.equal(evaluateRecommendationAtprotoViewerSafety({ snapshot, candidate: { authorDid: "did:plc:author", text: "a spoiler" }, now: NOW }).eligible, false);
  assert.equal(evaluateRecommendationAtprotoViewerSafety({ snapshot, candidate: { authorDid: "did:plc:author", uri: "at://did:plc:author/app.bsky.feed.post/1" }, now: NOW }).eligible, false);
  assert.equal(evaluateRecommendationAtprotoViewerSafety({ snapshot, candidate: { authorDid: "did:plc:author", labels: ["graphic-media"] }, now: NOW }).eligible, false);
});

test("ATProto relationship viewer state remains a mandatory hard gate", () => {
  const decision = evaluateRecommendationAtprotoViewerSafety({ snapshot: emptySnapshot(), candidate: { authorDid: "did:plc:author", viewer: { muted: false, blockedBy: true, blocking: null, blockingByList: null, mutingByList: null } }, now: NOW });
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasonCodes.includes("viewer_blocked_by_actor"));
});

test("ATProto moderation suggestions can never execute automatically", () => {
  const suggestion = createRecommendationAtprotoModerationSuggestion({ kind: "report", target: "at://did:plc:author/app.bsky.feed.post/1", reasonCodes: ["repeated_harassment"], confidence: 0.9 });
  assert.equal(suggestion.requiresExplicitConfirmation, true);
  assert.equal(suggestion.automaticallyExecutable, false);
  assert.equal(suggestion.xrpcMethod, "com.atproto.moderation.createReport");
});
