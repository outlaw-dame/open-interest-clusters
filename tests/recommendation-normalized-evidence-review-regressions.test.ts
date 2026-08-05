import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationInterestSignalFromSource,
  createRecommendationNormalizedEvidencePipeline,
  type RecommendationConsentPolicy,
  type RecommendationEngineProcessInput,
  type RecommendationSourceAdapter,
  type RecommendationSourceItem
} from "../src/index.js";

const SUBJECT = "subject-review-regression";
const OBSERVED_AT = "2026-08-05T15:20:00.000Z";

const source: RecommendationSourceItem = {
  kind: "post",
  context: {
    protocol: "activitypub",
    sourceVisibility: "public",
    accessBasis: "public_web",
    containsPrivateData: false
  },
  provenance: {
    adapterId: "review-public-outbox",
    sourceSystem: "social.example",
    observedAt: OBSERVED_AT,
    trustBoundary: "remote_provider",
    opaqueSourceId: "https://social.example/activities/1"
  }
};

const policy: RecommendationConsentPolicy = {
  subjectId: SUBJECT,
  allowedDataUses: ["ranking", "embeddings"]
};

function adapter(): RecommendationSourceAdapter {
  return {
    id: "review-public-outbox",
    protocol: "activitypub",
    capabilities: ["read_public"],
    read() {
      return { items: [source] };
    }
  };
}

function signalFor(dataUse: "ranking" | "embeddings", evidence: Parameters<
  Parameters<typeof createRecommendationNormalizedEvidencePipeline>[0]["deriveSignals"]
>[0]) {
  return createRecommendationInterestSignalFromSource({
    source: evidence.source,
    target: { kind: "canonical_interest", key: "technology" },
    action: "view",
    strength: 0.5,
    confidence: 0.8,
    dataUse,
    consentEvaluation: evidence.consentEvaluation
  });
}

test("the same provider event receives distinct identities for distinct data uses", async () => {
  const calls: RecommendationEngineProcessInput[] = [];
  const pipeline = createRecommendationNormalizedEvidencePipeline({
    engine: {
      async process(input) {
        calls.push(input);
        return { subjectId: input.subjectId } as never;
      }
    },
    identifySourceEvent: (item) => item.provenance.opaqueSourceId ?? "missing",
    deriveSignals: (evidence) => [signalFor(evidence.dataUse as "ranking" | "embeddings", evidence)]
  });

  const ranking = await pipeline.process({
    adapter: adapter(),
    readRequest: { subjectId: SUBJECT },
    dataUse: "ranking",
    policy
  });
  const embeddings = await pipeline.process({
    adapter: adapter(),
    readRequest: { subjectId: SUBJECT },
    dataUse: "embeddings",
    policy
  });

  assert.notEqual(ranking.evidence[0]?.evidenceId, embeddings.evidence[0]?.evidenceId);
  assert.notEqual(ranking.events[0]?.sourceEventId, embeddings.events[0]?.sourceEventId);
  assert.notEqual(ranking.events[0]?.operationId, embeddings.events[0]?.operationId);
  assert.equal(calls.length, 2);
});

test("the pipeline rejects total event overflow before calling the engine", async () => {
  let engineCalls = 0;
  const pipeline = createRecommendationNormalizedEvidencePipeline({
    engine: {
      async process() {
        engineCalls += 1;
        return {} as never;
      }
    },
    identifySourceEvent: () => "event-1",
    maxEventsPerProcess: 1,
    deriveSignals(evidence) {
      const signal = signalFor("ranking", evidence);
      return [signal, signal];
    }
  });

  await assert.rejects(() => pipeline.process({
    adapter: adapter(),
    readRequest: { subjectId: SUBJECT },
    dataUse: "ranking",
    policy
  }), /total event limit exceeded/u);
  assert.equal(engineCalls, 0);
});
