const DEFAULT_OPTIONS = {
    unicodeForm: "NFKC",
    casefold: true,
    stripLeadingHash: true
};
export function normalizeHashtag(input, options = {}) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    let value = input.trim().normalize(resolved.unicodeForm);
    if (resolved.stripLeadingHash)
        value = value.replace(/^#+/u, "");
    if (resolved.casefold)
        value = value.toLocaleLowerCase("und");
    return value;
}
export function normalizeString(input, unicodeForm = "NFKC", casefold = true) {
    const normalized = input.trim().normalize(unicodeForm);
    return casefold ? normalized.toLocaleLowerCase("und") : normalized;
}
export function dedupeNormalized(values, options = {}) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const normalized = normalizeHashtag(value, options);
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
//# sourceMappingURL=hashtags.js.map