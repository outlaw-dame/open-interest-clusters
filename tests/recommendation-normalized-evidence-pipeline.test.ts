import test from "node:test";
import assert from "node:assert/strict";

import {
  createRecommendationInterestSignalFromSource,
  createRecommendationNormalizedEvidenceBatch,
  createRecommendationNormalizedEvidencePipeline,
  type RecommendationConsentGatedSourceAdapterReadResult,
  type RecommendationConsentPolicy,
  type RecommendationEngineOrchestrator,
  type RecommendationEngineProcessInput,
  type RecommendationSourceAdapter,
  type RecommendationSourceItem
} from "../src/index.js";

const SUBJECT = "subject-1";
const OBSERVED_AT = "2026-08-05T14:00:00.000Z";
const RAW_SOURCE_EVENT_ID = "https://social.example/activities/private-to-storage";

const source: RecommendationSourceItem = {
  kind: "post",
  context: {
    protocol: "activitypub",
    sourceVisibility: "public",
    accessBasis: "public_web",
    containsPrivateData: false
  },
  provenance: {
    adapterId: "public-outbox",
    sourceSystem: "social.example",
    observedAt: OBSERVED_AT,
    trustBoundary: "remote_provider",
    opaqueSourceId: RAW_SOURCE_EVENT_ID
  }
};

const policy: RecommendationConsentPolicy = {
  subjectId: SUBJECT,
  allowedDataUses: ["ranking"]
};

function adapter(): RecommendationSourceAdapter {
  return {
    id: "public-outbox",
    protocol: "activitypub",
    capabilities: ["read_public"],
    read() {
      return { items: [source], cursor: "next" };
    }
  };
}

function fakeEngine(calls: RecommendationEngineProcessInput[]): Pick<RecommendationEngineOrchestrator, "process"> {
  return {
    async process(input) {
      calls.push(input);
      return { subjectId: input.subjectId } as never;
    }
  };
}

test("normalized evidence hashes source identity and binds consent to source context", async () => {
  const calls: RecommendationEngineProcessInput[] = [];
  const pipeline = createRecommendationNormalizedEvidencePipeline({
    engine: fakeEngine(calls),
    identifySourceEvent(item) {
      return item.provenance.opaqueSourceId ?? "missing";
    },
    deriveSignals(evidence) {
      return [createRecommendationInterestSignalFromSource({
        source: evidence.source,
        target: { kind: "canonical_interest", key: "technology" },
        action: "view",
        strength: 0.5,
        confidence: 0.8,
        dataUse: evidence.dataUse,
        consentEvaluation: evidence.consentEvaluation
      })];
    }
  });

  const first = await pipeline.process({
    adapter: adapter(),
    readRequest: { subjectId: SUBJECT, limit: 1 },
    dataUse: "ranking",
    policy
  });
  const second = await pipeline.process({
    adapter: adapter(),
    readRequest: { subjectId: SUBJECT, limit: 1 },
    dataUse: "ranking",
    policy
  });

  assert.equal(first.evidence.length, 1);
  assert.equal(first.signals.length, 1);
  assert.equal(first.events.length, 1);
  assert.equal(first.cursor, "next");
  assert.match(first.evidence[0]?.evidenceId ?? "", /^evidence:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(first).includes(RAW_SOURCE_EVENT_ID), true);
  assert.equal(first.events[0]?.sourceEventId.includes(RAW_SOURCE_EVENT_ID), false);
  assert.equal(first.events[0]?.operationId.includes(RAW_SOURCE_EVENT_ID), false);
  assert.equal(first.events[0]?.sourceEventId, second.events[0]?.sourceEventId);
  assert.equal(first.events[0]?.operationId, second.events[0]?.operationId);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.subjectId, SUBJECT);
});

test("normalized evidence rejects consent evaluations that do not match their source", () => {
  const mismatchedConsent = {
    decision: "allow" as const,
    reason: "consent.allow.explicit" as const,
    dataUse: "ranking" as const,
    protocol: "activitypub" as const,
    sourceVisibility: "followers_only" as const,
    accessBasis: "public_web" as const,
    containsPrivateData: false,
    containsThirdPartyData: false,
    serverSideProcessing: false
  };
  const readResult: RecommendationConsentGatedSourceAdapterReadResult = {
    items: [source],
    consentEvaluations: [{
      ...mismatchedConsent,
      auditEvent: mismatchedConsent
    }],
    deniedItemCount: 0
  };

  assert.throws(() => createRecommendationNormalizedEvidenceBatch({
    subjectId: SUBJECT,
    dataUse: "ranking",
    readResult,
    identifySourceEvent: () => "event-1"
  }), /consent does not match/u);
});

test("pipeline rejects signals derived from different evidence", async () => {
  const pipeline = createRecommendationNormalizedEvidencePipeline({
    engine: fakeEngine([]),
    identifySourceEvent: () => "event-1",
    deriveSignals(evidence) {
      const signal = createRecommendationInterestSignalFromSource({
        source: evidence.source,
        target: { kind: "canonical_interest", key: "technology" },
        action: "view",
        strength: 0.5,
        confidence: 0.8,
        dataUse: evidence.dataUse,
        consentEvaluation: evidence.consentEvaluation
      });
      return [{ ...signal, evidence: { ...signal.evidence, observedAt: "2026-08-05T14:00:01.000Z" } }];
    }
  });

  await assert.rejects(() => pipeline.process({
    adapter: adapter(),
    readRequest: { subjectId: SUBJECT },
    dataUse: "ranking",
    policy
  }), /not bound to its normalized evidence/u);
});

test("pipeline bounds fan-out before engine processing", async () => {
  let engineCalls = 0;
  const pipeline = createRecommendationNormalizedEvidencePipeline({
    engine: {
      async process() {
        engineCalls += 1;
        return {} as never;
      }
    },
    identifySourceEvent: () => "event-1",
    maxSignalsPerEvidence: 1,
    deriveSignals(evidence) {
      const signal = createRecommendationInterestSignalFromSource({
        source: evidence.source,
        target: { kind: "canonical_interest", key: "technology" },
        action: "view",
        strength: 0.5,
        confidence: 0.8,
        dataUse: evidence.dataUse,
        consentEvaluation: evidence.consentEvaluation
      });
      return [signal, signal];
    }
  });

  await assert.rejects(() => pipeline.process({
    adapter: adapter(),
    readRequest: { subjectId: SUBJECT },
    dataUse: "ranking",
    policy
  }), /signal limit exceeded/u);
  assert.equal(engineCalls, 0);
});
