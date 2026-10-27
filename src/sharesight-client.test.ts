import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { OAuthManager } from "./oauth.js";
import { SharesightClient } from "./sharesight-client.js";
import { TOKEN_URL, jsonResponse, stubFetch, timeoutError, tokenResponse, type FetchCall } from "./test-helpers.js";

const API = "https://api.sharesight.com/api/v3";

const apiCalls = (calls: FetchCall[]) => calls.filter((call) => call.url !== TOKEN_URL);
const tokenCalls = (calls: FetchCall[]) => calls.filter((call) => call.url === TOKEN_URL);
const bearer = (call: FetchCall) => (call.init.headers as Record<string, string>).Authorization;

describe("SharesightClient.request", () => {
  const client = () => new SharesightClient(new OAuthManager({ clientId: "id", clientSecret: "secret" }));

  test("sends the bearer token and parses the JSON response", async () => {
    const stub = stubFetch((url) => (url === TOKEN_URL ? tokenResponse("tok-1") : jsonResponse({ portfolios: [{ id: 1 }] })));

    const result = await client().listPortfolios({});

    assert.deepEqual(result, { portfolios: [{ id: 1 }] });
    assert.equal(apiCalls(stub.calls)[0].url, `${API}/portfolios`);
    assert.equal(bearer(apiCalls(stub.calls)[0]), "Bearer tok-1");
  });

  test("a 401 on a cached token gets a new token and one retry", async () => {
    let tokens = 0;
    let apiHits = 0;
    const stub = stubFetch((url) => {
      if (url === TOKEN_URL) return tokenResponse(`tok-${++tokens}`);

      return ++apiHits === 2 ? jsonResponse({ error: "unauthorized" }, 401) : jsonResponse({ portfolios: [] });
    });
    const c = client();

    await c.listPortfolios({}); // primes the token cache
    const result = await c.listPortfolios({}); // cached tok-1 is rejected, retried with tok-2

    assert.deepEqual(result, { portfolios: [] });
    const api = apiCalls(stub.calls);
    assert.equal(api.length, 3);
    assert.equal(bearer(api[1]), "Bearer tok-1");
    assert.equal(bearer(api[2]), "Bearer tok-2");
    assert.equal(tokenCalls(stub.calls).length, 2);
  });

  test("parallel calls that both get a 401 share one replacement token", { timeout: 5000 }, async () => {
    let tokens = 0;
    let revoked = false;
    let staleHits = 0;
    let openGate: () => void = () => {};
    const replacementIssued = new Promise<void>((resolve) => (openGate = resolve));
    const stub = stubFetch(async (url, init) => {
      if (url === TOKEN_URL) return tokenResponse(`tok-${++tokens}`);

      const authorization = (init.headers as Record<string, string>).Authorization;
      if (authorization === "Bearer tok-2") openGate(); // the first call's retry, so tok-2 is cached
      if (!revoked || authorization !== "Bearer tok-1") return jsonResponse({ portfolios: [] });

      // The second rejection arrives only after the replacement token is cached, which is the
      // moment an unconditional invalidate() would wrongly throw that replacement away.
      if (++staleHits === 2) await replacementIssued;

      return jsonResponse({}, 401);
    });
    const c = client();

    await c.listPortfolios({}); // caches tok-1
    revoked = true;
    await Promise.all([c.listPortfolios({}), c.listPortfolios({})]);

    assert.equal(tokenCalls(stub.calls).length, 2);
  });

  test("the retry shares the first attempt's deadline", async () => {
    let apiHits = 0;
    const stub = stubFetch((url) => {
      if (url === TOKEN_URL) return tokenResponse("tok");

      return ++apiHits === 2 ? jsonResponse({}, 401) : jsonResponse({ portfolios: [] });
    });
    const c = client();

    await c.listPortfolios({});
    await c.listPortfolios({});

    const api = apiCalls(stub.calls);
    assert.equal(api[1].init.signal, api[2].init.signal);
    assert.notEqual(api[0].init.signal, api[1].init.signal);
  });

  test("a 401 on a token fetched for this call is not retried", async () => {
    const stub = stubFetch((url) => (url === TOKEN_URL ? tokenResponse("tok") : jsonResponse({ reason: "Not authorised" }, 401)));

    await assert.rejects(client().listPortfolios({}), /Sharesight API error \(401\): Not authorised/);

    assert.equal(apiCalls(stub.calls).length, 1);
    assert.equal(tokenCalls(stub.calls).length, 1);
  });

  test("a repeated 401 on a cached token is retried only once", async () => {
    let apiHits = 0;
    const stub = stubFetch((url) => {
      if (url === TOKEN_URL) return tokenResponse("tok");

      return ++apiHits === 1 ? jsonResponse({ portfolios: [] }) : jsonResponse({ reason: "Revoked" }, 401);
    });
    const c = client();

    await c.listPortfolios({});
    await assert.rejects(c.listPortfolios({}), /Sharesight API error \(401\): Revoked/);

    assert.equal(apiCalls(stub.calls).length, 3);
  });

  test("a read timeout names the request and limit", async () => {
    stubFetch((url) => {
      if (url === TOKEN_URL) return tokenResponse("tok");
      throw timeoutError();
    });

    await assert.rejects(client().listPortfolios({}), (error: Error) => {
      assert.equal(error.message, "Sharesight API request timed out after 30s (GET /portfolios).");
      assert.equal((error.cause as Error).name, "TimeoutError");
      return true;
    });
  });

  test("a write timeout warns that the change may have been applied", async () => {
    stubFetch((url) => {
      if (url === TOKEN_URL) return tokenResponse("tok");
      throw timeoutError();
    });

    await assert.rejects(client().deleteHolding(1), /\(DELETE \/holdings\/1\)\. The change may still have been applied/);
  });

  test("performance reports get the longer limit", async () => {
    stubFetch((url) => {
      if (url === TOKEN_URL) return tokenResponse("tok");
      throw timeoutError();
    });

    await assert.rejects(client().getPerformanceReport(1, {}), /timed out after 180s \(GET \/portfolios\/1\/performance\)/);
  });

  test("a timeout while reading an error body is reported as a timeout", async () => {
    stubFetch((url) => {
      if (url === TOKEN_URL) return tokenResponse("tok");

      return { ok: false, status: 500, body: null, text: () => Promise.reject(timeoutError()) } as unknown as Response;
    });

    await assert.rejects(client().listPortfolios({}), /timed out after 30s \(GET \/portfolios\)/);
  });
});

// request() recognises a timeout by error.name, so pin what Node's fetch really throws when
// AbortSignal.timeout fires. These use a local server only, never the real API.
describe("Node fetch with AbortSignal.timeout", () => {
  let server: Server;
  let url: string;

  afterEach(() => {
    server.closeAllConnections();
    server.close();
  });

  async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<void> {
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }

  test("rejects with a TimeoutError when the server never responds", async () => {
    await listen(() => {});

    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(100) }), { name: "TimeoutError" });
  });

  test("rejects with a TimeoutError when the body stalls", async () => {
    await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"a":');
    });
    // Generous limit so connecting and receiving headers never time out on a slow runner
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });

    await assert.rejects(response.json(), { name: "TimeoutError" });
  });
});
