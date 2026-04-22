import { readFile, rename, writeFile } from "node:fs/promises";
import type { EntityRelationEdge } from "./types.js";

export interface EntityGraphCacheEntry {
  edges: EntityRelationEdge[];
  expiresAt: number;
}

export interface EntityGraphCacheStore {
  get(entityId: string): Promise<EntityGraphCacheEntry | undefined>;
  getMany(entityIds: readonly string[]): Promise<Map<string, EntityGraphCacheEntry>>;
  set(entityId: string, entry: EntityGraphCacheEntry): Promise<void>;
  setMany(entries: ReadonlyMap<string, EntityGraphCacheEntry>): Promise<void>;
}

interface FileEntityGraphCacheSnapshot {
  version: 1;
  updatedAt: number;
  entries: Record<string, EntityGraphCacheEntry>;
}

function cloneEntry(entry: EntityGraphCacheEntry): EntityGraphCacheEntry {
  return {
    expiresAt: entry.expiresAt,
    edges: entry.edges.map((edge) => ({ ...edge }))
  };
}

export class FileEntityGraphCache implements EntityGraphCacheStore {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private readonly memory = new Map<string, EntityGraphCacheEntry>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(filePath: string, maxEntries = 10000) {
    this.filePath = filePath;
    this.maxEntries = Math.max(1, maxEntries);
  }

  public async get(entityId: string): Promise<EntityGraphCacheEntry | undefined> {
    await this.ensureLoaded();
    const entry = this.memory.get(entityId);
    return entry ? cloneEntry(entry) : undefined;
  }

  public async getMany(entityIds: readonly string[]): Promise<Map<string, EntityGraphCacheEntry>> {
    await this.ensureLoaded();
    const output = new Map<string, EntityGraphCacheEntry>();
    for (const entityId of entityIds) {
      const entry = this.memory.get(entityId);
      if (entry) output.set(entityId, cloneEntry(entry));
    }
    return output;
  }

  public async set(entityId: string, entry: EntityGraphCacheEntry): Promise<void> {
    const entries = new Map<string, EntityGraphCacheEntry>([[entityId, cloneEntry(entry)]]);
    await this.setMany(entries);
  }

  public async setMany(entries: ReadonlyMap<string, EntityGraphCacheEntry>): Promise<void> {
    await this.ensureLoaded();

    for (const [entityId, entry] of entries.entries()) {
      this.memory.delete(entityId);
      this.memory.set(entityId, cloneEntry(entry));
    }

    this.trim();
    await this.enqueueWrite();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as FileEntityGraphCacheSnapshot;
      if (parsed.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
        throw new Error("Unsupported entity cache snapshot format.");
      }

      for (const [entityId, entry] of Object.entries(parsed.entries)) {
        if (!entry || typeof entry !== "object") continue;
        if (!Array.isArray(entry.edges) || typeof entry.expiresAt !== "number") continue;
        this.memory.set(entityId, cloneEntry(entry));
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") return;

      const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
      try {
        await rename(this.filePath, corruptPath);
      } catch {
        // Intentionally swallow to preserve self-healing behavior.
      }
      this.memory.clear();
    }
  }

  private trim(): void {
    while (this.memory.size > this.maxEntries) {
      const oldestKey = this.memory.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.memory.delete(oldestKey);
    }
  }

  private async enqueueWrite(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const snapshot: FileEntityGraphCacheSnapshot = {
        version: 1,
        updatedAt: Date.now(),
        entries: Object.fromEntries(
          Array.from(this.memory.entries(), ([entityId, entry]) => [entityId, cloneEntry(entry)])
        )
      };

      const tempPath = `${this.filePath}.tmp`;
      const serialized = JSON.stringify(snapshot);
      await writeFile(tempPath, serialized, "utf-8");
      await rename(tempPath, this.filePath);
    });

    return this.writeChain;
  }
}
