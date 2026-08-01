import type { RecommendationProfileSnapshot } from "./profile-store.js";
import type { RecommendationProfileSignalReplacementStore } from "./profile-replacement-store.js";
import type { RecommendationSignalLedger } from "./signal-ledger.js";

export interface RecommendationProfileApplicationOrchestratorOptions {
  profileStore: RecommendationProfileSignalReplacementStore;
  now?: () => string;
}

export interface RecommendationProfileApplicationInput {
  subjectId: string;
  ledger: RecommendationSignalLedger;
  now?: string;
}

export interface RecommendationProfileApplicationResult {
  subjectId: string;
  activeSignalCount: number;
  tombstoneCount: number;
  ledgerOperationCount: number;
  acceptedSignalCount: number;
  skippedExpiredSignalCount: number;
  profile: RecommendationProfileSnapshot;
}

export interface RecommendationProfileApplicationOrchestrator {
  synchronize(input: RecommendationProfileApplicationInput): Promise<RecommendationProfileApplicationResult>;
}

const MAX_SUBJECT_ID_LENGTH = 512;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSubjectId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > MAX_SUBJECT_ID_LENGTH ||
    /[\x00-\x1F\x7F]/u.test(value)
  ) {
    throw new TypeError("Invalid recommendation profile application subject ID.");
  }
  return value;
}

function validateTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new TypeError("Invalid recommendation profile application timestamp.");
  }
  return value;
}

export function createRecommendationProfileApplicationOrchestrator(
  options: RecommendationProfileApplicationOrchestratorOptions
): RecommendationProfileApplicationOrchestrator {
  if (!isPlainRecord(options) || !isPlainRecord(options.profileStore)) {
    throw new TypeError("Invalid recommendation profile application orchestrator options.");
  }

  const nowProvider = options.now ?? (() => new Date().toISOString());
  if (typeof nowProvider !== "function") {
    throw new TypeError("Invalid recommendation profile application clock.");
  }

  const tails = new Map<string, Promise<void>>();

  async function runSerialized<T>(subjectId: string, work: () => Promise<T>): Promise<T> {
    const prior = tails.get(subjectId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    tails.set(subjectId, tail);
    await prior;
    try {
      return await work();
    } finally {
      release();
      if (tails.get(subjectId) === tail) tails.delete(subjectId);
    }
  }

  return Object.freeze({
    async synchronize(input: RecommendationProfileApplicationInput): Promise<RecommendationProfileApplicationResult> {
      if (!isPlainRecord(input) || !isPlainRecord(input.ledger)) {
        throw new TypeError("Invalid recommendation profile application input.");
      }

      const subjectId = validateSubjectId(input.subjectId);
      const now = validateTimestamp(input.now ?? nowProvider());

      return runSerialized(subjectId, async () => {
        const snapshot = input.ledger.snapshot({ now });
        const replacement = await options.profileStore.replaceSignals({
          subjectId,
          signals: snapshot.activeSignals.map((entry) => entry.signal),
          now
        });

        return Object.freeze({
          subjectId,
          activeSignalCount: snapshot.activeSignals.length,
          tombstoneCount: snapshot.tombstones.length,
          ledgerOperationCount: snapshot.operationCount,
          acceptedSignalCount: replacement.acceptedSignalCount,
          skippedExpiredSignalCount: replacement.skippedExpiredSignalCount,
          profile: replacement.profile
        });
      });
    }
  });
}
