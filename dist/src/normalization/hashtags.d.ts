export interface NormalizeHashtagOptions {
    unicodeForm?: "NFC" | "NFD" | "NFKC" | "NFKD";
    casefold?: boolean;
    stripLeadingHash?: boolean;
}
export declare function normalizeHashtag(input: string, options?: NormalizeHashtagOptions): string;
export declare function normalizeString(input: string, unicodeForm?: NormalizeHashtagOptions["unicodeForm"], casefold?: boolean): string;
export declare function dedupeNormalized(values: readonly string[], options?: NormalizeHashtagOptions): string[];
