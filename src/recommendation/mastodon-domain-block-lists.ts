import { hasUnsafeControlCharacter } from "./control-characters.js";

export type RecommendationMastodonDomainBlockSeverity = "silence" | "suspend";

export interface RecommendationMastodonDomainBlockRule {
  domain: string;
  severity: RecommendationMastodonDomainBlockSeverity;
  rejectMedia: boolean;
  rejectReports: boolean;
  publicComment: string;
  obfuscate: boolean;
}

export interface RecommendationMastodonDomainBlockDecision {
  eligible: boolean;
  matchedDomain?: string;
  severity?: RecommendationMastodonDomainBlockSeverity;
  reasonCodes: readonly string[];
  publicComment?: string;
}

export interface RecommendationCuratedDomainBlockListDescriptor {
  id: string;
  format: "mastodon_domain_blocks_csv";
  sourcePath: string;
  defaultEnabled: boolean;
  severityPolicy: "deny_suspend_warn_silence";
  excludedDomains: readonly string[];
}

export const RECOMMENDATION_GARDEN_FENCE_DOMAIN_BLOCK_LIST: RecommendationCuratedDomainBlockListDescriptor = Object.freeze({
  id: "garden_fence",
  format: "mastodon_domain_blocks_csv",
  sourcePath: "data/moderation/garden-fence-domain-blocks.csv",
  defaultEnabled: false,
  severityPolicy: "deny_suspend_warn_silence",
  excludedDomains: Object.freeze(["mostr.pub", "gleasonator.com", "bird.makeup"])
});

const MAX_CSV_BYTES = 2_000_000;
const MAX_ROWS = 20_000;
const EXPECTED_HEADERS = Object.freeze([
  "#domain",
  "#severity",
  "#reject_media",
  "#reject_reports",
  "#public_comment",
  "#obfuscate"
] as const);

function normalizeDomain(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 253 || value.trim() !== value || hasUnsafeControlCharacter(value)) {
    throw new TypeError("Invalid Mastodon domain-block domain.");
  }
  const domain = value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\.+$/u, "");
  if (
    domain === "localhost" ||
    domain.endsWith(".localhost") ||
    domain.endsWith(".local") ||
    domain.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(domain) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(domain)
  ) {
    throw new TypeError("Invalid Mastodon domain-block domain.");
  }
  return domain;
}

function parseBoolean(value: string, label: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError(`Invalid Mastodon domain-block ${label}.`);
}

function parseCsvRows(input: string): readonly (readonly string[])[] {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_CSV_BYTES) {
    throw new TypeError("Invalid Mastodon domain-block CSV.");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new TypeError("Invalid Mastodon domain-block CSV.");
      continue;
    }
    field += character;
  }
  if (quoted) throw new TypeError("Invalid Mastodon domain-block CSV.");
  row.push(field);
  if (row.some((item) => item.length > 0)) rows.push(row);
  return Object.freeze(rows.map((item) => Object.freeze(item)));
}

export function parseRecommendationMastodonDomainBlockCsv(input: string): readonly RecommendationMastodonDomainBlockRule[] {
  const rows = parseCsvRows(input);
  if (rows.length === 0) throw new TypeError("Invalid Mastodon domain-block CSV.");
  const headers = [...rows[0]!];
  if (headers[0]?.charCodeAt(0) === 0xfeff) headers[0] = headers[0].slice(1);
  if (headers.length !== EXPECTED_HEADERS.length || headers.some((header, index) => header !== EXPECTED_HEADERS[index])) {
    throw new TypeError("Invalid Mastodon domain-block CSV headers.");
  }
  const domains = new Set<string>();
  const rules = rows.slice(1).map((values): RecommendationMastodonDomainBlockRule => {
    if (values.length !== EXPECTED_HEADERS.length) throw new TypeError("Invalid Mastodon domain-block CSV row.");
    const domain = normalizeDomain(values[0]);
    if (domains.has(domain)) throw new TypeError("Duplicate Mastodon domain-block domain.");
    domains.add(domain);
    const severity = values[1];
    if (severity !== "silence" && severity !== "suspend") throw new TypeError("Invalid Mastodon domain-block severity.");
    const publicComment = values[4];
    if (publicComment.length > 2_048 || hasUnsafeControlCharacter(publicComment)) {
      throw new TypeError("Invalid Mastodon domain-block public comment.");
    }
    return Object.freeze({
      domain,
      severity,
      rejectMedia: parseBoolean(values[2], "reject-media flag"),
      rejectReports: parseBoolean(values[3], "reject-reports flag"),
      publicComment,
      obfuscate: parseBoolean(values[5], "obfuscation flag")
    });
  });
  return Object.freeze(rules);
}

export function evaluateRecommendationMastodonDomainBlock(input: {
  candidateDomain: string;
  rules: readonly RecommendationMastodonDomainBlockRule[];
}): RecommendationMastodonDomainBlockDecision {
  if (input === null || typeof input !== "object" || !Array.isArray(input.rules)) {
    throw new TypeError("Invalid Mastodon domain-block evaluation input.");
  }
  const candidateDomain = normalizeDomain(input.candidateDomain);
  const matching = input.rules
    .filter((rule) => rule !== null && typeof rule === "object" && (candidateDomain === rule.domain || candidateDomain.endsWith(`.${rule.domain}`)))
    .sort((left, right) => right.domain.length - left.domain.length)[0];
  if (matching === undefined) return Object.freeze({ eligible: true, reasonCodes: Object.freeze([]) });
  if (matching.severity === "silence") {
    return Object.freeze({
      eligible: true,
      matchedDomain: matching.domain,
      severity: matching.severity,
      reasonCodes: Object.freeze(["provider_domain_silenced"]),
      publicComment: matching.publicComment
    });
  }
  return Object.freeze({
    eligible: false,
    matchedDomain: matching.domain,
    severity: matching.severity,
    reasonCodes: Object.freeze(["provider_domain_suspended"]),
    publicComment: matching.publicComment
  });
}
