import { setTimeout as sleep } from "node:timers/promises";
import type { EntityGraphResolver, EntityRelation, EntityRelationEdge } from "./types.js";
import type { EntityGraphCacheStore } from "./cache.js";

interface ResolverCacheEntry {
  edges: EntityRelationEdge[];
  expiresAt: number;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchLikeResponse>;

export interface WikidataGraphResolverOptions {
  endpoint?: string;
  language?: string;
  maxDepth?: number;
  maxBatchSize?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  retryAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  hopDecay?: number;
  fetchImpl?: FetchLike;
  persistentCache?: EntityGraphCacheStore;
}

const ENTITY_ID_PATTERN = /^Q[1-9][0-9]*$/;

const PROPERTY_TO_RELATION: Record<string, { relation: EntityRelation; weight: number }> = {
  P31: { relation: "instance_of", weight: 3 },
  P279: { relation: "subclass_of", weight: 2 },
  P361: { relation: "part_of", weight: 2 },
  P176: { relation: "manufacturer", weight: 2 },
  P178: { relation: "developer", weight: 2 },
  P123: { relation: "publisher", weight: 2 },
  P127: { relation: "owned_by", weight: 2 },
  P1441: { relation: "fandom_of", weight: 1 },
  P460: { relation: "related_to", weight: 1 }
};

function isEntityId(value: string): boolean {
  return ENTITY_ID_PATTERN.test(value);
}

function jitteredBackoff(delayMs: number, maxDelayMs: number): number {
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(delayMs * 0.2)));
  return Math.min(maxDelayMs, delayMs + jitter);
}

function cloneEdges(edges: readonly EntityRelationEdge[]): EntityRelationEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

export class WikidataGraphResolver implements EntityGraphResolver {
  private readonly endpoint: string;
  private readonly language: string;
  private readonly maxDepth: number;
  private readonly maxBatchSize: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly retryAttempts: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly hopDecay: number;
  private readonly fetchImpl: FetchLike;
  private readonly persistentCache?: EntityGraphCacheStore;
  private readonly cache = new Map<string, ResolverCacheEntry>();

  public constructor(options: WikidataGraphResolverOptions = {}) {
    this.endpoint = options.endpoint ?? "https://www.wikidata.org/w/api.php";
    this.language = options.language ?? "en";
    this.maxDepth = Math.max(1, Math.min(2, options.maxDepth ?? 1));
    this.maxBatchSize = Math.max(1, Math.min(50, options.maxBatchSize ?? 25));
    this.cacheTtlMs = Math.max(1000, options.cacheTtlMs ?? 300_000);
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? 10_000);
    this.retryAttempts = Math.max(1, options.retryAttempts ?? 3);
    this.initialDelayMs = Math.max(10, options.initialDelayMs ?? 200);
    this.maxDelayMs = Math.max(this.initialDelayMs, options.maxDelayMs ?? 2_000);
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 5_000);
    this.hopDecay = Math.min(1, Math.max(0, options.hopDecay ?? 0.75));
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
    this.persistentCache = options.persistentCache;
  }

  public async resolveNeighbors(entityIds: readonly string[]): Promise<EntityRelationEdge[]> {
    const seedIds = Array.from(new Set(entityIds.filter((id) => isEntityId(id))));
    if (seedIds.length === 0) return [];

    const emitted = new Map<string, EntityRelationEdge>();
    const visited = new Set<string>();
    let frontier = seedIds.map((id) => ({ rootId: id, currentId: id, depth: 1 }));

    while (frontier.length > 0) {
      const currentLayer = frontier;
      frontier = [];

      const uniqueCurrentIds = Array.from(new Set(currentLayer.map((item) => item.currentId).filter((id) => !visited.has(id))));
      uniqueCurrentIds.forEach((id) => visited.add(id));

      const resolvedMap = await this.resolveEntityBatch(uniqueCurrentIds);

      for (const item of currentLayer) {
        const rawEdges = resolvedMap.get(item.currentId) ?? [];
        for (const edge of rawEdges) {
          const adjustedWeight = Math.max(0.1, edge.weight * Math.pow(this.hopDecay, item.depth - 1));
          const emittedEdge: EntityRelationEdge = {
            sourceId: item.rootId,
            targetId: edge.targetId,
            relation: edge.relation,
            weight: adjustedWeight
          };

          const edgeKey = `${emittedEdge.sourceId}:${emittedEdge.relation}:${emittedEdge.targetId}`;
          const existing = emitted.get(edgeKey);
          if (!existing || existing.weight < emittedEdge.weight) emitted.set(edgeKey, emittedEdge);

          if (item.depth < this.maxDepth && !visited.has(edge.targetId)) {
            frontier.push({ rootId: item.rootId, currentId: edge.targetId, depth: item.depth + 1 });
          }
        }
      }
    }

    return Array.from(emitted.values()).sort((left, right) => right.weight - left.weight || left.targetId.localeCompare(right.targetId));
  }

  private async resolveEntityBatch(entityIds: readonly string[]): Promise<Map<string, EntityRelationEdge[]>> {
    const result = new Map<string, EntityRelationEdge[]>();
    const pending: string[] = [];
    const staleFallback = new Map<string, EntityRelationEdge[]>();
    const now = Date.now();

    // 1. memory cache
    for (const entityId of entityIds) {
      const cached = this.cache.get(entityId);
      if (cached && cached.expiresAt > now) {
        result.set(entityId, cloneEdges(cached.edges));
      } else {
        pending.push(entityId);
        if (cached) staleFallback.set(entityId, cloneEdges(cached.edges));
      }
    }

    // 2. persistent cache
    if (this.persistentCache && pending.length > 0) {
      const diskEntries = await this.persistentCache.getMany(pending);
      for (const [entityId, entry] of diskEntries.entries()) {
        if (entry.expiresAt > now) {
          result.set(entityId, cloneEdges(entry.edges));
          this.cache.set(entityId, entry);
        }
      }
    }

    const stillPending = entityIds.filter((id) => !result.has(id));

    for (let index = 0; index < stillPending.length; index += this.maxBatchSize) {
      const batch = stillPending.slice(index, index + this.maxBatchSize);
      try {
        const fetched = await this.fetchEntityRelations(batch);

        const persistBatch = new Map<string, ResolverCacheEntry>();

        for (const [entityId, edges] of fetched.entries()) {
          const entry = {
            edges: cloneEdges(edges),
            expiresAt: Date.now() + this.cacheTtlMs
          };

          result.set(entityId, cloneEdges(edges));
          this.cache.set(entityId, entry);
          persistBatch.set(entityId, entry);
        }

        if (this.persistentCache) {
          await this.persistentCache.setMany(persistBatch);
        }
      } catch {
        for (const entityId of batch) {
          const fallback = staleFallback.get(entityId) ?? [];
          result.set(entityId, cloneEdges(fallback));
        }
      }
    }

    return result;
  }

  private async fetchEntityRelations(entityIds: readonly string[]): Promise<Map<string, EntityRelationEdge[]>> {
    const url = new URL(this.endpoint);
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("format", "json");
    url.searchParams.set("ids", entityIds.join("|"));
    url.searchParams.set("props", "claims");
    url.searchParams.set("languages", this.language);
    url.searchParams.set("origin", "*");

    let delayMs = this.initialDelayMs;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url.toString(), {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: controller.signal
        });

        if (!response.ok) throw new Error(`Wikidata wbgetentities failed with status ${response.status}`);

        const payload = (await response.json()) as Record<string, unknown>;
        return this.parseEntityPayload(payload, entityIds);
      } catch (error) {
        lastError = error;
        if (attempt === this.retryAttempts) break;
        await sleep(jitteredBackoff(delayMs, this.maxDelayMs));
        delayMs = Math.min(this.maxDelayMs, delayMs * 2);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Wikidata wbgetentities failed for an unknown reason.");
  }

  private parseEntityPayload(payload: Record<string, unknown>, entityIds: readonly string[]): Map<string, EntityRelationEdge[]> {
    const output = new Map<string, EntityRelationEdge[]>();
    const entities = typeof payload.entities === "object" && payload.entities !== null
      ? (payload.entities as Record<string, unknown>)
      : {};

    for (const entityId of entityIds) {
      const entity = typeof entities[entityId] === "object" && entities[entityId] !== null
        ? (entities[entityId] as Record<string, unknown>)
        : undefined;

      if (!entity) {
        output.set(entityId, []);
        continue;
      }

      const claims = typeof entity.claims === "object" && entity.claims !== null
        ? (entity.claims as Record<string, unknown>)
        : {};

      const edges: EntityRelationEdge[] = [];

      for (const [propertyId, relationConfig] of Object.entries(PROPERTY_TO_RELATION)) {
        const claimList = Array.isArray(claims[propertyId]) ? (claims[propertyId] as unknown[]) : [];

        for (const claim of claimList) {
          if (typeof claim !== "object" || claim === null) continue;
          const mainSnak = typeof (claim as Record<string, unknown>).mainsnak === "object" && (claim as Record<string, unknown>).mainsnak !== null
            ? ((claim as Record<string, unknown>).mainsnak as Record<string, unknown>)
            : undefined;
          if (!mainSnak) continue;
          if (mainSnak.snaktype !== "value") continue;

          const dataValue = typeof mainSnak.datavalue === "object" && mainSnak.datavalue !== null
            ? (mainSnak.datavalue as Record<string, unknown>)
            : undefined;
          if (!dataValue) continue;

          const value = typeof dataValue.value === "object" && dataValue.value !== null
            ? (dataValue.value as Record<string, unknown>)
            : undefined;
          const targetId = typeof value?.id === "string" ? value.id : undefined;
          if (!targetId || !isEntityId(targetId)) continue;

          edges.push({
            sourceId: entityId,
            targetId,
            relation: relationConfig.relation,
            weight: relationConfig.weight
          });
        }
      }

      output.set(entityId, edges);
    }

    return output;
  }
}
