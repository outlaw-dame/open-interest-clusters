import test from "node:test";
import assert from "node:assert/strict";
import { dedupeNormalized, normalizeHashtag } from "../src/normalization/hashtags.js";
test("normalizeHashtag strips leading hash and lowercases", () => {
    assert.equal(normalizeHashtag("#PS5"), "ps5");
});
test("dedupeNormalized deduplicates equivalent hashtag values", () => {
    const result = dedupeNormalized(["#PS5", "ps5", "#PlayStation5"]);
    assert.deepEqual(result, ["ps5", "playstation5"]);
});
//# sourceMappingURL=normalization.test.js.map