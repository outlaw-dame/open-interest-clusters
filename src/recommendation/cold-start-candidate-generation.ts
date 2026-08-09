import {
  normalizeRecommendationCandidate,
  type RecommendationCandidate,
  type RecommendationCandidateKind,
  type RecommendationCandidateMetadata,
  type RecommendationCandidateProvenance,
  type RecommendationCandidateVerification
} from "./candidate-domain.js";
import {
  isRecommendationCandidateSourceAdapter,
  readRecommendationCandidateSourceAdapter,
  type RecommendationCandidateSourceAdapter
} from "./candidate-source-adapter.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";
import type { RecommendationInterestTargetKind } from "./interest-signal.js";
import { normalizeRecommendationProfileSnapshot } from "./profile-store-persistence-snapshot.js";
import type { RecommendationProfileEntry, RecommendationProfileSnapshot } from "./profile-store.js";

export const RECOMMENDATION_COLD_START_LANGUAGE_COMPATIBILITY = [
  "not_requested",
  "unknown",
  "compatible",
  "incompatible"
] as const;

export type RecommendationColdStartLanguageCompatibility =
  typeof RECOMMENDATION_COLD_START_LANGUAGE_COMPATIBILITY[number];

export const RECOMMENDATION_COLD_START_SOURCE_FAILURE_CODES = [
  "source_read_failed",
  "source_cancelled"
] as const;

export type RecommendationColdStartSourceFailureCode =
  typeof RECOMMENDATION_COLD_START_SOURCE_FAILURE_CODES[number];

export interface RecommendationColdStartMatchFeatures {
  canonicalInterestIds: readonly string[];
  tags: readonly string[];
  entityIds: readonly string[];
  matchedProfileTargets: readonly RecommendationColdStartMatchedProfileTarget[];
  profileAffinityWeight: number;
  languageCompatibility: RecommendationColdStartLanguageCompatibility;
  matchedLanguages: readonly string[];
}

export interface RecommendationColdStartMatchedProfileTarget {
  kind: "canonical_interest" | "hashtag" | "keyword" | "entity";
  key: string;
  weight: number;
}

export interface RecommendationColdStartGeneratedCandidate {
  candidate: RecommendationCandidate;
  match: RecommendationColdStartMatchFeatures;
}

export interface RecommendationColdStartSourceFailure {
  sourceId: string;
  code: RecommendationColdStartSourceFailureCode;
}

export interface RecommendationColdStartCandidateGenerationInput {
  requestId: string;
  profile: RecommendationProfileSnapshot;
  sources: readonly RecommendationCandidateSourceAdapter[];
  candidateKinds: readonly RecommendationCandidateKind[];
  languages?: readonly string[];
  perSourceLimit?: number;
  maxCandidates?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

export interface RecommendationColdStartCandidateGenerationResult {
  candidates: readonly RecommendationColdStartGeneratedCandidate[];
  failures: readonly RecommendationColdStartSourceFailure[];
  sourceCount: number;
  successfulSourceCount: number;
}

interface ProfileMatchIndex {
  canonicalInterests: ReadonlyMap<string, RecommendationProfileEntry>;
  tags: ReadonlyMap<string, RecommendationProfileEntry>;
  entities: ReadonlyMap<string, RecommendationProfileEntry>;
}

interface SourceReadOutcome {
  sourceId: string;
  candidates: readonly RecommendationCandidate[];
  failure?: RecommendationColdStartSourceFailureCode;
}

const MAX_REQUEST_ID_LENGTH = 512;
const MAX_SOURCES = 64;
const DEFAULT_PER_SOURCE_LIMIT = 250;
const MAX_PER_SOURCE_LIMIT = 1_000;
const DEFAULT_MAX_CANDIDATES = 500;
const MAX_CANDIDATES = 5_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
const MAX_LANGUAGES = 32;
const MAX_LANGUAGE_LENGTH = 64;
const MAX_MERGED_METADATA_VALUES = 128;
const MAX_MERGED_LANGUAGES = 32;
const MAX_MERGED_PROVENANCE = 32;

const MATCHABLE_TARGET_KINDS = new Set<RecommendationInterestTargetKind>([
  "canonical_interest",
  "hashtag",
  "keyword",
  "entity"
]);

const VERIFICATION_STRENGTH: Readonly<Record<RecommendationCandidateVerification["state"], number>> = {
  unverified_hint: 0,
  source_asserted: 1,
  authority_verified: 2,
  canonical: 3
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, message: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maximum ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError(message);
  }
  return value;
}

function positiveSafeInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  message: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(message);
  }
  return value as number;
}

function normalizeLanguages(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_LANGUAGES) {
    throw new TypeError("Invalid cold-start candidate languages.");
  }
  const normalized = value.map((entry) =>
    boundedString(entry, MAX_LANGUAGE_LENGTH, "Invalid cold-start candidate language.").toLocaleLowerCase("en-US")
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("Duplicate cold-start candidate language.");
  }
  return Object.freeze([...normalized].sort());
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

function normalizedTag(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function profileEntryWeight(entry: RecommendationProfileEntry): number {
  return Math.max(0, Math.min(1, entry.score)) * Math.max(0, Math.min(1, entry.confidence));
}

function chooseStrongerProfileEntry(
  left: RecommendationProfileEntry | undefined,
  right: RecommendationProfileEntry
): RecommendationProfileEntry {
  if (left === undefined) return right;
  const leftWeight = profileEntryWeight(left);
  const rightWeight = profileEntryWeight(right);
  if (rightWeight !== leftWeight) return rightWeight > leftWeight ? right : left;
  return right.updatedAt > left.updatedAt ? right : left;
}

function buildProfileMatchIndex(profile: RecommendationProfileSnapshot): ProfileMatchIndex {
  const canonicalInterests = new Map<string, RecommendationProfileEntry>();
  const tags = new Map<string, RecommendationProfileEntry>();
  const entities = new Map<string, RecommendationProfileEntry>();

  for (const entry of profile.entries) {
    if (
      entry.score <= 0 ||
      entry.positiveSignalCount === 0 ||
      !MATCHABLE_TARGET_KINDS.has(entry.target.kind)
    ) {
      continue;
    }

    switch (entry.target.kind) {
      case "canonical_interest":
        canonicalInterests.set(
          entry.target.key,
          chooseStrongerProfileEntry(canonicalInterests.get(entry.target.key), entry)
        );
        break;
      case "hashtag":
      case "keyword": {
        const key = normalizedTag(entry.target.key);
        tags.set(key, chooseStrongerProfileEntry(tags.get(key), entry));
        break;
      }
      case "entity":
        entities.set(entry.target.key, chooseStrongerProfileEntry(entities.get(entry.target.key), entry));
        break;
      default:
        break;
    }
  }

  return { canonicalInterests, tags, entities };
}

function canonicalInterestRequest(profileIndex: ProfileMatchIndex): readonly string[] {
  return Object.freeze([...profileIndex.canonicalInterests.keys()].sort());
}

function intersectKinds(
  requested: readonly RecommendationCandidateKind[],
  source: RecommendationCandidateSourceAdapter
): readonly RecommendationCandidateKind[] {
  return Object.freeze(requested.filter((kind) => source.candidateKinds.includes(kind)));
}

function sourceFailure(sourceId: string, code: RecommendationColdStartSourceFailureCode): SourceReadOutcome {
  return { sourceId, candidates: Object.freeze([]), failure: code };
}

async function readSource(
  source: RecommendationCandidateSourceAdapter,
  input: {
    requestId: string;
    candidateKinds: readonly RecommendationCandidateKind[];
    canonicalInterestIds: readonly string[];
    languages?: readonly string[];
    limit: number;
    signal?: AbortSignal;
  }
): Promise<SourceReadOutcome> {
  assertNotAborted(input.signal);
  const requestedKinds = intersectKinds(input.candidateKinds, source);
  if (requestedKinds.length === 0) {
    return { sourceId: source.id, candidates: Object.freeze([]) };
  }

  try {
    const supportsAbort = source.capabilities.includes("supports_abort");
    const result = await readRecommendationCandidateSourceAdapter(source, {
      requestId: input.requestId,
      candidateKinds: requestedKinds,
      canonicalInterestIds: input.canonicalInterestIds,
      ...(input.languages === undefined ? {} : { languages: input.languages }),
      limit: input.limit,
      ...(supportsAbort && input.signal !== undefined ? { signal: input.signal } : {})
    });
    if (input.signal?.aborted === true) {
      return sourceFailure(source.id, "source_cancelled");
    }
    return { sourceId: source.id, candidates: result.candidates };
  } catch {
    if (input.signal?.aborted === true) {
      return sourceFailure(source.id, "source_cancelled");
    }
    return sourceFailure(source.id, "source_read_failed");
  }
}

function provenanceKey(value: RecommendationCandidateProvenance): string {
  return JSON.stringify([
    value.kind,
    value.sourceId,
    value.sourceItemId ?? "",
    value.curator ?? "",
    value.sourceUrl ?? ""
  ]);
}

function mergeProvenance(group: readonly RecommendationCandidate[]): readonly RecommendationCandidateProvenance[] {
  const byKey = new Map<string, RecommendationCandidateProvenance>();
  for (const candidate of group) {
    for (const provenance of candidate.provenance) {
      const key = provenanceKey(provenance);
      const current = byKey.get(key);
      if (current === undefined || provenance.observedAt > current.observedAt) {
        byKey.set(key, provenance);
      }
    }
  }

  return Object.freeze(
    [...byKey.values()]
      .sort((left, right) =>
        right.observedAt.localeCompare(left.observedAt) || provenanceKey(left).localeCompare(provenanceKey(right))
      )
      .slice(0, MAX_MERGED_PROVENANCE)
  );
}

function unionMetadataValues(
  group: readonly RecommendationCandidate[],
  select: (metadata: RecommendationCandidateMetadata) => readonly string[],
  maximum: number
): readonly string[] {
  const values = new Set<string>();
  for (const candidate of group) {
    for (const value of select(candidate.metadata)) values.add(value);
  }
  return Object.freeze([...values].sort().slice(0, maximum));
}

function compareRepresentative(left: RecommendationCandidate, right: RecommendationCandidate): number {
  const verification = VERIFICATION_STRENGTH[right.verification.state] - VERIFICATION_STRENGTH[left.verification.state];
  if (verification !== 0) return verification;
  const observed = right.observedAt.localeCompare(left.observedAt);
  if (observed !== 0) return observed;
  return (left.uri ?? "").localeCompare(right.uri ?? "");
}

function latestAvailability(group: readonly RecommendationCandidate[]): RecommendationCandidate["availability"] {
  const ordered = [...group].sort((left, right) => {
    const observed = right.observedAt.localeCompare(left.observedAt);
    if (observed !== 0) return observed;
    const rank: Readonly<Record<RecommendationCandidate["availability"], number>> = {
      unknown: 0,
      available: 1,
      unavailable: 2
    };
    return rank[right.availability] - rank[left.availability];
  });
  return ordered[0]?.availability ?? "unknown";
}

function mergeCandidateGroup(group: readonly RecommendationCandidate[]): RecommendationCandidate {
  if (group.length === 0) throw new TypeError("Cannot merge an empty recommendation candidate group.");
  const normalized = group.map((candidate) => normalizeRecommendationCandidate(candidate));
  const representative = [...normalized].sort(compareRepresentative)[0];
  if (representative === undefined) throw new TypeError("Cannot select recommendation candidate representative.");

  for (const candidate of normalized) {
    if (
      candidate.candidateId !== representative.candidateId ||
      candidate.kind !== representative.kind ||
      candidate.protocol !== representative.protocol ||
      candidate.nativeId !== representative.nativeId ||
      candidate.provider !== representative.provider
    ) {
      throw new TypeError("Recommendation candidate identity collision during cold-start merge.");
    }
  }

  const displayName = representative.metadata.displayName ?? normalized.find((entry) => entry.metadata.displayName !== undefined)?.metadata.displayName;
  const summary = representative.metadata.summary ?? normalized.find((entry) => entry.metadata.summary !== undefined)?.metadata.summary;
  const metadata: RecommendationCandidateMetadata = {
    canonicalInterestIds: unionMetadataValues(normalized, (value) => value.canonicalInterestIds, MAX_MERGED_METADATA_VALUES),
    tags: unionMetadataValues(normalized, (value) => value.tags, MAX_MERGED_METADATA_VALUES),
    entityIds: unionMetadataValues(normalized, (value) => value.entityIds, MAX_MERGED_METADATA_VALUES),
    languages: unionMetadataValues(normalized, (value) => value.languages, MAX_MERGED_LANGUAGES),
    ...(displayName === undefined ? {} : { displayName }),
    ...(summary === undefined ? {} : { summary })
  };

  const observedAt = normalized.reduce(
    (latest, candidate) => candidate.observedAt > latest ? candidate.observedAt : latest,
    normalized[0]?.observedAt ?? representative.observedAt
  );

  return normalizeRecommendationCandidate({
    candidateId: representative.candidateId,
    kind: representative.kind,
    protocol: representative.protocol,
    nativeId: representative.nativeId,
    ...(representative.provider === undefined ? {} : { provider: representative.provider }),
    ...(representative.uri === undefined ? {} : { uri: representative.uri }),
    verification: representative.verification,
    availability: latestAvailability(normalized),
    observedAt,
    metadata,
    provenance: mergeProvenance(normalized)
  });
}

function matchedTarget(
  entry: RecommendationProfileEntry
): RecommendationColdStartMatchedProfileTarget {
  if (
    entry.target.kind !== "canonical_interest" &&
    entry.target.kind !== "hashtag" &&
    entry.target.kind !== "keyword" &&
    entry.target.kind !== "entity"
  ) {
    throw new TypeError("Unsupported cold-start matched profile target.");
  }
  return Object.freeze({
    kind: entry.target.kind,
    key: entry.target.key,
    weight: profileEntryWeight(entry)
  });
}

function languageFeatures(
  candidate: RecommendationCandidate,
  requestedLanguages: readonly string[] | undefined
): { compatibility: RecommendationColdStartLanguageCompatibility; matched: readonly string[] } {
  if (requestedLanguages === undefined || requestedLanguages.length === 0) {
    return { compatibility: "not_requested", matched: Object.freeze([]) };
  }
  if (candidate.metadata.languages.length === 0) {
    return { compatibility: "unknown", matched: Object.freeze([]) };
  }
  const requested = new Set(requestedLanguages.map((value) => value.toLocaleLowerCase("en-US")));
  const matched = candidate.metadata.languages
    .filter((value) => requested.has(value.toLocaleLowerCase("en-US")))
    .sort();
  return {
    compatibility: matched.length === 0 ? "incompatible" : "compatible",
    matched: Object.freeze(matched)
  };
}

function matchCandidate(
  candidate: RecommendationCandidate,
  profileIndex: ProfileMatchIndex,
  languages: readonly string[] | undefined
): RecommendationColdStartMatchFeatures | undefined {
  const canonicalInterestIds: string[] = [];
  const tags: string[] = [];
  const entityIds: string[] = [];
  const targetByIdentity = new Map<string, RecommendationProfileEntry>();

  for (const interestId of candidate.metadata.canonicalInterestIds) {
    const entry = profileIndex.canonicalInterests.get(interestId);
    if (entry !== undefined) {
      canonicalInterestIds.push(interestId);
      targetByIdentity.set(`${entry.target.kind}:${entry.target.key}`, entry);
    }
  }

  for (const tag of candidate.metadata.tags) {
    const entry = profileIndex.tags.get(normalizedTag(tag));
    if (entry !== undefined) {
      tags.push(tag);
      targetByIdentity.set(`${entry.target.kind}:${entry.target.key}`, entry);
    }
  }

  for (const entityId of candidate.metadata.entityIds) {
    const entry = profileIndex.entities.get(entityId);
    if (entry !== undefined) {
      entityIds.push(entityId);
      targetByIdentity.set(`${entry.target.kind}:${entry.target.key}`, entry);
    }
  }

  if (targetByIdentity.size === 0) return undefined;

  const matchedProfileTargets = [...targetByIdentity.values()]
    .map((entry) => matchedTarget(entry))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key));
  const profileAffinityWeight = matchedProfileTargets.reduce((total, target) => total + target.weight, 0);
  const language = languageFeatures(candidate, languages);

  return Object.freeze({
    canonicalInterestIds: Object.freeze([...canonicalInterestIds].sort()),
    tags: Object.freeze([...tags].sort()),
    entityIds: Object.freeze([...entityIds].sort()),
    matchedProfileTargets: Object.freeze(matchedProfileTargets),
    profileAffinityWeight,
    languageCompatibility: language.compatibility,
    matchedLanguages: language.matched
  });
}

function compareGeneratedCandidates(
  left: RecommendationColdStartGeneratedCandidate,
  right: RecommendationColdStartGeneratedCandidate
): number {
  const targetCount = right.match.matchedProfileTargets.length - left.match.matchedProfileTargets.length;
  if (targetCount !== 0) return targetCount;
  const affinity = right.match.profileAffinityWeight - left.match.profileAffinityWeight;
  if (affinity !== 0) return affinity;
  const languageRank: Readonly<Record<RecommendationColdStartLanguageCompatibility, number>> = {
    not_requested: 1,
    unknown: 1,
    compatible: 2,
    incompatible: 0
  };
  const language = languageRank[right.match.languageCompatibility] - languageRank[left.match.languageCompatibility];
  if (language !== 0) return language;
  const verification = VERIFICATION_STRENGTH[right.candidate.verification.state] - VERIFICATION_STRENGTH[left.candidate.verification.state];
  if (verification !== 0) return verification;
  const observed = right.candidate.observedAt.localeCompare(left.candidate.observedAt);
  if (observed !== 0) return observed;
  return left.candidate.candidateId.localeCompare(right.candidate.candidateId);
}

function validateInput(input: RecommendationColdStartCandidateGenerationInput): {
  requestId: string;
  profile: RecommendationProfileSnapshot;
  sources: readonly RecommendationCandidateSourceAdapter[];
  candidateKinds: readonly RecommendationCandidateKind[];
  languages?: readonly string[];
  perSourceLimit: number;
  maxCandidates: number;
  concurrency: number;
  signal?: AbortSignal;
} {
  if (!isRecord(input)) throw new TypeError("Invalid cold-start candidate generation input.");
  const requestId = boundedString(input.requestId, MAX_REQUEST_ID_LENGTH, "Invalid cold-start candidate request ID.");
  const profile = normalizeRecommendationProfileSnapshot(input.profile, { pruneExpiredEntries: false });
  if (!Array.isArray(input.sources) || input.sources.length > MAX_SOURCES) {
    throw new TypeError("Invalid cold-start candidate sources.");
  }
  const sources = input.sources.map((source) => {
    if (!isRecommendationCandidateSourceAdapter(source)) {
      throw new TypeError("Invalid cold-start candidate source adapter.");
    }
    return source;
  });
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new TypeError("Duplicate cold-start candidate source adapter ID.");
  }
  if (!Array.isArray(input.candidateKinds) || input.candidateKinds.length === 0) {
    throw new TypeError("Invalid cold-start candidate requested kinds.");
  }
  const candidateKinds = Object.freeze([...new Set(input.candidateKinds)]);
  if (candidateKinds.length !== input.candidateKinds.length) {
    throw new TypeError("Duplicate cold-start candidate requested kind.");
  }
  const languages = normalizeLanguages(input.languages);
  const perSourceLimit = positiveSafeInteger(
    input.perSourceLimit,
    DEFAULT_PER_SOURCE_LIMIT,
    MAX_PER_SOURCE_LIMIT,
    "Invalid cold-start per-source limit."
  );
  const maxCandidates = positiveSafeInteger(
    input.maxCandidates,
    DEFAULT_MAX_CANDIDATES,
    MAX_CANDIDATES,
    "Invalid cold-start maximum candidates."
  );
  const concurrency = positiveSafeInteger(
    input.concurrency,
    DEFAULT_CONCURRENCY,
    MAX_CONCURRENCY,
    "Invalid cold-start source concurrency."
  );
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new TypeError("Invalid cold-start abort signal.");
  }

  return {
    requestId,
    profile,
    sources: Object.freeze(sources),
    candidateKinds,
    ...(languages === undefined ? {} : { languages }),
    perSourceLimit,
    maxCandidates,
    concurrency,
    ...(input.signal === undefined ? {} : { signal: input.signal })
  };
}

export async function generateRecommendationColdStartCandidates(
  rawInput: RecommendationColdStartCandidateGenerationInput
): Promise<RecommendationColdStartCandidateGenerationResult> {
  const input = validateInput(rawInput);
  assertNotAborted(input.signal);
  const profileIndex = buildProfileMatchIndex(input.profile);
  const canonicalInterestIds = canonicalInterestRequest(profileIndex);

  if (input.sources.length === 0) {
    return Object.freeze({
      candidates: Object.freeze([]),
      failures: Object.freeze([]),
      sourceCount: 0,
      successfulSourceCount: 0
    });
  }

  const outcomes: SourceReadOutcome[] = new Array(input.sources.length);
  let nextIndex = 0;
  const workerCount = Math.min(input.concurrency, input.sources.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (input.signal?.aborted === true) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= input.sources.length) return;
      const source = input.sources[index];
      if (source === undefined) return;
      outcomes[index] = await readSource(source, {
        requestId: input.requestId,
        candidateKinds: input.candidateKinds,
        canonicalInterestIds,
        ...(input.languages === undefined ? {} : { languages: input.languages }),
        limit: input.perSourceLimit,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
    }
  });

  await Promise.all(workers);
  assertNotAborted(input.signal);

  const candidateGroups = new Map<string, RecommendationCandidate[]>();
  const failures: RecommendationColdStartSourceFailure[] = [];
  let successfulSourceCount = 0;

  for (const outcome of outcomes) {
    if (outcome === undefined) continue;
    if (outcome.failure !== undefined) {
      failures.push(Object.freeze({ sourceId: outcome.sourceId, code: outcome.failure }));
      continue;
    }
    successfulSourceCount += 1;
    for (const candidate of outcome.candidates) {
      const group = candidateGroups.get(candidate.candidateId) ?? [];
      group.push(candidate);
      candidateGroups.set(candidate.candidateId, group);
    }
  }

  const generated: RecommendationColdStartGeneratedCandidate[] = [];
  for (const group of candidateGroups.values()) {
    const candidate = mergeCandidateGroup(group);
    const match = matchCandidate(candidate, profileIndex, input.languages);
    if (match === undefined) continue;
    generated.push(Object.freeze({ candidate, match }));
  }

  generated.sort(compareGeneratedCandidates);
  const candidates = Object.freeze(generated.slice(0, input.maxCandidates));
  failures.sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.code.localeCompare(right.code));

  return Object.freeze({
    candidates,
    failures: Object.freeze(failures),
    sourceCount: input.sources.length,
    successfulSourceCount
  });
}
