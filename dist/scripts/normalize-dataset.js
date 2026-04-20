import { readFile, writeFile } from "node:fs/promises";
import { normalizeHashtag, normalizeString, dedupeNormalized } from "../src/normalization/hashtags.js";
function normalizeKeywordArray(values) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const normalized = normalizeString(value);
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
async function main() {
    const filePath = process.argv[2];
    if (!filePath)
        throw new Error("Usage: tsx scripts/normalize-dataset.ts <dataset-path>");
    const raw = await readFile(filePath, "utf8");
    const dataset = JSON.parse(raw);
    if (Array.isArray(dataset.clusters)) {
        for (const cluster of dataset.clusters) {
            if (cluster.anchor && typeof cluster.anchor === "object" && typeof cluster.anchor.hashtag === "string") {
                cluster.anchor.hashtag = normalizeHashtag(cluster.anchor.hashtag);
            }
            if (cluster.hashtags && typeof cluster.hashtags === "object") {
                const hashtags = cluster.hashtags;
                for (const key of ["anchor", "aliases", "adjacent", "excluded"]) {
                    const values = hashtags[key];
                    if (Array.isArray(values))
                        hashtags[key] = dedupeNormalized(values.filter((v) => typeof v === "string"));
                }
            }
            if (cluster.keywords && typeof cluster.keywords === "object") {
                const keywords = cluster.keywords;
                for (const key of ["high_value", "secondary", "negative"]) {
                    const values = keywords[key];
                    if (Array.isArray(values))
                        keywords[key] = normalizeKeywordArray(values.filter((v) => typeof v === "string"));
                }
            }
        }
    }
    await writeFile(filePath, `${JSON.stringify(dataset, null, 2)}
`, "utf8");
    console.log(`Normalized ${filePath}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
//# sourceMappingURL=normalize-dataset.js.map