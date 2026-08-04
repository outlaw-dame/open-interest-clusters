import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RECOMMENDATION_GARDEN_FENCE_DOMAIN_BLOCK_LIST,
  evaluateRecommendationMastodonDomainBlock,
  parseRecommendationMastodonDomainBlockCsv
} from "../src/index.js";

const listUrl = new URL("../data/moderation/garden-fence-domain-blocks.csv", import.meta.url);

test("Garden Fence severe block list excludes explicitly allowed bridges", async () => {
  const csv = await readFile(listUrl, "utf8");
  const rules = parseRecommendationMastodonDomainBlockCsv(csv);
  assert.equal(rules.length, 140);
  const domains = new Set(rules.map((rule) => rule.domain));
  assert.equal(domains.size, 140);
  assert.equal(domains.has("mostr.pub"), false);
  assert.equal(domains.has("gleasonator.com"), false);
  assert.equal(domains.has("bird.makeup"), false);
  assert.equal(rules.every((rule) => rule.severity === "suspend"), true);
  assert.equal(RECOMMENDATION_GARDEN_FENCE_DOMAIN_BLOCK_LIST.defaultEnabled, false);
});

test("Garden Fence blocks exact domains and subdomains", async () => {
  const rules = parseRecommendationMastodonDomainBlockCsv(await readFile(listUrl, "utf8"));
  const exact = evaluateRecommendationMastodonDomainBlock({ candidateDomain: "baraag.net", rules });
  assert.equal(exact.eligible, false);
  assert.equal(exact.reasonCodes[0], "provider_domain_suspended");
  assert.equal(exact.matchedDomain, "baraag.net");
  assert.equal(evaluateRecommendationMastodonDomainBlock({ candidateDomain: "media.baraag.net", rules }).eligible, false);
  assert.deepEqual(evaluateRecommendationMastodonDomainBlock({ candidateDomain: "bird.makeup", rules }), { eligible: true, reasonCodes: [] });
});

test("Mastodon CSV parser treats a header-only list as valid empty policy", () => {
  const header = "#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate\n";
  assert.deepEqual(parseRecommendationMastodonDomainBlockCsv(header), []);
  const parsed = parseRecommendationMastodonDomainBlockCsv(`${header}example.social,suspend,false,false,"Spam, harassment",false\n`);
  assert.deepEqual(parsed[0], {
    domain: "example.social",
    severity: "suspend",
    rejectMedia: false,
    rejectReports: false,
    publicComment: "Spam, harassment",
    obfuscate: false
  });
});

test("silence remains advisory while suspend is a hard exclusion", () => {
  const rules = parseRecommendationMastodonDomainBlockCsv(
    "#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate\nexample.social,silence,false,false,low trust,false\n"
  );
  assert.deepEqual(evaluateRecommendationMastodonDomainBlock({ candidateDomain: "example.social", rules }), {
    eligible: true,
    matchedDomain: "example.social",
    severity: "silence",
    reasonCodes: ["provider_domain_silenced"],
    publicComment: "low trust"
  });
});

test("Mastodon CSV parser rejects duplicate and malformed rows", () => {
  const header = "#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate\n";
  assert.throws(() => parseRecommendationMastodonDomainBlockCsv(`${header}example.social,suspend,false,false,x,false\nexample.social,suspend,false,false,y,false\n`), /Duplicate/u);
  assert.throws(() => parseRecommendationMastodonDomainBlockCsv(`${header}localhost,suspend,false,false,x,false\n`), /domain/u);
  assert.throws(() => parseRecommendationMastodonDomainBlockCsv(`${header}example.social,unknown,false,false,x,false\n`), /severity/u);
  assert.throws(() => parseRecommendationMastodonDomainBlockCsv(`${header}example.social,suspend,yes,false,x,false\n`), /reject-media/u);
});
