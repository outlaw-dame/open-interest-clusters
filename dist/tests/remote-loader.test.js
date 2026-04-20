import test from "node:test";
import assert from "node:assert/strict";
import dataset from "../datasets/interests.global.v1.json" with { type: "json" };
import { fetchRemoteDataset } from "../src/loaders/remote-loader.js";
test("fetchRemoteDataset returns cached dataset on 304", async () => {
    const cached = dataset;
    const response = await fetchRemoteDataset("https://example.invalid/dataset.json", {
        cache: { etag: '"v1"', dataset: cached },
        fetchImpl: async () => new Response(null, { status: 304, headers: { etag: '"v1"' } })
    });
    assert.equal(response.notModified, true);
    assert.equal(response.dataset.dataset_id, dataset.dataset_id);
});
//# sourceMappingURL=remote-loader.test.js.map