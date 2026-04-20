import fs from "fs/promises";
import type { CooccurrenceGraph } from "./cooccurrence-graph.js";

export async function saveGraph(
  graph: CooccurrenceGraph,
  path: string
): Promise<void> {
  const data = JSON.stringify([...graph.getGraph()]);
  await fs.writeFile(path, data, "utf-8");
}

export async function loadGraph(path: string): Promise<any> {
  const raw = await fs.readFile(path, "utf-8");
  return JSON.parse(raw);
}
