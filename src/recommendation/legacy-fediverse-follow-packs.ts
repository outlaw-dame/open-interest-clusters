import { hasUnsafeControlCharacter } from "./control-characters.js";
import {
  evaluateRecommendationAccountEligibility,
  type RecommendationAccountEligibilityResult,
  type RecommendationAccountProfileResolver
} from "./account-recommendation-eligibility.js";

export const RECOMMENDATION_LEGACY_FOLLOW_PACK_SOURCES = [
  "fedidevs",
  "wptoots_wordpress_community",
  "mastodon_migration_directory",
  "generic_csv"
] as const;
export type RecommendationLegacyFollowPackSource = typeof RECOMMENDATION_LEGACY_FOLLOW_PACK_SOURCES[number];

export interface RecommendationLegacyFollowPackMember {
  reference: string;
  name?: string;
  profileUrl?: string;
  keywords: readonly string[];
  languages: readonly string[];
}

export interface RecommendationLegacyFollowPack {
  source: RecommendationLegacyFollowPackSource;
  sourceUrl: string;
  name: string;
  description?: string;
  curator?: string;
  optOutSupported: boolean;
  observedAt: string;
  members: readonly RecommendationLegacyFollowPackMember[];
}

export interface RecommendationEligibleFollowPackMember {
  member: RecommendationLegacyFollowPackMember;
  eligibility: RecommendationAccountEligibilityResult;
}

const MAX_MEMBERS = 500;
const MAX_TEXT = 4_096;

function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > max || hasUnsafeControlCharacter(value)) {
    throw new TypeError(`Invalid legacy follow pack ${label}.`);
  }
  return value;
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : text(value, label);
}

function httpsUrl(value: unknown, label: string): string {
  let parsed: URL;
  try { parsed = new URL(text(value, label, 2_048)); } catch { throw new TypeError(`Invalid legacy follow pack ${label}.`); }
  const host = parsed.hostname.toLowerCase().replace(/\.+$/u, "");
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || host === "localhost" || host.endsWith(".local") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":")) {
    throw new TypeError(`Invalid legacy follow pack ${label}.`);
  }
  parsed.hostname = host;
  parsed.hash = "";
  return parsed.toString();
}

function tokens(value: unknown): readonly string[] {
  if (typeof value !== "string" || value.trim() === "") return Object.freeze([]);
  return Object.freeze([...new Set(value.split(/\s+/u).map((entry) => entry.trim().toLocaleLowerCase("und")).filter((entry) => entry.length > 0 && entry.length <= 80 && !hasUnsafeControlCharacter(entry)))].slice(0, 64));
}

function parseCsvRows(csv: string): readonly Record<string, string>[] {
  if (csv.length > 2_000_000 || hasUnsafeControlCharacter(csv.replace(/[\n\r\t]/gu, ""))) throw new TypeError("Invalid legacy follow pack CSV.");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]!;
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { cell += '"'; index += 1; } else { quoted = !quoted; }
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((entry) => entry.length > 0)) rows.push(row);
      row = [];
    } else { cell += char; }
  }
  if (quoted) throw new TypeError("Invalid legacy follow pack CSV.");
  row.push(cell);
  if (row.some((entry) => entry.length > 0)) rows.push(row);
  if (rows.length < 2 || rows.length > MAX_MEMBERS + 1) throw new TypeError("Invalid legacy follow pack CSV.");
  const headers = rows[0]!.map((header) => header.trim().toLocaleLowerCase("und"));
  return Object.freeze(rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]))));
}

export function normalizeLegacyFollowPackCsv(input: {
  source: RecommendationLegacyFollowPackSource;
  sourceUrl: string;
  name: string;
  csv: string;
  observedAt: string;
  description?: string;
  curator?: string;
  optOutSupported?: boolean;
}): RecommendationLegacyFollowPack {
  const rows = parseCsvRows(input.csv);
  const members = rows.map((row): RecommendationLegacyFollowPackMember => {
    const reference = text(row.account || row.acct || row.handle, "member reference", 512);
    const profileUrl = optionalText(row.url || row.profile_url, "member profile URL");
    return Object.freeze({
      reference,
      ...(optionalText(row.name, "member name") === undefined ? {} : { name: text(row.name, "member name") }),
      ...(profileUrl === undefined ? {} : { profileUrl: httpsUrl(profileUrl, "member profile URL") }),
      keywords: tokens(row.keywords),
      languages: tokens(row.language || row.languages)
    });
  });
  return Object.freeze({
    source: input.source,
    sourceUrl: httpsUrl(input.sourceUrl, "source URL"),
    name: text(input.name, "name", 256),
    ...(input.description === undefined ? {} : { description: text(input.description, "description") }),
    ...(input.curator === undefined ? {} : { curator: text(input.curator, "curator", 512) }),
    optOutSupported: input.optOutSupported === true,
    observedAt: new Date(text(input.observedAt, "observation timestamp", 128)).toISOString(),
    members: Object.freeze(members)
  });
}

export async function filterEligibleLegacyFollowPackMembers(input: {
  pack: RecommendationLegacyFollowPack;
  resolver: RecommendationAccountProfileResolver;
  evaluatedAt?: string;
  inactivityDays?: number;
  signal?: AbortSignal;
}): Promise<readonly RecommendationEligibleFollowPackMember[]> {
  const output: RecommendationEligibleFollowPackMember[] = [];
  for (const member of input.pack.members) {
    const eligibility = await evaluateRecommendationAccountEligibility({
      reference: member.profileUrl ?? member.reference,
      resolver: input.resolver,
      ...(input.evaluatedAt === undefined ? {} : { evaluatedAt: input.evaluatedAt }),
      ...(input.inactivityDays === undefined ? {} : { inactivityDays: input.inactivityDays }),
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
    if (eligibility.eligible) output.push(Object.freeze({ member, eligibility }));
  }
  return Object.freeze(output);
}
