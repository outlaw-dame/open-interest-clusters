import { readFile } from "node:fs/promises";
import { deepFreeze } from "../utils/deep-freeze.js";
import { validateDataset } from "../validation/validator.js";
export async function loadDatasetFromFile(path) {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    const validated = validateDataset(parsed);
    return deepFreeze(validated);
}
//# sourceMappingURL=dataset-loader.js.map