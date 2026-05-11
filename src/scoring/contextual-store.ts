import type { BanditArmState } from "./bandit.js";
import { FileBanditStore } from "./feedback-store.js";
import { contextKey, contextualArmKey, type RankingContext } from "./context.js";

export class ContextualBanditStore {
  private readonly base: FileBanditStore;

  public constructor(base: FileBanditStore) {
    this.base = base;
  }

  public async getContextStates(context: RankingContext): Promise<Map<string, BanditArmState>> {
    const all = await this.base.getAll();
    const output = new Map<string, BanditArmState>();
    const expectedContextKey = contextKey(context);

    for (const [key, state] of all.entries()) {
      if (!key.includes("@@")) continue;
      const [clusterId, ctx] = key.split("@@");
      if (clusterId && ctx === expectedContextKey) {
        output.set(clusterId, state);
      }
    }

    return output;
  }

  public async upsert(clusterId: string, context: RankingContext, state: BanditArmState): Promise<void> {
    const key = contextualArmKey(clusterId, context);
    await this.base.upsert(key, state);
  }
}
