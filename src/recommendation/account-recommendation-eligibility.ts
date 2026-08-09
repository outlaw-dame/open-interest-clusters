import { hasUnsafeControlCharacter } from "./control-characters.js";
import { normalizeRecommendationSourceAdapterReadRequest } from "./source-adapter.js";

export const RECOMMENDATION_ACCOUNT_MAX_INACTIVITY_DAYS = 45;
const MAX_MOVES = 5;
const MAX_ID = 2_048;

export type RecommendationAccountEligibilityReason =
  | "eligible"
  | "inactive"
  | "deactivated"
  | "suspended"
  | "deleted"
  | "unresolved"
  | "move_loop"
  | "move_limit";

export interface RecommendationAccountProfile {
  id: string;
  uri: string;
  handle?: string;
  lastActivityAt?: string;
  movedTo?: string;
  deactivated?: boolean;
  suspended?: boolean;
  deleted?: boolean;
}

export interface RecommendationAccountProfileResolver {
  resolve(reference: string, signal?: AbortSignal): RecommendationAccountProfile | undefined | Promise<RecommendationAccountProfile | undefined>;
}

export interface RecommendationAccountEligibilityResult {
  eligible: boolean;
  reason: RecommendationAccountEligibilityReason;
  requestedReference: string;
  resolvedAccount?: RecommendationAccountProfile;
  moveChain: readonly string[];
  evaluatedAt: string;
  inactivityDays: number;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > MAX_ID || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid recommendation account ${label}.`);
  }
  return value;
}

function instant(value: unknown, label: string): string {
  const normalized = text(value, label);
  try {
    normalizeRecommendationSourceAdapterReadRequest({ subjectId: "account-eligibility-timestamp", since: normalized });
  } catch {
    throw new TypeError(`Invalid recommendation account ${label}.`);
  }
  // The shared source-adapter contract accepts RFC3339 leap seconds, but
  // ECMAScript Date arithmetic does not. Eligibility must reject timestamps
  // that cannot be represented by the arithmetic used for the inactivity gate.
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`Invalid recommendation account ${label}.`);
  }
  return normalized;
}

function normalizeProfile(value: unknown): RecommendationAccountProfile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid recommendation account profile.");
  const raw = value as Record<string, unknown>;
  const profile: RecommendationAccountProfile = {
    id: text(raw.id, "ID"),
    uri: text(raw.uri, "URI")
  };
  if (raw.handle !== undefined) profile.handle = text(raw.handle, "handle");
  if (raw.lastActivityAt !== undefined) profile.lastActivityAt = instant(raw.lastActivityAt, "last activity timestamp");
  if (raw.movedTo !== undefined) profile.movedTo = text(raw.movedTo, "moved account reference");
  for (const key of ["deactivated", "suspended", "deleted"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new TypeError(`Invalid recommendation account ${key} flag.`);
    if (raw[key] === true) profile[key] = true;
  }
  return Object.freeze(profile);
}

function result(
  requestedReference: string,
  evaluatedAt: string,
  inactivityDays: number,
  reason: RecommendationAccountEligibilityReason,
  moveChain: readonly string[],
  resolvedAccount?: RecommendationAccountProfile
): RecommendationAccountEligibilityResult {
  return Object.freeze({
    eligible: reason === "eligible",
    reason,
    requestedReference,
    ...(resolvedAccount === undefined ? {} : { resolvedAccount }),
    moveChain: Object.freeze([...moveChain]),
    evaluatedAt,
    inactivityDays
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

export async function evaluateRecommendationAccountEligibility(input: {
  reference: string;
  resolver: RecommendationAccountProfileResolver;
  evaluatedAt?: string;
  inactivityDays?: number;
  signal?: AbortSignal;
}): Promise<RecommendationAccountEligibilityResult> {
  if (input === null || typeof input !== "object" || input.resolver === null || typeof input.resolver !== "object" || typeof input.resolver.resolve !== "function") {
    throw new TypeError("Invalid recommendation account eligibility input.");
  }
  const requestedReference = text(input.reference, "reference");
  const evaluatedAt = input.evaluatedAt === undefined ? new Date().toISOString() : instant(input.evaluatedAt, "evaluation timestamp");
  const inactivityDays = input.inactivityDays ?? RECOMMENDATION_ACCOUNT_MAX_INACTIVITY_DAYS;
  if (!Number.isSafeInteger(inactivityDays) || inactivityDays < 1 || inactivityDays > 365) {
    throw new TypeError("Invalid recommendation account inactivity window.");
  }
  assertNotAborted(input.signal);

  const visited = new Set<string>();
  const moveChain: string[] = [];
  let reference = requestedReference;
  for (let depth = 0; depth <= MAX_MOVES; depth += 1) {
    assertNotAborted(input.signal);
    if (visited.has(reference)) return result(requestedReference, evaluatedAt, inactivityDays, "move_loop", moveChain);
    visited.add(reference);
    const raw = await input.resolver.resolve(reference, input.signal);
    assertNotAborted(input.signal);
    if (raw === undefined) return result(requestedReference, evaluatedAt, inactivityDays, "unresolved", moveChain);
    const profile = normalizeProfile(raw);
    if (profile.movedTo !== undefined) {
      moveChain.push(profile.uri);
      if (depth === MAX_MOVES) return result(requestedReference, evaluatedAt, inactivityDays, "move_limit", moveChain, profile);
      reference = profile.movedTo;
      continue;
    }
    if (profile.deleted === true) return result(requestedReference, evaluatedAt, inactivityDays, "deleted", moveChain, profile);
    if (profile.deactivated === true) return result(requestedReference, evaluatedAt, inactivityDays, "deactivated", moveChain, profile);
    if (profile.suspended === true) return result(requestedReference, evaluatedAt, inactivityDays, "suspended", moveChain, profile);
    if (profile.lastActivityAt === undefined) return result(requestedReference, evaluatedAt, inactivityDays, "unresolved", moveChain, profile);
    const age = Date.parse(evaluatedAt) - Date.parse(profile.lastActivityAt);
    if (!Number.isFinite(age) || age < 0) return result(requestedReference, evaluatedAt, inactivityDays, "unresolved", moveChain, profile);
    const maximumAge = inactivityDays * 86_400_000;
    return result(requestedReference, evaluatedAt, inactivityDays, age <= maximumAge ? "eligible" : "inactive", moveChain, profile);
  }
  return result(requestedReference, evaluatedAt, inactivityDays, "move_limit", moveChain);
}
