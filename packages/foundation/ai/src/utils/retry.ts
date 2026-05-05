/**
 * Fetch with exponential backoff retry for Vertex AI calls.
 *
 * Retries on 429 (rate limit), 500, and 503 status codes.
 * Respects the Retry-After header when present.
 * Network errors are also retried up to maxRetries.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok) return response;

      // Retryable HTTP status codes
      if ([429, 500, 503].includes(response.status) && attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 10_000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Non-retryable: return the response so callers can inspect it
      return response;
    } catch (err) {
      // Network / timeout errors — retry with backoff
      lastError = err as Error;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10_000)));
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('fetchWithRetry: all attempts exhausted');
}
