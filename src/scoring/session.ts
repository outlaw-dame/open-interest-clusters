import { applyFeedbackEvent, createBanditArmState, type BanditArmState, type FeedbackEventType } from "./bandit.js";

export class SessionBandit {
  private readonly state = new Map<string, BanditArmState>();

  public record(clusterId: string, event: FeedbackEventType): void {
    const existing = this.state.get(clusterId);
    const updated = applyFeedbackEvent(existing, event);
    this.state.set(clusterId, updated);
  }

  public getStates(): Map<string, BanditArmState> {
    return new Map(this.state);
  }

  public reset(): void {
    this.state.clear();
  }
}
