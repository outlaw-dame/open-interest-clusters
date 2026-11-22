import { sha256Hex } from "../runtime/hash.js";
import {
  createRecommendationCandidateId,
  normalizeRecommendationCandidate,
  type RecommendationCandidate,
  type RecommendationCandidateProvenance
} from "./candidate-domain.js";
import type {
  RecommendationCandidateSourceAdapter,
  RecommendationCandidateSourceAdapterQuery
} from "./candidate-source-adapter.js";
import type {
  RecommendationCuratedAccountMember,
  RecommendationCuratedAccountSet
} from "./activitypub-curated-account-sets.js";
import { hasUnsafeControlCharacter } from "./control-characters.js";

export interface RecommendationCuratedAccountSetCandidateSourceInput {
  id: string;
  sets: readonly RecommendationCuratedAccountSet[];
}

const MAX_ADAPTER_ID_LENGTH = 256;
const MAX_SETS = 1_000;
const MAX_CANDIDATES = 10_000;
const MAX_METADATA_VALUES = 128;
const MAX_PROVENANCE = 32;
// Mastodon allows at most 150 items per collection. A set above that is not a pack we can bind.
const MAX_STARTER_PACK_MEMBERS = 150;

function boundedId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > MAX_ADAPTER_ID_LENGTH ||
    hasUnsafeControlCharacter(value)
  ) {
    throw new TypeError("Invalid curated account-set candidate source ID.");
  }
  return value;
}

function hostForHttpsUri(uri: string, message: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError(message);
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new TypeError(message);
  }
  return parsed.hostname.toLocaleLowerCase("en-US");
}

/** Source ID stamped on every candidate that came from the given curated set. */
export function createRecommendationCuratedAccountSetSourceId(provider: string, setId: string): string {
  return `curated-set:v1:${sha256Hex(`${provider}:${setId}`)}`;
}

function provenanceForMember(
  set: RecommendationCuratedAccountSet,
  member: RecommendationCuratedAccountMember
): RecommendationCandidateProvenance {
  return Object.freeze({
    kind: "curated_account_set",
    sourceId: createRecommendationCuratedAccountSetSourceId(set.provider, set.id),
    sourceItemId: member.accountId,
    curator: set.curatorId,
    sourceUrl: set.url,
    observedAt: set.observedAt,
    trustBoundary: set.trustBoundary
  });
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

function mergeCandidate(
  current: RecommendationCandidate | undefined,
  incoming: RecommendationCandidate
): RecommendationCandidate {
  if (current === undefined) return incoming;
  const tags = Object.freeze(
    [...new Set([...current.metadata.tags, ...incoming.metadata.tags])]
      .sort()
      .slice(0, MAX_METADATA_VALUES)
  );
  const provenanceByKey = new Map<string, RecommendationCandidateProvenance>();
  for (const entry of [...current.provenance, ...incoming.provenance]) {
    const key = provenanceKey(entry);
    const existing = provenanceByKey.get(key);
    if (existing === undefined || entry.observedAt > existing.observedAt) {
      provenanceByKey.set(key, entry);
    }
  }
  const provenance = Object.freeze(
    [...provenanceByKey.values()]
      .sort((left, right) =>
        right.observedAt.localeCompare(left.observedAt) || provenanceKey(left).localeCompare(provenanceKey(right))
      )
      .slice(0, MAX_PROVENANCE)
  );
  const observedAt = current.observedAt >= incoming.observedAt ? current.observedAt : incoming.observedAt;
  const displayName = current.metadata.displayName ?? incoming.metadata.displayName;
  const summary = current.metadata.summary ?? incoming.metadata.summary;

  return normalizeRecommendationCandidate({
    candidateId: current.candidateId,
    kind: current.kind,
    protocol: current.protocol,
    nativeId: current.nativeId,
    ...(current.provider === undefined ? {} : { provider: current.provider }),
    ...(current.uri === undefined ? {} : { uri: current.uri }),
    verification: current.verification,
    availability: "unknown",
    observedAt,
    metadata: {
      canonicalInterestIds: [],
      tags,
      entityIds: [],
      languages: [],
      ...(displayName === undefined ? {} : { displayName }),
      ...(summary === undefined ? {} : { summary })
    },
    provenance
  });
}

function candidateForMember(
  set: RecommendationCuratedAccountSet,
  member: RecommendationCuratedAccountMember
): RecommendationCandidate | undefined {
  if (member.state !== "accepted" || member.accountUri === undefined) return undefined;
  const provider = hostForHttpsUri(member.accountUri, "Invalid curated account-set member actor URI.");
  const candidateId = createRecommendationCandidateId({
    kind: "account",
    protocol: "activitypub",
    nativeId: member.accountUri,
    provider
  });
  return normalizeRecommendationCandidate({
    candidateId,
    kind: "account",
    protocol: "activitypub",
    nativeId: member.accountUri,
    provider,
    uri: member.accountUri,
    verification: { state: "source_asserted" },
    availability: "unknown",
    observedAt: set.observedAt,
    metadata: {
      canonicalInterestIds: [],
      tags: set.hashtags,
      entityIds: [],
      languages: [],
      ...(member.handle === undefined ? {} : { displayName: member.handle })
    },
    provenance: [provenanceForMember(set, member)]
  });
}

function acceptedMemberCount(set: RecommendationCuratedAccountSet): number {
  return set.members.filter((member) => member.state === "accepted" && member.accountUri !== undefined).length;
}

/**
 * The set itself as a starter-pack candidate. It stays a source-asserted hint: only the provider
 * hosting the set can verify it, and the member list is not copied here (members are separate
 * account candidates that carry their own consent provenance).
 */
function starterPackForSet(set: RecommendationCuratedAccountSet): RecommendationCandidate | undefined {
  const accepted = acceptedMemberCount(set);
  if (accepted === 0 || accepted > MAX_STARTER_PACK_MEMBERS) return undefined;
  const provider = hostForHttpsUri(set.url, "Invalid curated account-set URL.");
  const candidateId = createRecommendationCandidateId({
    kind: "starter_pack",
    protocol: "activitypub",
    nativeId: set.url,
    provider
  });
  return normalizeRecommendationCandidate({
    candidateId,
    kind: "starter_pack",
    protocol: "activitypub",
    nativeId: set.url,
    provider,
    uri: set.url,
    verification: { state: "source_asserted" },
    availability: "unknown",
    observedAt: set.observedAt,
    metadata: {
      canonicalInterestIds: [],
      tags: set.hashtags,
      entityIds: [],
      languages: [],
      displayName: set.name,
      ...(set.description === undefined ? {} : { summary: set.description })
    },
    provenance: [{
      kind: "curated_account_set",
      sourceId: createRecommendationCuratedAccountSetSourceId(set.provider, set.id),
      sourceItemId: set.id,
      curator: set.curatorId,
      sourceUrl: set.url,
      observedAt: set.observedAt,
      trustBoundary: set.trustBoundary
    }]
  });
}

function buildCandidates(sets: readonly RecommendationCuratedAccountSet[]): readonly RecommendationCandidate[] {
  if (!Array.isArray(sets) || sets.length > MAX_SETS) {
    throw new TypeError("Invalid curated account-set candidate source sets.");
  }
  const byId = new Map<string, RecommendationCandidate>();
  for (const set of sets) {
    if (
      set === null ||
      typeof set !== "object" ||
      set.discoverable !== true ||
      set.sensitive === true ||
      !Array.isArray(set.members) ||
      !Array.isArray(set.hashtags)
    ) {
      continue;
    }
    const pack = starterPackForSet(set);
    if (pack !== undefined) byId.set(pack.candidateId, mergeCandidate(byId.get(pack.candidateId), pack));
    for (const member of set.members) {
      const candidate = candidateForMember(set, member);
      if (candidate === undefined) continue;
      byId.set(candidate.candidateId, mergeCandidate(byId.get(candidate.candidateId), candidate));
      if (byId.size > MAX_CANDIDATES) {
        throw new TypeError("Curated account-set candidate source contains too many candidates.");
      }
    }
  }
  return Object.freeze([...byId.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId)));
}

function readCandidates(
  candidates: readonly RecommendationCandidate[],
  query: RecommendationCandidateSourceAdapterQuery
): { candidates: readonly RecommendationCandidate[] } {
  const kinds = new Set<string>(query.candidateKinds);
  const ofRequestedKind = candidates.filter((candidate) => kinds.has(candidate.kind));
  const requestedLanguages = query.languages === undefined
    ? undefined
    : new Set(query.languages.map((value) => value.toLocaleLowerCase("en-US")));
  const filtered = requestedLanguages === undefined
    ? ofRequestedKind
    : ofRequestedKind.filter((candidate) =>
        candidate.metadata.languages.length === 0 ||
        candidate.metadata.languages.some((language) => requestedLanguages.has(language.toLocaleLowerCase("en-US")))
      );
  return Object.freeze({ candidates: Object.freeze(filtered.slice(0, query.limit ?? 250)) });
}

export function createRecommendationCuratedAccountSetCandidateSourceAdapter(
  input: RecommendationCuratedAccountSetCandidateSourceInput
): RecommendationCandidateSourceAdapter {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Invalid curated account-set candidate source input.");
  }
  const id = boundedId(input.id);
  const candidates = buildCandidates(input.sets);

  const adapter: RecommendationCandidateSourceAdapter = {
    id,
    protocols: Object.freeze(["activitypub"] as const),
    candidateKinds: Object.freeze(["account", "starter_pack"] as const),
    authority: "curated_public",
    transport: "local",
    privacy: Object.freeze({
      sourceVisibility: "local_only",
      accessBasis: "owner",
      containsPrivateData: false,
      containsThirdPartyData: true,
      serverSideProcessing: false,
      providerPolicyAllowsProcessing: true
    }),
    capabilities: Object.freeze(["discover", "returns_public_metadata"] as const),
    read(query: RecommendationCandidateSourceAdapterQuery) {
      return readCandidates(candidates, query);
    }
  };
  return Object.freeze(adapter);
}
