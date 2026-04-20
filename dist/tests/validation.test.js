import test from "node:test";
import assert from "node:assert/strict";
import dataset from "../datasets/interests.global.v1.json" with { type: "json" };
import { validateDataset } from "../src/validation/validator.js";
test("starter dataset validates", () => {
    const validated = validateDataset(dataset);
    assert.equal(validated.dataset_id, "open-interest-clusters-global");
    assert.ok(validated.clusters.length >= 3);
});
//# sourceMappingURL=validation.test.js.map