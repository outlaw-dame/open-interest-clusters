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

function providerForActorUri(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError("Invalid curated account-set member actor URI.");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("Invalid curated account-set member actor URI.");
  }
  return parsed.hostname.toLocaleLowerCase("en-US");
}

function provenanceForMember(
  set: RecommendationCuratedAccountSet,
  member: RecommendationCuratedAccountMember
): RecommendationCandidateProvenance {
  return Object.freeze({
    kind: "curated_account_set",
    sourceId: `curated-set:v1:${sha256Hex(`${set.provider}:${set.id}`)}`,
    sourceItemId: member.accountId,
    curator: set.curatorUri ?? set.curatorId,
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
      ...(displayName === undefined ? {} : { displayName })
    },
    provenance
  });
}

function candidateForMember(
  set: RecommendationCuratedAccountSet,
  member: RecommendationCuratedAccountMember
): RecommendationCandidate | undefined {
  if (member.state !== "accepted" || member.accountUri === undefined) return undefined;
  const provider = providerForActorUri(member.accountUri);
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
  if (!query.candidateKinds.includes("account")) return { candidates: Object.freeze([]) };
  const requestedLanguages = query.languages === undefined
    ? undefined
    : new Set(query.languages.map((value) => value.toLocaleLowerCase("en-US")));
  const filtered = requestedLanguages === undefined
    ? candidates
    : candidates.filter((candidate) =>
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

  return Object.freeze({
    id,
    protocols: Object.freeze(["activitypub"]),
    candidateKinds: Object.freeze(["account"]),
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
    capabilities: Object.freeze(["discover", "returns_public_metadata"]),
    read(query: RecommendationCandidateSourceAdapterQuery) {
      return readCandidates(candidates, query);
    }
  });
}
