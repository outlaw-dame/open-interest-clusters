import { deepFreeze } from "../utils/deep-freeze.js";
import { executeWithRetry } from "../utils/retry-policy.js";
import { DatasetValidationError, validateDataset } from "../validation/validator.js";
import type { InterestClusterDataset } from "../types/schema.js";

export interface RemoteDatasetCache { etag?: string; dataset?: Readonly<InterestClusterDataset>; }
export interface FetchRemoteDatasetOptions {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  cache?: RemoteDatasetCache;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}
export interface FetchRemoteDatasetResult { dataset: Readonly<InterestClusterDataset>; etag?: string; notModified: boolean; }
export class RemoteDatasetFetchError extends Error {
  public readonly status?: number;
  public readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "RemoteDatasetFetchError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function boundedPositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value ?? fallback)));
}

function withOptionalEtag(dataset: Readonly<InterestClusterDataset>, etag: string | null | undefined, notModified: boolean): FetchRemoteDatasetResult {
  if (etag) return { dataset, etag, notModified };
  return { dataset, notModified };
}
export async function fetchRemoteDataset(url: string, options: FetchRemoteDatasetOptions = {}): Promise<FetchRemoteDatasetResult> {
  const attempts = boundedPositiveInteger(options.attempts, 4, 1, 8);
  const initialDelayMs = boundedPositiveInteger(options.initialDelayMs, 300, 10, 30_000);
  const maxDelayMs = boundedPositiveInteger(options.maxDelayMs, 3_000, initialDelayMs, 120_000);
  const fetchImpl = options.fetchImpl ?? fetch;

  return executeWithRetry(async () => {
      const headers = new Headers(options.headers ?? {});
      if (options.cache?.etag) headers.set("If-None-Match", options.cache.etag);
      const init: RequestInit = { method: "GET", headers };
      if (options.signal) init.signal = options.signal;
      const response = await fetchImpl(url, init);
      if (response.status === 304) {
        if (!options.cache?.dataset) {
          throw new RemoteDatasetFetchError("Received 304 Not Modified without a cached dataset.");
        }

        return withOptionalEtag(options.cache.dataset, options.cache.etag, true);
      }

      if (!response.ok) {
        throw new RemoteDatasetFetchError(
          `Remote dataset fetch failed with status ${response.status}.`,
          { status: response.status, retryable: isRetryableHttpStatus(response.status) }
        );
      }

      const parsed: unknown = await response.json();
      const validated = validateDataset(parsed);
      const frozen = deepFreeze(validated);
      return withOptionalEtag(frozen, response.headers.get("etag"), false);
  }, {
    attempts,
    initialDelayMs,
    maxDelayMs,
    signal: options.signal,
    shouldRetry: ({ error }) => {
      if (error instanceof DatasetValidationError || error instanceof SyntaxError) {
        return false;
      }

      if (error instanceof RemoteDatasetFetchError) {
        return error.retryable;
      }

      return true;
    }
  });
}
