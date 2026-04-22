export type FeedbackEventType =
  | "impression"
  | "click"
  | "open"
  | "save"
  | "follow"
  | "dismiss"
  | "hide";

export interface BanditArmState {
  impressions: number;
  positiveSignals: number;
  negativeSignals: number;
  lastUpdated: number;
}

export interface BanditUpdateOptions {
  now?: number;
  halfLifeMs?: number;
}

const DEFAULT_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 30;

const EVENT_WEIGHTS: Record<FeedbackEventType, { impressions: number; positive: number; negative: number }> = {
  impression: { impressions: 1, positive: 0, negative: 0 },
  click: { impressions: 0, positive: 1, negative: 0 },
  open: { impressions: 0, positive: 1, negative: 0 },
  save: { impressions: 0, positive: 2, negative: 0 },
  follow: { impressions: 0, positive: 3, negative: 0 },
  dismiss: { impressions: 0, positive: 0, negative: 1 },
  hide: { impressions: 0, positive: 0, negative: 2 }
};

function decayValue(value: number, elapsedMs: number, halfLifeMs: number): number {
  if (value <= 0) return 0;
  if (elapsedMs <= 0) return value;
  return value * Math.pow(0.5, elapsedMs / halfLifeMs);
}

export function createBanditArmState(now = Date.now()): BanditArmState {
  return {
    impressions: 0,
    positiveSignals: 0,
    negativeSignals: 0,
    lastUpdated: now
  };
}

export function decayBanditState(
  state: Readonly<BanditArmState>,
  options: BanditUpdateOptions = {}
): BanditArmState {
  const now = options.now ?? Date.now();
  const halfLifeMs = Math.max(1000, options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS);
  const elapsedMs = Math.max(0, now - state.lastUpdated);

  return {
    impressions: decayValue(state.impressions, elapsedMs, halfLifeMs),
    positiveSignals: decayValue(state.positiveSignals, elapsedMs, halfLifeMs),
    negativeSignals: decayValue(state.negativeSignals, elapsedMs, halfLifeMs),
    lastUpdated: now
  };
}

export function applyFeedbackEvent(
  state: Readonly<BanditArmState> | undefined,
  eventType: FeedbackEventType,
  options: BanditUpdateOptions = {}
): BanditArmState {
  const now = options.now ?? Date.now();
  const base = state ? decayBanditState(state, { ...options, now }) : createBanditArmState(now);
  const delta = EVENT_WEIGHTS[eventType];

  return {
    impressions: base.impressions + delta.impressions,
    positiveSignals: base.positiveSignals + delta.positive,
    negativeSignals: base.negativeSignals + delta.negative,
    lastUpdated: now
  };
}

export function getBanditObservationCount(state: Readonly<BanditArmState>): number {
  return Math.max(0, state.impressions + state.positiveSignals + state.negativeSignals);
}

export function scoreBanditState(
  state: Readonly<BanditArmState>,
  totalObservations: number,
  explorationWeight = 0.35,
  options: BanditUpdateOptions = {}
): number {
  const decayed = decayBanditState(state, options);
  const alpha = 1 + decayed.positiveSignals;
  const beta = 1 + decayed.negativeSignals + Math.max(0, decayed.impressions - decayed.positiveSignals);
  const mean = alpha / (alpha + beta);
  const observations = Math.max(1, getBanditObservationCount(decayed));
  const exploration = explorationWeight * Math.sqrt(Math.log(Math.max(2, totalObservations + 1)) / observations);
  return mean + exploration;
}
