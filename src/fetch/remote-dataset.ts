const MAX_RETRIES = 5;
const BASE_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchDatasetWithBackoff(url: string): Promise<unknown> {
  let attempt = 0;
  let lastEtag: string | null = null;

  while (attempt < MAX_RETRIES) {
    try {
      const response: Response = await globalThis.fetch(url, {
        headers: lastEtag ? { "If-None-Match": lastEtag } : {}
      });

      if (response.status === 304) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const etag: string | null = response.headers.get("etag");
      if (etag) {
        lastEtag = etag;
      }

      const json: unknown = await response.json();
      return json;
    } catch {
      attempt += 1;

      if (attempt >= MAX_RETRIES) {
        throw new Error("Failed to load dataset after maximum retries");
      }

      const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * 100;

      await sleep(backoff + jitter);
    }
  }

  throw new Error("Unreachable state");
}
