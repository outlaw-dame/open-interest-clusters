import { loadDatasetFromFile } from "../src/loaders/dataset-loader.js";
async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("Usage: tsx scripts/validate-dataset.ts <dataset-path>");
  const dataset = await loadDatasetFromFile(filePath);
  console.log(`Validated dataset ${dataset.dataset_id}@${dataset.dataset_version} with ${dataset.clusters.length} cluster(s).`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
