import { setTimeout as sleep } from "node:timers/promises";
import { deepFreeze } from "../utils/deep-freeze.js";
import { validateDataset } from "../validation/validator.js";
export class RemoteDatasetFetchError extends Error {
    constructor(message) { super(message); this.name = "RemoteDatasetFetchError"; }
}
function jitteredBackoff(delayMs, maxDelayMs) {
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(delayMs * 0.2)));
    return Math.min(maxDelayMs, delayMs + jitter);
}
function withOptionalEtag(dataset, etag, notModified) {
    if (etag)
        return { dataset, etag, notModified };
    return { dataset, notModified };
}
export async function fetchRemoteDataset(url, options = {}) {
    const attempts = options.attempts ?? 4;
    const initialDelayMs = options.initialDelayMs ?? 300;
    const maxDelayMs = options.maxDelayMs ?? 3000;
    const fetchImpl = options.fetchImpl ?? fetch;
    let delayMs = initialDelayMs;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const headers = new Headers(options.headers ?? {});
            if (options.cache?.etag)
                headers.set("If-None-Match", options.cache.etag);
            const init = { method: "GET", headers };
            if (options.signal)
                init.signal = options.signal;
            const response = await fetchImpl(url, init);
            if (response.status === 304) {
                if (!options.cache?.dataset)
                    throw new RemoteDatasetFetchError("Received 304 Not Modified without a cached dataset.");
                return withOptionalEtag(options.cache.dataset, options.cache.etag, true);
            }
            if (!response.ok)
                throw new RemoteDatasetFetchError(`Remote dataset fetch failed with status ${response.status}.`);
            const parsed = await response.json();
            const validated = validateDataset(parsed);
            const frozen = deepFreeze(validated);
            return withOptionalEtag(frozen, response.headers.get("etag"), false);
        }
        catch (error) {
            lastError = error;
            if (options.signal?.aborted === true || attempt == attempts)
                break;
            await sleep(jitteredBackoff(delayMs, maxDelayMs), undefined, options.signal ? { signal: options.signal } : undefined);
            delayMs = Math.min(maxDelayMs, delayMs * 2);
        }
    }
    if (lastError instanceof Error)
        throw lastError;
    throw new RemoteDatasetFetchError("Remote dataset fetch failed for an unknown reason.");
}
//# sourceMappingURL=remote-loader.js.map