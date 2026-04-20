import { readFile } from "node:fs/promises";
import { deepFreeze } from "../utils/deep-freeze.js";
import { validateDataset } from "../validation/validator.js";
import type { InterestClusterDataset } from "../types/schema.js";

export async function loadDatasetFromFile(path: string): Promise<Readonly<InterestClusterDataset>> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const validated = validateDataset(parsed);
  return deepFreeze(validated);
}
