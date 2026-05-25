import { executeWithRetry } from "../utils/retry-policy.js";
import { sanitizeUrlList } from "./url-sanitizer.js";

export interface SafeBrowsingThreat {
  threatType: string;
  platformType: string;
  threatEntryType: string;
  cacheDuration?: string;
}

export interface SafeBrowsingResult {
  url: string;
  unsafe: boolean;
  threats: SafeBrowsingThreat[];
}

export interface GoogleSafeBrowsingOptions {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;
const MAX_BATCH_SIZE = 500;

class SafeBrowsingRequestError extends Error {
  public readonly status?: number;
  public readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "SafeBrowsingRequestError";
    if (options.status !== undefined) {
      this.status = options.status;
    }
    this.retryable = options.retryable ?? false;
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function normalizeEndpoint(endpoint: string): string {
  let parsed: URL;

  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Safe Browsing endpoint must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Safe Browsing endpoint must use HTTPS");
  }

  parsed.search = "";
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";

  return parsed.toString();
}

export class GoogleSafeBrowsingClient {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: GoogleSafeBrowsingOptions) {
    const apiKey = options.apiKey.trim();

    if (!apiKey) {
      throw new Error("Safe Browsing API key is required");
    }

    this.apiKey = apiKey;
    this.endpoint = normalizeEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
    this.timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.retryAttempts = Math.max(1, Math.min(8, options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS));
    this.initialRetryDelayMs = Math.max(10, options.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS);
    this.maxRetryDelayMs = Math.max(this.initialRetryDelayMs, options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async checkUrls(urls: readonly string[]): Promise<SafeBrowsingResult[]> {
    const sanitized = sanitizeUrlList(urls).slice(0, MAX_BATCH_SIZE);
    const deduped = sanitized.map((link) => link.url);

    if (deduped.length === 0) {
      return [];
    }

    const payload = {
      client: {
        clientId: "open-interest-clusters",
        clientVersion: "0.1.0"
      },
      threatInfo: {
        threatTypes: [
          "MALWARE",
          "SOCIAL_ENGINEERING",
          "UNWANTED_SOFTWARE",
          "POTENTIALLY_HARMFUL_APPLICATION"
        ],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: deduped.map((url) => ({ url }))
      }
    };

    const response = await this.fetchWithRetry(payload);

    const matches = Array.isArray(response.matches)
      ? (response.matches as Array<Record<string, unknown>>)
      : [];

    const threatMap = new Map<string, SafeBrowsingThreat[]>();

    for (const match of matches) {
      const threat = typeof match.threat === "object" && match.threat !== null
        ? (match.threat as Record<string, unknown>)
        : undefined;

      const url = typeof threat?.url === "string" ? threat.url : undefined;

      if (!url) {
        continue;
      }

      const existing = threatMap.get(url) ?? [];
      const safeThreat: SafeBrowsingThreat = {
        threatType: typeof match.threatType === "string" ? match.threatType : "UNKNOWN",
        platformType: typeof match.platformType === "string" ? match.platformType : "UNKNOWN",
        threatEntryType: typeof match.threatEntryType === "string" ? match.threatEntryType : "UNKNOWN"
      };

      if (typeof match.cacheDuration === "string") {
        safeThreat.cacheDuration = match.cacheDuration;
      }

      existing.push(safeThreat);
      threatMap.set(url, existing);
    }

    return deduped.map((url) => ({
      url,
      unsafe: threatMap.has(url),
      threats: threatMap.get(url) ?? []
    }));
  }

  private async fetchWithRetry(payload: unknown): Promise<Record<string, unknown>> {
    return executeWithRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const url = new URL(this.endpoint);
        url.searchParams.set("key", this.apiKey);

        const response = await this.fetchImpl(url.toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new SafeBrowsingRequestError(
            `Safe Browsing request failed with status ${response.status}`,
            { status: response.status, retryable: isRetryableHttpStatus(response.status) }
          );
        }

        return (await response.json()) as Record<string, unknown>;
      } finally {
        clearTimeout(timeout);
      }
    }, {
      attempts: this.retryAttempts,
      initialDelayMs: this.initialRetryDelayMs,
      maxDelayMs: this.maxRetryDelayMs,
      shouldRetry: ({ error }) => {
        if (error instanceof SafeBrowsingRequestError) {
          return error.retryable;
        }

        return true;
      }
    });
  }
}
