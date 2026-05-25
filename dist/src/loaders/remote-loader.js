import { deepFreeze } from "../utils/deep-freeze.js";
import { boundedInteger, executeWithRetry } from "../utils/retry-policy.js";
import { DatasetValidationError, validateDataset } from "../validation/validator.js";
export class RemoteDatasetFetchError extends Error {
    status;
    retryable;
    constructor(message, options = {}) {
        super(message);
        this.name = "RemoteDatasetFetchError";
        if (options.status !== undefined) {
            this.status = options.status;
        }
        this.retryable = options.retryable ?? false;
    }
}
function isRetryableHttpStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}
function withOptionalEtag(dataset, etag, notModified) {
    if (etag)
        return { dataset, etag, notModified };
    return { dataset, notModified };
}
export async function fetchRemoteDataset(url, options = {}) {
    const attempts = boundedInteger(options.attempts, 4, 1, 8);
    const initialDelayMs = boundedInteger(options.initialDelayMs, 300, 10, 30_000);
    const maxDelayMs = boundedInteger(options.maxDelayMs, 3_000, initialDelayMs, 120_000);
    const fetchImpl = options.fetchImpl ?? fetch;
    const retryOptions = {
        attempts,
        initialDelayMs,
        maxDelayMs,
        shouldRetry: ({ error }) => {
            if (error instanceof DatasetValidationError || error instanceof SyntaxError) {
                return false;
            }
            if (error instanceof RemoteDatasetFetchError) {
                return error.retryable;
            }
            return true;
        }
    };
    if (options.signal !== undefined) {
        retryOptions.signal = options.signal;
    }
    return executeWithRetry(async () => {
        const headers = new Headers(options.headers ?? {});
        if (options.cache?.etag)
            headers.set("If-None-Match", options.cache.etag);
        const init = { method: "GET", headers };
        if (options.signal)
            init.signal = options.signal;
        const response = await fetchImpl(url, init);
        if (response.status === 304) {
            if (!options.cache?.dataset) {
                throw new RemoteDatasetFetchError("Received 304 Not Modified without a cached dataset.");
            }
            return withOptionalEtag(options.cache.dataset, options.cache.etag, true);
        }
        if (!response.ok) {
            throw new RemoteDatasetFetchError(`Remote dataset fetch failed with status ${response.status}.`, { status: response.status, retryable: isRetryableHttpStatus(response.status) });
        }
        const parsed = await response.json();
        const validated = validateDataset(parsed);
        const frozen = deepFreeze(validated);
        return withOptionalEtag(frozen, response.headers.get("etag"), false);
    }, retryOptions);
}
//# sourceMappingURL=remote-loader.js.map