import type { AdaptiveCapabilityAnnOrchestrator } from "./adaptive-orchestrator.js";
import {
  createAnnConfigSnapshot,
  diffAnnConfigSnapshots,
  type AnnConfigDiff,
  type AnnConfigSnapshot
} from "./config-lifecycle.js";
import type { AnnDeploymentConfigInput } from "./deployment-config.js";

export type AnnConfigManagerEventType = "config-applied" | "config-noop" | "config-rejected";

export interface AnnConfigManagerEvent {
  type: AnnConfigManagerEventType;
  diff?: AnnConfigDiff;
  fingerprint?: string;
  error?: string;
}

export interface AnnConfigApplyResult {
  applied: boolean;
  snapshot: AnnConfigSnapshot;
  diff: AnnConfigDiff;
}

export interface AnnConfigManagerOptions {
  now?: () => Date;
  onEvent?: (event: AnnConfigManagerEvent) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown ANN config manager error";
}

export class AdaptiveAnnConfigManager {
  private snapshot: AnnConfigSnapshot;
  private readonly now: () => Date;
  private readonly onEvent: ((event: AnnConfigManagerEvent) => void) | undefined;

  constructor(
    private readonly orchestrator: AdaptiveCapabilityAnnOrchestrator,
    initialConfig: AnnDeploymentConfigInput,
    options: AnnConfigManagerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.onEvent = options.onEvent;
    this.snapshot = createAnnConfigSnapshot(initialConfig, this.now);
  }

  getSnapshot(): AnnConfigSnapshot {
    return {
      ...this.snapshot,
      config: {
        ...this.snapshot.config,
        requirement: { ...this.snapshot.config.requirement },
        deployment: { ...this.snapshot.config.deployment }
      }
    };
  }

  applyConfig(input: AnnDeploymentConfigInput): AnnConfigApplyResult {
    try {
      const next = createAnnConfigSnapshot(input, this.now);
      const diff = diffAnnConfigSnapshots(this.snapshot, next);

      if (!diff.changed) {
        this.onEvent?.({ type: "config-noop", diff, fingerprint: next.fingerprint });
        return { applied: false, snapshot: this.getSnapshot(), diff };
      }

      this.orchestrator.reconfigure({
        requirement: next.config.requirement,
        deployment: next.config.deployment
      });

      this.snapshot = next;
      this.onEvent?.({ type: "config-applied", diff, fingerprint: next.fingerprint });

      return { applied: true, snapshot: this.getSnapshot(), diff };
    } catch (error) {
      this.onEvent?.({ type: "config-rejected", error: errorMessage(error) });
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
