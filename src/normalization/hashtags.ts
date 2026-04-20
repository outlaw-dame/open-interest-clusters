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
