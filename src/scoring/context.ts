export type TimelineKind = "home" | "explore" | "search" | "notifications" | "unknown";
export type ProtocolContext = "activitypub" | "atproto" | "mixed" | "unknown";
export type TimeBucket = "overnight" | "morning" | "afternoon" | "evening";

export interface RankingContext {
  timeline: TimelineKind;
  protocol: ProtocolContext;
  timeBucket: TimeBucket;
}

export function getTimeBucket(now = new Date()): TimeBucket {
  const hour = now.getUTCHours();
  if (hour < 6) return "overnight";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function createRankingContext(input: {
  timeline?: TimelineKind;
  protocol?: ProtocolContext;
  now?: Date;
} = {}): RankingContext {
  return {
    timeline: input.timeline ?? "unknown",
    protocol: input.protocol ?? "unknown",
    timeBucket: getTimeBucket(input.now)
  };
}

export function contextKey(context: RankingContext): string {
  return `timeline:${context.timeline}|protocol:${context.protocol}|time:${context.timeBucket}`;
}

export function contextualArmKey(clusterId: string, context: RankingContext): string {
  return `${clusterId}@@${contextKey(context)}`;
}
