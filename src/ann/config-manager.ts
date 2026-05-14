import type { AdaptiveCapabilityAnnOrchestrator } from "./adaptive-orchestrator.js";
import {
  ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION,
  cloneAnnConfigSnapshot,
  createAnnConfigSnapshot,
  diffAnnConfigSnapshots,
  freezeAnnConfigSnapshot,
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

function cloneDiff(diff: AnnConfigDiff): AnnConfigDiff {
  return {
    changed: diff.changed,
    previousFingerprint: diff.previousFingerprint,
    nextFingerprint: diff.nextFingerprint
  };
}

function cloneEvent(event: AnnConfigManagerEvent): AnnConfigManagerEvent {
  if (event.type === "config-rejected") {
    return { type: event.type, error: event.error };
  }

  return {
    type: event.type,
    diff: cloneDiff(event.diff),
    fingerprint: event.fingerprint
  };
}

function eventForCallback(event: AnnConfigManagerEvent): AnnConfigManagerEvent {
  return cloneEvent(event);
}

function assertCompatibleSnapshot(snapshot: AnnConfigSnapshot): void {
  if (snapshot.schemaVersion !== ANN_CONFIG_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("ANN config snapshot schema version is unsupported");
  }
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
    const storedEvent = cloneEvent(event);
    this.eventHistory.push(storedEvent);
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory.splice(0, this.eventHistory.length - this.maxEventHistory);
    }
    this.onEvent?.(eventForCallback(storedEvent));
  }

  getSnapshot(): AnnConfigSnapshot {
    return cloneAnnConfigSnapshot(this.snapshot);
  }

  getRecentEvents(): AnnConfigManagerEvent[] {
    return this.eventHistory.map((event) => cloneEvent(event));
  }

  restoreSnapshot(snapshot: AnnConfigSnapshot): void {
    try {
      assertCompatibleSnapshot(snapshot);
      const frozen = freezeAnnConfigSnapshot(cloneAnnConfigSnapshot(snapshot));

      this.orchestrator.reconfigure({
        requirement: frozen.config.requirement,
        deployment: frozen.config.deployment
      });

      this.snapshot = frozen;
      this.emit({
        type: "config-applied",
        diff: {
          changed: true,
          previousFingerprint: null,
          nextFingerprint: frozen.fingerprint
        },
        fingerprint: frozen.fingerprint
      });
    } catch (error) {
      this.emit({ type: "config-rejected", error: errorMessage(error) });
      throw error;
    }
  }

  applyConfig(input: AnnDeploymentConfigInput): AnnConfigApplyResult {
    try {
      const next = createAnnConfigSnapshot(input, this.now);
      const diff = diffAnnConfigSnapshots(this.snapshot, next);

      if (!diff.changed) {
        this.emit({ type: "config-noop", diff, fingerprint: next.fingerprint });
        return { applied: false, snapshot: this.getSnapshot(), diff: cloneDiff(diff) };
      }

      this.orchestrator.reconfigure({
        requirement: next.config.requirement,
        deployment: next.config.deployment
      });

      this.snapshot = next;
      this.emit({ type: "config-applied", diff, fingerprint: next.fingerprint });

      return { applied: true, snapshot: this.getSnapshot(), diff: cloneDiff(diff) };
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
