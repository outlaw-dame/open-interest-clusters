import type { BanditArmState } from "./bandit.js";
import { FileBanditStore } from "./feedback-store.js";
import { contextualArmKey, type RankingContext } from "./context.js";

export class ContextualBanditStore {
  private readonly base: FileBanditStore;

  public constructor(base: FileBanditStore) {
    this.base = base;
  }

  public async getContextStates(context: RankingContext): Promise<Map<string, BanditArmState>> {
    const all = await this.base.getAll();
    const output = new Map<string, BanditArmState>();

    for (const [key, state] of all.entries()) {
      if (!key.includes("@@")) continue;
      const [clusterId, ctx] = key.split("@@");
      if (ctx === contextKey(context)) {
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

function contextKey(context: RankingContext): string {
  return `timeline:${context.timeline}|protocol:${context.protocol}|time:${context.timeBucket}`;
}
