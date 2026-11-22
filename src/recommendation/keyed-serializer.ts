/**
 * Runs async work one at a time per key. A failure in one task does not block the next, and the
 * bookkeeping entry is removed once the queue for a key drains, so idle keys cost nothing.
 */
export interface RecommendationKeyedSerializer {
  run<T>(key: string, work: () => Promise<T>): Promise<T>;
}

export function createRecommendationKeyedSerializer(): RecommendationKeyedSerializer {
  const tails = new Map<string, Promise<void>>();
  return Object.freeze({
    async run<T>(key: string, work: () => Promise<T>): Promise<T> {
      const prior = tails.get(key) ?? Promise.resolve();
      const ready = prior.catch(() => undefined);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const tail = ready.then(() => gate);
      tails.set(key, tail);
      await ready;
      try {
        return await work();
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    }
  });
}
