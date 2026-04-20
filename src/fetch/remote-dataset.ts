import fetch from "node-fetch";

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
      const response = await fetch(url, {
        headers: lastEtag ? { "If-None-Match": lastEtag } : {}
      });

      if (response.status === 304) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const etag = response.headers.get("etag");
      if (etag) lastEtag = etag;

      const json = await response.json();
      return json;
    } catch (error) {
      attempt++;

      if (attempt >= MAX_RETRIES) {
        throw new Error("Failed to fetch dataset after maximum retries");
      }

      const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.random() * 100;

      await sleep(backoff + jitter);
    }
  }

  throw new Error("Unreachable state");
}
