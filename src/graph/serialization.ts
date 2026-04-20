import fs from "fs/promises";
import path from "node:path";
import { CooccurrenceGraph, type GraphSnapshot } from "./cooccurrence-graph.js";

async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, data, "utf-8");
  await fs.rename(tempPath, filePath);
}

export async function saveGraphSnapshot(
  graph: CooccurrenceGraph,
  filePath: string,
  options?: { rotate?: boolean; maxSnapshots?: number }
): Promise<void> {
  const snapshot = graph.toSnapshot();
  const serialized = JSON.stringify(snapshot);

  await atomicWrite(filePath, serialized);

  if (options?.rotate) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const timestamp = snapshot.generatedAt;
    const rotatedName = `${base}.${timestamp}.snap`;
    const rotatedPath = path.join(dir, rotatedName);

    await fs.copyFile(filePath, rotatedPath);

    if (options.maxSnapshots) {
      const files = (await fs.readdir(dir))
        .filter((entry) => entry.startsWith(base) && entry.endsWith(".snap"))
        .sort();

      const excess = files.length - options.maxSnapshots;
      for (let index = 0; index < excess; index += 1) {
        const candidate = files[index];
        if (!candidate) continue;
        await fs.unlink(path.join(dir, candidate));
      }
    }
  }
}

export async function loadGraphSnapshot(filePath: string): Promise<CooccurrenceGraph> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as GraphSnapshot;
  return CooccurrenceGraph.fromSnapshot(parsed);
}

export async function loadLatestValidSnapshot(
  directory: string,
  baseFile: string
): Promise<CooccurrenceGraph | null> {
  const files = (await fs.readdir(directory))
    .filter((entry) => entry.startsWith(baseFile))
    .sort()
    .reverse();

  for (const file of files) {
    try {
      const fullPath = path.join(directory, file);
      const graph = await loadGraphSnapshot(fullPath);
      return graph;
    } catch {
      continue;
    }
  }

  return null;
}
