import test from "node:test";
import assert from "node:assert/strict";
import { dedupeNormalized, hashtagPhraseVariants, normalizeHashtag } from "../src/normalization/hashtags.js";

test("normalizeHashtag strips leading hash and lowercases", () => {
  assert.equal(normalizeHashtag("#PS5"), "ps5");
});

test("dedupeNormalized deduplicates equivalent hashtag values", () => {
  const result = dedupeNormalized(["#PS5", "ps5", "#PlayStation5"]);
  assert.deepEqual(result, ["ps5", "playstation5"]);
});

test("hashtagPhraseVariants conservatively expands camel and separator boundaries", () => {
  assert.deepEqual(hashtagPhraseVariants("#OpenSource"), ["opensource", "open source"]);
  assert.deepEqual(hashtagPhraseVariants("#BlackLivesMatter"), ["blacklivesmatter", "black lives matter"]);
  assert.deepEqual(hashtagPhraseVariants("#Open_Source"), ["open_source", "open source"]);
  assert.deepEqual(hashtagPhraseVariants("＃OpenSource"), ["opensource", "open source"]);
});

test("hashtagPhraseVariants retains alternate acronym interpretations without guessing dictionary words", () => {
  assert.deepEqual(hashtagPhraseVariants("#OpenAIResearch"), [
    "openairesearch",
    "open airesearch",
    "open ai research"
  ]);
  assert.deepEqual(hashtagPhraseVariants("#OAuthSecurity"), [
    "oauthsecurity",
    "oauth security",
    "o auth security"
  ]);
  assert.deepEqual(hashtagPhraseVariants("#opensource"), ["opensource"]);
});

test("hashtagPhraseVariants preserves common single-letter style prefixes", () => {
  assert.deepEqual(hashtagPhraseVariants("#iPhonePrivacy"), [
    "iphoneprivacy",
    "iphone privacy"
  ]);
  assert.deepEqual(hashtagPhraseVariants("#eSportsNews"), [
    "esportsnews",
    "esports news"
  ]);
});
