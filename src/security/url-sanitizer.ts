export interface SanitizedLink {
  url: string;
  domain: string;
  wasSanitized: boolean;
}

export interface UrlSanitizerOptions {
  allowedProtocols?: readonly string[];
  maxUrlLength?: number;
  maxDomainLength?: number;
}

const DEFAULT_ALLOWED_PROTOCOLS = ["http:", "https:"] as const;
const DEFAULT_MAX_URL_LENGTH = 4096;
const DEFAULT_MAX_DOMAIN_LENGTH = 253;

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F]/u.test(value);
}

function normalizeDomain(hostname: string, maxDomainLength: number): string | null {
  const normalized = hostname.trim().toLowerCase();

  if (!normalized || normalized.length > maxDomainLength) {
    return null;
  }

  if (hasControlCharacters(normalized)) {
    return null;
  }

  return normalized;
}

export function sanitizeUrl(rawUrl: string, options: UrlSanitizerOptions = {}): SanitizedLink | null {
  const maxUrlLength = Math.max(128, Math.min(options.maxUrlLength ?? DEFAULT_MAX_URL_LENGTH, 32_000));
  const maxDomainLength = Math.max(1, Math.min(options.maxDomainLength ?? DEFAULT_MAX_DOMAIN_LENGTH, 253));
  const allowedProtocols = new Set(options.allowedProtocols ?? DEFAULT_ALLOWED_PROTOCOLS);
  const trimmed = rawUrl.trim();

  if (!trimmed || trimmed.length > maxUrlLength || hasControlCharacters(trimmed)) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!allowedProtocols.has(parsed.protocol)) {
    return null;
  }

  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";

  const domain = normalizeDomain(parsed.hostname, maxDomainLength);
  if (!domain) {
    return null;
  }

  const sanitized = parsed.toString();

  if (sanitized.length > maxUrlLength || hasControlCharacters(sanitized)) {
    return null;
  }

  return {
    url: sanitized,
    domain,
    wasSanitized: sanitized !== trimmed
  };
}

export function sanitizeUrlList(rawUrls: readonly string[], options: UrlSanitizerOptions = {}): SanitizedLink[] {
  const output: SanitizedLink[] = [];
  const seen = new Set<string>();

  for (const rawUrl of rawUrls) {
    const sanitized = sanitizeUrl(rawUrl, options);
    if (!sanitized || seen.has(sanitized.url)) {
      continue;
    }

    seen.add(sanitized.url);
    output.push(sanitized);
  }

  return output;
}
