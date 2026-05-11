import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEmbeddingManifest,
  findDirtyClusters,
  hashEmbeddingText,
  type InterestClusterDataset
} from "../src/index.js";

const dataset: InterestClusterDataset = {
  schema_version: "1.0.0",
  dataset_id: "test",
  dataset_version: "1.0.0",
  locale_default: "en-US",
  normalization: {
    unicode_form: "NFKC",
    casefold: true,
    strip_leading_hash_for_storage: true
  },
  clusters: []
};

test("embedding text hashing is deterministic", () => {
  assert.equal(
    hashEmbeddingText("PlayStation"),
    hashEmbeddingText("PlayStation")
  );
});

test("dirty cluster detection identifies missing clusters", () => {
  const dirty = findDirtyClusters(dataset, null);
  assert.deepEqual(dirty, []);
});

test("manifest builder produces stable schema", () => {
  const manifest = buildEmbeddingManifest([]);

  assert.equal(
    manifest.schemaVersion,
    "embedding-refresh-manifest.v1"
  );
});
