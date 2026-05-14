import type { AdaptiveCapabilityAnnOrchestrator } from "./adaptive-orchestrator.js";
import {
  cloneAnnConfigSnapshot,
  createAnnConfigSnapshot,
  diffAnnConfigSnapshots,
  type AnnConfigDiff,
  type AnnConfigSnapshot
} from "./config-lifecycle.js";
import type { AnnDeploymentConfigInput } from "./deployment-config.js";

export type AnnConfigManagerEvent =
  | { type: "config-applied"; diff: AnnConfigDiff; fingerprint: string }
  | { type: "config-noop"; diff: AnnConfigDiff; fingerprint: string }
  | { type: "config-rejected"; error: string };

export interface AnnConfigApplyResult {
  applied: boolean;
  snapshot: AnnConfigSnapshot;
  diff: AnnConfigDiff;
}

export interface AnnConfigManagerOptions {
  now?: () => Date;
  onEvent?: (event: AnnConfigManagerEvent) => void;
  maxEventHistory?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown ANN config manager error";
}

export class AdaptiveAnnConfigManager {
  private snapshot: AnnConfigSnapshot;
  private readonly now: () => Date;
  private readonly onEvent: ((event: AnnConfigManagerEvent) => void) | undefined;
  private readonly maxEventHistory: number;
  private readonly eventHistory: AnnConfigManagerEvent[] = [];

  constructor(
    private readonly orchestrator: AdaptiveCapabilityAnnOrchestrator,
    initialConfig: AnnDeploymentConfigInput,
    options: AnnConfigManagerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.onEvent = options.onEvent;
    this.maxEventHistory = Math.max(1, Math.trunc(options.maxEventHistory ?? 32));
    this.snapshot = createAnnConfigSnapshot(initialConfig, this.now);
  }

  private emit(event: AnnConfigManagerEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory.splice(0, this.eventHistory.length - this.maxEventHistory);
    }
    this.onEvent?.(event);
  }

  getSnapshot(): AnnConfigSnapshot {
    return cloneAnnConfigSnapshot(this.snapshot);
  }

  getRecentEvents(): AnnConfigManagerEvent[] {
    return this.eventHistory.map((event) => ({ ...event }));
  }

  applyConfig(input: AnnDeploymentConfigInput): AnnConfigApplyResult {
    try {
      const next = createAnnConfigSnapshot(input, this.now);
      const diff = diffAnnConfigSnapshots(this.snapshot, next);

      if (!diff.changed) {
        this.emit({ type: "config-noop", diff, fingerprint: next.fingerprint });
        return { applied: false, snapshot: this.getSnapshot(), diff };
      }

      this.orchestrator.reconfigure({
        requirement: next.config.requirement,
        deployment: next.config.deployment
      });

      this.snapshot = next;
      this.emit({ type: "config-applied", diff, fingerprint: next.fingerprint });

      return { applied: true, snapshot: this.getSnapshot(), diff };
    } catch (error) {
      this.emit({ type: "config-rejected", error: errorMessage(error) });
      throw error;
    }
  }
}

export function createAdaptiveAnnConfigManager(
  orchestrator: AdaptiveCapabilityAnnOrchestrator,
  initialConfig: AnnDeploymentConfigInput,
  options?: AnnConfigManagerOptions
): AdaptiveAnnConfigManager {
  return new AdaptiveAnnConfigManager(orchestrator, initialConfig, options);
}
