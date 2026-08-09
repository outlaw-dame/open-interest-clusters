export interface NormalizeHashtagOptions {
  unicodeForm?: "NFC" | "NFD" | "NFKC" | "NFKD";
  casefold?: boolean;
  stripLeadingHash?: boolean;
}

const DEFAULT_OPTIONS: Required<NormalizeHashtagOptions> = {
  unicodeForm: "NFKC",
  casefold: true,
  stripLeadingHash: true
};

const HASHTAG_SEPARATOR_PATTERN = /[_\-\u2010-\u2015]+/gu;
const LOWER_TO_UPPER_BOUNDARY_PATTERN = /(\p{Ll})(\p{Lu})/gu;
const ACRONYM_TO_WORD_BOUNDARY_PATTERN = /(\p{Lu})(\p{Lu}\p{Ll})/gu;
const SINGLE_LETTER_PREFIX_PATTERN = /(^|\s)(\p{Ll})\s+(\p{Lu}\p{Ll}+)/gu;

export function normalizeHashtag(input: string, options: NormalizeHashtagOptions = {}): string {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  let value = input.trim().normalize(resolved.unicodeForm);
  if (resolved.stripLeadingHash) value = value.replace(/^#+/u, "");
  if (resolved.casefold) value = value.toLocaleLowerCase("und");
  return value;
}

export function normalizeString(input: string, unicodeForm: NormalizeHashtagOptions["unicodeForm"] = "NFKC", casefold = true): string {
  const normalized = input.trim().normalize(unicodeForm);
  return casefold ? normalized.toLocaleLowerCase("und") : normalized;
}

function normalizePhrase(value: string): string {
  return value
    .replace(HASHTAG_SEPARATOR_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("und");
}

function segmentCaseBoundaries(value: string, includeAcronymBoundary: boolean): string {
  let segmented = value.replace(HASHTAG_SEPARATOR_PATTERN, " ");
  segmented = segmented.replace(LOWER_TO_UPPER_BOUNDARY_PATTERN, "$1 $2");
  if (includeAcronymBoundary) {
    segmented = segmented.replace(ACRONYM_TO_WORD_BOUNDARY_PATTERN, "$1 $2");
  }
  // Preserve common leading single-letter product/style prefixes such as
  // iPhone and eSports after the generic lower→upper boundary pass.
  segmented = segmented.replace(SINGLE_LETTER_PREFIX_PATTERN, "$1$2$3");
  return normalizePhrase(segmented);
}

/**
 * Returns deterministic, conservative phrase interpretations for a hashtag.
 *
 * This intentionally does not use dictionary-based word breaking. It only
 * expands boundaries explicitly encoded by Unicode compatibility forms,
 * separators, or letter casing. The compact canonical hashtag is always
 * retained so expansion can add matches without changing hashtag identity.
 *
 * Examples:
 * - #OpenSource -> ["opensource", "open source"]
 * - #BlackLivesMatter -> ["blacklivesmatter", "black lives matter"]
 * - #OpenAIResearch -> ["openairesearch", "open airesearch", "open ai research"]
 * - #OAuthSecurity -> ["oauthsecurity", "oauth security", "o auth security"]
 */
export function hashtagPhraseVariants(input: string): readonly string[] {
  const value = input.trim().normalize("NFKC").replace(/^#+/u, "");
  if (value.length === 0) return Object.freeze([]);

  const variants = new Set<string>();
  const compact = normalizeHashtag(value);
  if (compact.length > 0) variants.add(compact);

  const separated = normalizePhrase(value);
  if (separated.length > 0) variants.add(separated);

  const camelSegmented = segmentCaseBoundaries(value, false);
  if (camelSegmented.length > 0) variants.add(camelSegmented);

  const acronymSegmented = segmentCaseBoundaries(value, true);
  if (acronymSegmented.length > 0) variants.add(acronymSegmented);

  return Object.freeze([...variants]);
}

export function dedupeNormalized(values: readonly string[], options: NormalizeHashtagOptions = {}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeHashtag(value, options);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
