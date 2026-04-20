import { readFile, writeFile } from "node:fs/promises";
import { normalizeHashtag, normalizeString, dedupeNormalized } from "../src/normalization/hashtags.js";
function normalizeKeywordArray(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("Usage: tsx scripts/normalize-dataset.ts <dataset-path>");
  const raw = await readFile(filePath, "utf8");
  const dataset = JSON.parse(raw) as Record<string, unknown>;
  if (Array.isArray(dataset.clusters)) {
    for (const cluster of dataset.clusters as Array<Record<string, unknown>>) {
      if (cluster.anchor && typeof cluster.anchor === "object" && typeof (cluster.anchor as Record<string, unknown>).hashtag === "string") {
        (cluster.anchor as Record<string, unknown>).hashtag = normalizeHashtag((cluster.anchor as Record<string, unknown>).hashtag as string);
      }
      if (cluster.hashtags && typeof cluster.hashtags === "object") {
        const hashtags = cluster.hashtags as Record<string, unknown>;
        for (const key of ["anchor", "aliases", "adjacent", "excluded"] as const) {
          const values = hashtags[key];
          if (Array.isArray(values)) hashtags[key] = dedupeNormalized(values.filter((v): v is string => typeof v === "string"));
        }
      }
      if (cluster.keywords && typeof cluster.keywords === "object") {
        const keywords = cluster.keywords as Record<string, unknown>;
        for (const key of ["high_value", "secondary", "negative"] as const) {
          const values = keywords[key];
          if (Array.isArray(values)) keywords[key] = normalizeKeywordArray(values.filter((v): v is string => typeof v === "string"));
        }
      }
    }
  }
  await writeFile(filePath, `${JSON.stringify(dataset, null, 2)}
`, "utf8");
  console.log(`Normalized ${filePath}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
