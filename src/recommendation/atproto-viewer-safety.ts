import { hasUnsafeControlCharacter } from "./control-characters.js";
import type { RecommendationProtocolSourceReadAuthorization } from "./protocol-source-adapters.js";

export type RecommendationAtprotoSafetySourceState = "complete" | "incomplete" | "unavailable" | "unsupported";
export interface RecommendationAtprotoSafetySource<T> { state: RecommendationAtprotoSafetySourceState; items: readonly T[]; observedAt?: string }
export interface RecommendationAtprotoViewerState {
  muted: boolean;
  blockedBy: boolean;
  blocking: string | null;
  blockingByList: string | null;
  mutingByList: string | null;
}
export interface RecommendationAtprotoMutedWord { value: string; targets: readonly string[]; actorTarget?: "all" | "exclude-following"; expiresAt?: string }
export interface RecommendationAtprotoLabelPreference { label: string; visibility: "ignore" | "show" | "warn" | "hide" }
export interface RecommendationAtprotoViewerSafetySnapshot {
  subjectDid: string;
  blocks: RecommendationAtprotoSafetySource<string>;
  mutes: RecommendationAtprotoSafetySource<string>;
  mutedLists: RecommendationAtprotoSafetySource<string>;
  mutedWords: RecommendationAtprotoSafetySource<RecommendationAtprotoMutedWord>;
  hiddenPosts: RecommendationAtprotoSafetySource<string>;
  labelPreferences: RecommendationAtprotoSafetySource<RecommendationAtprotoLabelPreference>;
  domainBlocks: RecommendationAtprotoSafetySource<string>;
}
export interface RecommendationAtprotoSafetyCandidate {
  authorDid: string;
  uri?: string;
  text?: string;
  labels?: readonly string[];
  viewer?: RecommendationAtprotoViewerState;
  authorDomain?: string;
  authorIsFollowed?: boolean;
}
export interface RecommendationAtprotoSafetyDecision {
  eligible: boolean;
  warningRequired: boolean;
  evidenceComplete: boolean;
  reasonCodes: readonly string[];
  matchedLabels: readonly string[];
}
export interface RecommendationAtprotoXrpcTransport {
  get(input: { url: string; requiresAuthentication: true; signal?: AbortSignal }): { body: unknown; observedAt: string } | Promise<{ body: unknown; observedAt: string }>;
}

const MAX_ITEMS = 10_000;
const MAX_TEXT = 16_384;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, label: string, max = 2_048): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.trim() !== value || hasUnsafeControlCharacter(value)) throw new TypeError(`Invalid ATProto safety ${label}.`);
  return value;
}
function did(value: unknown): string { const result = text(value, "DID", 512); if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u.test(result)) throw new TypeError("Invalid ATProto safety DID."); return result; }
function instant(value: unknown, label: string): string { const result = text(value, label, 128); if (!Number.isFinite(Date.parse(result))) throw new TypeError(`Invalid ATProto safety ${label}.`); return result; }
function safeServiceUrl(value: unknown): URL {
  let url: URL; try { url = new URL(text(value, "service URL")); } catch { throw new TypeError("Invalid ATProto safety service URL."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || (url.pathname !== "" && url.pathname !== "/") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) throw new TypeError("Invalid ATProto safety service URL.");
  url.pathname = "/"; return url;
}
function authorize(value: RecommendationProtocolSourceReadAuthorization, subjectDid: string): void {
  if (!record(value) || value.status !== "authorized" || value.subjectId !== subjectDid || value.containsPrivateData !== true || value.sourceVisibility === "public" || (value.accessBasis !== "oauth_scope" && value.accessBasis !== "authenticated_api")) throw new TypeError("ATProto safety requires explicit private-data authorization evidence.");
  instant(value.checkedAt, "authorization timestamp");
}
function source<T>(state: RecommendationAtprotoSafetySourceState, items: readonly T[], observedAt?: string): RecommendationAtprotoSafetySource<T> {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new TypeError("Invalid ATProto safety source items.");
  return Object.freeze({ state, items: Object.freeze([...items]), ...(observedAt === undefined ? {} : { observedAt: instant(observedAt, "observation timestamp") }) });
}
export function completeRecommendationAtprotoSafetySource<T>(items: readonly T[], observedAt: string): RecommendationAtprotoSafetySource<T> { return source("complete", items, observedAt); }
export function incompleteRecommendationAtprotoSafetySource<T>(): RecommendationAtprotoSafetySource<T> { return source("incomplete", []); }
export function unsupportedRecommendationAtprotoSafetySource<T>(): RecommendationAtprotoSafetySource<T> { return source("unsupported", []); }

function parseProfileDids(body: unknown): readonly string[] {
  if (!record(body) || !Array.isArray(body.blocks ?? body.mutes)) throw new TypeError("Invalid ATProto safety actor-list response.");
  const raw = (body.blocks ?? body.mutes) as unknown[];
  if (raw.length > MAX_ITEMS) throw new TypeError("Invalid ATProto safety actor-list response.");
  return Object.freeze(raw.map((item) => { if (!record(item)) throw new TypeError("Invalid ATProto safety actor profile."); return did(item.did); }));
}
function listUris(body: unknown): readonly string[] {
  if (!record(body) || !Array.isArray(body.lists) || body.lists.length > MAX_ITEMS) throw new TypeError("Invalid ATProto muted-lists response.");
  return Object.freeze(body.lists.map((item) => { if (!record(item)) throw new TypeError("Invalid ATProto muted list."); return text(item.uri, "list URI", 2_048); }));
}
function preferences(body: unknown): { mutedWords: readonly RecommendationAtprotoMutedWord[]; hiddenPosts: readonly string[]; labelPreferences: readonly RecommendationAtprotoLabelPreference[] } {
  if (!record(body) || !Array.isArray(body.preferences) || body.preferences.length > MAX_ITEMS) throw new TypeError("Invalid ATProto preferences response.");
  const words: RecommendationAtprotoMutedWord[] = []; const hidden = new Set<string>(); const labels: RecommendationAtprotoLabelPreference[] = [];
  for (const pref of body.preferences) {
    if (!record(pref) || typeof pref.$type !== "string") throw new TypeError("Invalid ATProto preference.");
    if (pref.$type === "app.bsky.actor.defs#mutedWordsPref") {
      if (!Array.isArray(pref.items) || pref.items.length > MAX_ITEMS) throw new TypeError("Invalid ATProto muted words preference.");
      for (const item of pref.items) { if (!record(item) || !Array.isArray(item.targets)) throw new TypeError("Invalid ATProto muted word."); const result: RecommendationAtprotoMutedWord = { value: text(item.value, "muted word", 1_024).normalize("NFKC"), targets: Object.freeze(item.targets.map((target) => text(target, "muted-word target", 64))) }; if (item.actorTarget === "all" || item.actorTarget === "exclude-following") result.actorTarget = item.actorTarget; if (item.expiresAt !== undefined) result.expiresAt = instant(item.expiresAt, "muted-word expiration"); words.push(Object.freeze(result)); }
    } else if (pref.$type === "app.bsky.actor.defs#hiddenPostsPref") {
      if (!Array.isArray(pref.items) || pref.items.length > MAX_ITEMS) throw new TypeError("Invalid ATProto hidden posts preference."); for (const uri of pref.items) hidden.add(text(uri, "hidden post URI", 2_048));
    } else if (pref.$type === "app.bsky.actor.defs#contentLabelPref") {
      const visibility = text(pref.visibility, "label visibility", 16); if (!["ignore", "show", "warn", "hide"].includes(visibility)) throw new TypeError("Invalid ATProto label visibility."); labels.push(Object.freeze({ label: text(pref.label, "label", 512), visibility: visibility as RecommendationAtprotoLabelPreference["visibility"] }));
    }
  }
  return { mutedWords: Object.freeze(words), hiddenPosts: Object.freeze([...hidden]), labelPreferences: Object.freeze(labels) };
}
function client(input: { serviceUrl: string; method: string; parse: (body: unknown) => readonly string[]; transport: RecommendationAtprotoXrpcTransport }) {
  const base = safeServiceUrl(input.serviceUrl); if (!record(input.transport) || typeof input.transport.get !== "function") throw new TypeError("Invalid ATProto safety transport.");
  const url = new URL(`/xrpc/${input.method}`, base);
  return Object.freeze({ async read(readInput: { subjectDid: string; authorization: RecommendationProtocolSourceReadAuthorization; signal?: AbortSignal }) { const subjectDid = did(readInput.subjectDid); authorize(readInput.authorization, subjectDid); const response = await input.transport.get({ url: url.toString(), requiresAuthentication: true, ...(readInput.signal === undefined ? {} : { signal: readInput.signal }) }); if (!record(response)) throw new TypeError("Invalid ATProto safety transport response."); return completeRecommendationAtprotoSafetySource(input.parse(response.body), instant(response.observedAt, "observation timestamp")); } });
}
export function createRecommendationAtprotoBlocksClient(input: { serviceUrl: string; transport: RecommendationAtprotoXrpcTransport }) { return client({ ...input, method: "app.bsky.graph.getBlocks", parse: parseProfileDids }); }
export function createRecommendationAtprotoMutesClient(input: { serviceUrl: string; transport: RecommendationAtprotoXrpcTransport }) { return client({ ...input, method: "app.bsky.graph.getMutes", parse: parseProfileDids }); }
export function createRecommendationAtprotoMutedListsClient(input: { serviceUrl: string; transport: RecommendationAtprotoXrpcTransport }) { return client({ ...input, method: "app.bsky.graph.getListMutes", parse: listUris }); }
export function createRecommendationAtprotoPreferencesClient(input: { serviceUrl: string; transport: RecommendationAtprotoXrpcTransport }) {
  const base = safeServiceUrl(input.serviceUrl); if (!record(input.transport) || typeof input.transport.get !== "function") throw new TypeError("Invalid ATProto safety transport."); const url = new URL("/xrpc/app.bsky.actor.getPreferences", base);
  return Object.freeze({ async read(readInput: { subjectDid: string; authorization: RecommendationProtocolSourceReadAuthorization; signal?: AbortSignal }) { const subjectDid = did(readInput.subjectDid); authorize(readInput.authorization, subjectDid); const response = await input.transport.get({ url: url.toString(), requiresAuthentication: true, ...(readInput.signal === undefined ? {} : { signal: readInput.signal }) }); if (!record(response)) throw new TypeError("Invalid ATProto safety transport response."); const observedAt = instant(response.observedAt, "observation timestamp"); const parsed = preferences(response.body); return Object.freeze({ mutedWords: completeRecommendationAtprotoSafetySource(parsed.mutedWords, observedAt), hiddenPosts: completeRecommendationAtprotoSafetySource(parsed.hiddenPosts, observedAt), labelPreferences: completeRecommendationAtprotoSafetySource(parsed.labelPreferences, observedAt) }); } });
}
function completeRequired(value: RecommendationAtprotoSafetySource<unknown>): boolean { return value.state === "complete" || value.state === "unsupported"; }
function wordMatches(candidate: RecommendationAtprotoSafetyCandidate, item: RecommendationAtprotoMutedWord, now: number): boolean { if (item.expiresAt !== undefined && Date.parse(item.expiresAt) <= now) return false; if (item.actorTarget === "exclude-following" && candidate.authorIsFollowed === true) return false; const haystack = (candidate.text ?? "").normalize("NFKC").toLocaleLowerCase("und"); return haystack.includes(item.value.toLocaleLowerCase("und")); }
export function evaluateRecommendationAtprotoViewerSafety(input: { snapshot: RecommendationAtprotoViewerSafetySnapshot; candidate: RecommendationAtprotoSafetyCandidate; now: string }): RecommendationAtprotoSafetyDecision {
  if (!record(input) || !record(input.snapshot) || !record(input.candidate)) throw new TypeError("Invalid ATProto safety evaluation input."); const candidateDid = did(input.candidate.authorDid); const now = Date.parse(instant(input.now, "evaluation timestamp"));
  const required = [input.snapshot.blocks, input.snapshot.mutes, input.snapshot.mutedLists, input.snapshot.mutedWords, input.snapshot.hiddenPosts, input.snapshot.labelPreferences, input.snapshot.domainBlocks]; const evidenceComplete = required.every(completeRequired); const reasons = new Set<string>(); const matchedLabels = new Set<string>(); let eligible = evidenceComplete; let warningRequired = false;
  if (!evidenceComplete) reasons.add("viewer_safety_evidence_incomplete");
  if (input.snapshot.blocks.items.includes(candidateDid)) { eligible = false; reasons.add("viewer_blocked_actor"); }
  if (input.snapshot.mutes.items.includes(candidateDid)) { eligible = false; reasons.add("viewer_muted_actor"); }
  const viewer = input.candidate.viewer; if (viewer !== undefined) { if (viewer.blockedBy) { eligible = false; reasons.add("viewer_blocked_by_actor"); } if (viewer.blocking !== null || viewer.blockingByList !== null) { eligible = false; reasons.add("viewer_blocking_actor"); } if (viewer.muted || viewer.mutingByList !== null) { eligible = false; reasons.add("viewer_muted_actor"); } }
  if (input.candidate.uri !== undefined && input.snapshot.hiddenPosts.items.includes(input.candidate.uri)) { eligible = false; reasons.add("viewer_hidden_post"); }
  if (input.snapshot.mutedWords.items.some((item) => wordMatches(input.candidate, item, now))) { eligible = false; reasons.add("viewer_muted_word"); }
  if (input.snapshot.domainBlocks.state === "complete" && input.candidate.authorDomain !== undefined && input.snapshot.domainBlocks.items.some((domain) => input.candidate.authorDomain === domain || input.candidate.authorDomain?.endsWith(`.${domain}`))) { eligible = false; reasons.add("viewer_blocked_domain"); }
  for (const label of input.candidate.labels ?? []) { const preference = input.snapshot.labelPreferences.items.find((item) => item.label === label); if (preference?.visibility === "hide") { eligible = false; reasons.add("viewer_label_hide"); matchedLabels.add(label); } else if (preference?.visibility === "warn") { warningRequired = true; reasons.add("viewer_label_warn"); matchedLabels.add(label); } }
  return Object.freeze({ eligible, warningRequired, evidenceComplete, reasonCodes: Object.freeze([...reasons]), matchedLabels: Object.freeze([...matchedLabels]) });
}

export type RecommendationAtprotoModerationSuggestionKind = "block_actor" | "mute_actor" | "mute_list" | "add_muted_word" | "hide_post" | "change_label_preference" | "report";
export interface RecommendationAtprotoModerationSuggestion { kind: RecommendationAtprotoModerationSuggestionKind; target: string; reasonCodes: readonly string[]; confidence: number; xrpcMethod: string; requiresExplicitConfirmation: true; automaticallyExecutable: false }
export function createRecommendationAtprotoModerationSuggestion(input: { kind: RecommendationAtprotoModerationSuggestionKind; target: string; reasonCodes: readonly string[]; confidence: number }): RecommendationAtprotoModerationSuggestion {
  if (!record(input) || !Array.isArray(input.reasonCodes) || input.reasonCodes.length === 0 || input.reasonCodes.length > 20 || typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) throw new TypeError("Invalid ATProto moderation suggestion.");
  const methods: Record<RecommendationAtprotoModerationSuggestionKind, string> = { block_actor: "com.atproto.repo.createRecord(app.bsky.graph.block)", mute_actor: "app.bsky.graph.muteActor", mute_list: "app.bsky.graph.muteActorList", add_muted_word: "app.bsky.actor.putPreferences", hide_post: "app.bsky.actor.putPreferences", change_label_preference: "app.bsky.actor.putPreferences", report: "com.atproto.moderation.createReport" };
  return Object.freeze({ kind: input.kind, target: text(input.target, "suggestion target", 2_048), reasonCodes: Object.freeze(input.reasonCodes.map((reason) => text(reason, "reason code", 128))), confidence: input.confidence, xrpcMethod: methods[input.kind], requiresExplicitConfirmation: true, automaticallyExecutable: false });
}
