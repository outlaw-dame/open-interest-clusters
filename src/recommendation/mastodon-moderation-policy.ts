import { hasUnsafeControlCharacter } from "./control-characters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";
import type {
  RecommendationMastodonSafetyCandidate,
  RecommendationMastodonSafetyDecision,
  RecommendationMastodonViewerSafetySnapshot,
  RecommendationMastodonFilterContext
} from "./mastodon-viewer-safety.js";
import { evaluateRecommendationMastodonViewerSafety } from "./mastodon-viewer-safety.js";

export interface RecommendationMastodonRelationship {
  id: string;
  following: boolean;
  followedBy: boolean;
  blocking: boolean;
  blockedBy: boolean;
  muting: boolean;
  mutingNotifications: boolean;
  domainBlocking: boolean;
  requested: boolean;
}

export interface RecommendationMastodonRelationshipsTransport {
  get(input: { url: string; requiresAuthentication: true; signal?: AbortSignal }):
    | { body: unknown; observedAt: string }
    | Promise<{ body: unknown; observedAt: string }>;
}

export interface RecommendationMastodonRelationshipReadInput {
  subjectId: string;
  authorization: RecommendationProtocolSourceReadAuthorization;
  grantedScopes: readonly string[];
  accountIds: readonly string[];
  signal?: AbortSignal;
}

export interface RecommendationMastodonRelationshipPage {
  items: readonly RecommendationMastodonRelationship[];
  observedAt: string;
}

export interface RecommendationMastodonMandatorySafetyDecision extends RecommendationMastodonSafetyDecision {
  safetyEvidenceComplete: boolean;
}

export type RecommendationMastodonModerationSuggestionKind =
  | "mute_account"
  | "block_account"
  | "block_domain"
  | "create_keyword_filter"
  | "report_account";

export interface RecommendationMastodonModerationSuggestion {
  kind: RecommendationMastodonModerationSuggestionKind;
  targetId: string;
  reasonCodes: readonly string[];
  confidence: number;
  requiredScope: "write:mutes" | "write:blocks" | "write:filters" | "write:reports";
  requiresExplicitConfirmation: true;
  automaticallyExecutable: false;
}

export interface RecommendationMastodonModerationEvidence {
  targetId: string;
  repeatedUnwantedContentCount?: number;
  repeatedHarassmentCount?: number;
  repeatedSpamCount?: number;
  severeSafetyIncidentCount?: number;
  matchingHiddenFilterCount?: number;
  domainWideAffectedAccountCount?: number;
}

const MAX_ACCOUNT_IDS = 80;
const MAX_ID = 512;
const MAX_SCOPES = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, label: string, max = MAX_ID): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.trim() !== value || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid Mastodon moderation ${label}.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 128);
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`Invalid Mastodon moderation ${label}.`);
  return normalized;
}

function safeBaseUrl(value: unknown): URL {
  let url: URL;
  try { url = new URL(boundedText(value, "base URL", 2_048)); } catch { throw new TypeError("Invalid Mastodon moderation base URL."); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" ||
      (url.pathname !== "" && url.pathname !== "/") || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) {
    throw new TypeError("Invalid Mastodon moderation base URL.");
  }
  url.pathname = "/";
  return url;
}

function hasScope(input: readonly string[], required: string): boolean {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SCOPES) return false;
  return input.some((scope) => scope === required || scope === "read" || scope === "read:all");
}

function authorize(input: RecommendationMastodonRelationshipReadInput): void {
  const authorization = input.authorization;
  if (!isRecord(authorization) || authorization.status !== "authorized" || authorization.subjectId !== input.subjectId ||
      authorization.containsPrivateData !== true || authorization.sourceVisibility === "public" ||
      (authorization.accessBasis !== "oauth_scope" && authorization.accessBasis !== "authenticated_api")) {
    throw new TypeError("Mastodon relationships require explicit private-data authorization evidence.");
  }
  timestamp(authorization.checkedAt, "authorization timestamp");
  if (!hasScope(input.grantedScopes, "read:follows")) throw new TypeError("Mastodon relationships require read:follows authorization.");
}

function parseRelationship(value: unknown): RecommendationMastodonRelationship {
  if (!isRecord(value)) throw new TypeError("Invalid Mastodon relationship.");
  const booleanField = (key: string): boolean => {
    if (typeof value[key] !== "boolean") throw new TypeError(`Invalid Mastodon relationship ${key}.`);
    return value[key];
  };
  return Object.freeze({
    id: boundedText(value.id, "relationship account ID"),
    following: booleanField("following"),
    followedBy: booleanField("followed_by"),
    blocking: booleanField("blocking"),
    blockedBy: booleanField("blocked_by"),
    muting: booleanField("muting"),
    mutingNotifications: booleanField("muting_notifications"),
    domainBlocking: booleanField("domain_blocking"),
    requested: booleanField("requested")
  });
}

export function createRecommendationMastodonRelationshipsClient(input: {
  baseUrl: string;
  transport: RecommendationMastodonRelationshipsTransport;
  maxAccountIds?: number;
}) {
  const baseUrl = safeBaseUrl(input.baseUrl);
  if (!isRecord(input.transport) || typeof input.transport.get !== "function") throw new TypeError("Invalid Mastodon relationships transport.");
  const maxAccountIds = input.maxAccountIds ?? MAX_ACCOUNT_IDS;
  if (!Number.isSafeInteger(maxAccountIds) || maxAccountIds < 1 || maxAccountIds > MAX_ACCOUNT_IDS) throw new TypeError("Invalid Mastodon relationships account limit.");

  return Object.freeze({
    async read(readInput: RecommendationMastodonRelationshipReadInput): Promise<RecommendationMastodonRelationshipPage> {
      if (!isRecord(readInput)) throw new TypeError("Invalid Mastodon relationships read input.");
      boundedText(readInput.subjectId, "relationship subject ID");
      authorize(readInput);
      if (!Array.isArray(readInput.accountIds) || readInput.accountIds.length === 0 || readInput.accountIds.length > maxAccountIds) {
        throw new TypeError("Invalid Mastodon relationships account IDs.");
      }
      const ids = readInput.accountIds.map((id) => boundedText(id, "relationship account ID"));
      if (new Set(ids).size !== ids.length) throw new TypeError("Duplicate Mastodon relationship account ID.");
      const url = new URL("/api/v1/accounts/relationships", baseUrl);
      for (const id of ids) url.searchParams.append("id[]", id);
      const response = await input.transport.get({
        url: url.toString(),
        requiresAuthentication: true,
        ...(readInput.signal === undefined ? {} : { signal: readInput.signal })
      });
      if (!isRecord(response) || !Array.isArray(response.body) || response.body.length !== ids.length) throw new TypeError("Invalid Mastodon relationships response.");
      const items = response.body.map(parseRelationship);
      const returnedIds = new Set(items.map((item) => item.id));
      if (returnedIds.size !== items.length || ids.some((id) => !returnedIds.has(id))) throw new TypeError("Mastodon relationships response does not match requested accounts.");
      return Object.freeze({ items: Object.freeze(items), observedAt: timestamp(response.observedAt, "relationships observation timestamp") });
    }
  });
}

export function evaluateRecommendationMastodonMandatorySafety(input: {
  snapshot: RecommendationMastodonViewerSafetySnapshot | null;
  relationship: RecommendationMastodonRelationship | null;
  candidate: RecommendationMastodonSafetyCandidate;
  now: string;
  requireCompleteEvidence?: boolean;
}): RecommendationMastodonMandatorySafetyDecision {
  if (!isRecord(input) || !isRecord(input.candidate)) throw new TypeError("Invalid Mastodon mandatory safety input.");
  const requireCompleteEvidence = input.requireCompleteEvidence ?? true;
  const evidenceComplete = input.snapshot !== null && input.relationship !== null;
  if (requireCompleteEvidence && !evidenceComplete) {
    return Object.freeze({
      eligible: false,
      mediaEligible: false,
      warningRequired: false,
      reasonCodes: Object.freeze(["viewer_safety_evidence_incomplete"]),
      matchedFilterIds: Object.freeze([]),
      safetyEvidenceComplete: false
    });
  }

  const snapshotDecision = input.snapshot === null
    ? { eligible: true, mediaEligible: true, warningRequired: false, reasonCodes: [] as string[], matchedFilterIds: [] as string[] }
    : evaluateRecommendationMastodonViewerSafety({ snapshot: input.snapshot, candidate: input.candidate, now: input.now });
  const reasons = new Set(snapshotDecision.reasonCodes);
  let eligible = snapshotDecision.eligible;
  if (input.relationship !== null) {
    if (input.relationship.blocking) { eligible = false; reasons.add("viewer_relationship_blocking"); }
    if (input.relationship.blockedBy) { eligible = false; reasons.add("viewer_relationship_blocked_by"); }
    if (input.relationship.muting) { eligible = false; reasons.add("viewer_relationship_muting"); }
    if (input.relationship.domainBlocking) { eligible = false; reasons.add("viewer_relationship_domain_blocking"); }
  }
  return Object.freeze({
    eligible,
    mediaEligible: snapshotDecision.mediaEligible,
    warningRequired: snapshotDecision.warningRequired,
    reasonCodes: Object.freeze([...reasons]),
    matchedFilterIds: snapshotDecision.matchedFilterIds,
    safetyEvidenceComplete: evidenceComplete
  });
}

function count(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new TypeError(`Invalid Mastodon moderation ${label}.`);
  return value as number;
}

export function deriveRecommendationMastodonModerationSuggestions(
  evidence: RecommendationMastodonModerationEvidence
): readonly RecommendationMastodonModerationSuggestion[] {
  if (!isRecord(evidence)) throw new TypeError("Invalid Mastodon moderation evidence.");
  const targetId = boundedText(evidence.targetId, "suggestion target ID");
  const unwanted = count(evidence.repeatedUnwantedContentCount, "unwanted-content count");
  const harassment = count(evidence.repeatedHarassmentCount, "harassment count");
  const spam = count(evidence.repeatedSpamCount, "spam count");
  const severe = count(evidence.severeSafetyIncidentCount, "severe-safety count");
  const hiddenFilters = count(evidence.matchingHiddenFilterCount, "hidden-filter count");
  const affectedAccounts = count(evidence.domainWideAffectedAccountCount, "domain-wide account count");
  const suggestions: RecommendationMastodonModerationSuggestion[] = [];
  const add = (kind: RecommendationMastodonModerationSuggestionKind, requiredScope: RecommendationMastodonModerationSuggestion["requiredScope"], reasons: string[], confidence: number) => {
    suggestions.push(Object.freeze({ kind, targetId, reasonCodes: Object.freeze(reasons), confidence, requiredScope, requiresExplicitConfirmation: true, automaticallyExecutable: false }));
  };

  if (unwanted >= 3 || hiddenFilters >= 5) add("mute_account", "write:mutes", ["repeated_user-unwanted_content"], Math.min(0.9, 0.55 + 0.05 * Math.max(unwanted, hiddenFilters)));
  if (harassment >= 2 || severe >= 1) add("block_account", "write:blocks", [severe >= 1 ? "severe_safety_incident" : "repeated_harassment"], severe >= 1 ? 0.9 : 0.75);
  if ((spam >= 5 || severe >= 2) && affectedAccounts >= 3) add("block_domain", "write:blocks", ["cross-account_domain_pattern"], Math.min(0.95, 0.65 + affectedAccounts * 0.03));
  if (hiddenFilters >= 3) add("create_keyword_filter", "write:filters", ["repeated_hidden_filter_matches"], Math.min(0.85, 0.55 + hiddenFilters * 0.04));
  if (harassment >= 3 || severe >= 1) add("report_account", "write:reports", [severe >= 1 ? "severe_safety_incident" : "repeated_harassment"], severe >= 1 ? 0.9 : 0.8);
  return Object.freeze(suggestions);
}

export function recommendationMastodonFilterContextForSurface(surface: "home" | "notifications" | "public" | "thread" | "account"): RecommendationMastodonFilterContext {
  return surface;
}
