import { readFile, rename, writeFile } from "node:fs/promises";
import type { BanditArmState } from "./bandit.js";

interface Snapshot {
  version: 1;
  updatedAt: number;
  arms: Record<string, BanditArmState>;
}

export class FileBanditStore {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private readonly memory = new Map<string, BanditArmState>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(filePath: string, maxEntries = 10000) {
    this.filePath = filePath;
    this.maxEntries = Math.max(1, maxEntries);
  }

  public async getAll(): Promise<Map<string, BanditArmState>> {
    await this.ensureLoaded();
    return new Map(this.memory);
  }

  public async upsert(clusterId: string, state: BanditArmState): Promise<void> {
    await this.ensureLoaded();
    this.memory.set(clusterId, { ...state });
    this.trim();
    await this.enqueueWrite();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Snapshot;
      if (parsed.version !== 1) throw new Error("Invalid snapshot");

      for (const [clusterId, state] of Object.entries(parsed.arms)) {
        this.memory.set(clusterId, { ...state });
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
        try { await rename(this.filePath, corruptPath); } catch {}
      }
      this.memory.clear();
    }
  }

  private trim(): void {
    while (this.memory.size > this.maxEntries) {
      const oldest = this.memory.keys().next().value;
      if (oldest) this.memory.delete(oldest);
    }
  }

  private async enqueueWrite(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const snapshot: Snapshot = {
        version: 1,
        updatedAt: Date.now(),
        arms: Object.fromEntries(this.memory)
      };

      const temp = `${this.filePath}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot), "utf-8");
      await rename(temp, this.filePath);
    });

    return this.writeChain;
  }
}
