/**
 * Shared helpers for the node:test suites. Not part of the published package.
 */

import { afterEach } from "node:test";

export type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

export interface FetchCall {
  url: string;
  init: RequestInit;
}

export const TOKEN_URL = "https://api.sharesight.com/oauth2/token";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Pass `null` as expiresIn to leave expires_in out of the response body. */
export function tokenResponse(accessToken: string, expiresIn: number | null = 1800): Response {
  return jsonResponse({ access_token: accessToken, token_type: "Bearer", expires_in: expiresIn ?? undefined });
}

export function timeoutError(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

let originalFetch: typeof fetch | undefined;

// Undo any stub after every test in a file that imports this module, so a test cannot leak one.
afterEach(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
});

/** Replaces globalThis.fetch until the current test ends and returns the recorded calls. */
export function stubFetch(handler: FetchHandler): { calls: FetchCall[] } {
  originalFetch ??= globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });

    return handler(url, init);
  }) as typeof fetch;

  return { calls };
}
