import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { OAuthManager, TokenRequestError } from "../src/oauth.js";
import { TOKEN_URL, jsonResponse, stubFetch, tokenResponse } from "./test-helpers.js";

describe("OAuthManager", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["Date"] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  const manager = () => new OAuthManager({ clientId: "id", clientSecret: "secret" });

  test("requests a token with the client credentials grant and caches it", async () => {
    const stub = stubFetch(() => tokenResponse("tok-1"));
    const oauth = manager();

    assert.equal(oauth.hasToken(), false);
    assert.equal(await oauth.getValidAccessToken(), "tok-1");
    assert.equal(await oauth.getValidAccessToken(), "tok-1");

    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, TOKEN_URL);
    const body = new URLSearchParams(String(stub.calls[0].init.body));
    assert.equal(body.get("grant_type"), "client_credentials");
    assert.equal(body.get("client_id"), "id");
    assert.equal(body.get("client_secret"), "secret");
    assert.equal(oauth.hasToken(), true);
  });

  test("concurrent callers share one in-flight token request", async () => {
    const stub = stubFetch(() => tokenResponse("tok-1"));
    const oauth = manager();

    const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => oauth.getValidAccessToken()));

    assert.deepEqual(tokens, Array(5).fill("tok-1"));
    assert.equal(stub.calls.length, 1);
  });

  test("requests a new token once the cached one is within a minute of expiry", async () => {
    let n = 0;
    const stub = stubFetch(() => tokenResponse(`tok-${++n}`, 120));
    const oauth = manager();

    assert.equal(await oauth.getValidAccessToken(), "tok-1");
    mock.timers.tick(59_000);
    assert.equal(await oauth.getValidAccessToken(), "tok-1");
    mock.timers.tick(2_000);
    assert.equal(await oauth.getValidAccessToken(), "tok-2");
    assert.equal(stub.calls.length, 2);
  });

  test("a token valid for 60 seconds or less is still cached, refreshed at half its lifetime", async () => {
    const stub = stubFetch(() => tokenResponse("tok", 30));
    const oauth = manager();

    await oauth.getValidAccessToken();
    mock.timers.tick(14_000);
    await oauth.getValidAccessToken();
    assert.equal(stub.calls.length, 1);

    mock.timers.tick(2_000);
    await oauth.getValidAccessToken();
    assert.equal(stub.calls.length, 2);
  });

  test("falls back to a 30 minute lifetime when expires_in is missing", async () => {
    const stub = stubFetch(() => tokenResponse("tok", null));
    const oauth = manager();

    await oauth.getValidAccessToken();
    mock.timers.tick(1_700_000);
    await oauth.getValidAccessToken();
    assert.equal(stub.calls.length, 1);

    mock.timers.tick(100_000);
    await oauth.getValidAccessToken();
    assert.equal(stub.calls.length, 2);
  });

  test("invalidate only clears the token that was rejected", async () => {
    let n = 0;
    stubFetch(() => tokenResponse(`tok-${++n}`));
    const oauth = manager();

    await oauth.getValidAccessToken();
    oauth.invalidate("some-older-token");
    assert.equal(oauth.hasToken(), true);

    oauth.invalidate("tok-1");
    assert.equal(oauth.hasToken(), false);
    assert.equal(await oauth.getValidAccessToken(), "tok-2");
  });

  test("credential errors carry the status and an account linking hint", async () => {
    stubFetch(() => jsonResponse({ error: "invalid_client" }, 401));

    await assert.rejects(manager().getValidAccessToken(), (error) => {
      assert.ok(error instanceof TokenRequestError);
      assert.equal(error.status, 401);
      assert.equal(error.isCredentialError, true);
      assert.match(error.message, /Token request failed \(401\)/);
      assert.match(error.message, /linked to the API application/);
      assert.match(error.stack ?? "", /linked to the API application/);
      return true;
    });
  });

  test("server errors are not treated as credential errors and get no hint", async () => {
    stubFetch(() => jsonResponse({ error: "unavailable" }, 503));

    await assert.rejects(manager().getValidAccessToken(), (error) => {
      assert.ok(error instanceof TokenRequestError);
      assert.equal(error.isCredentialError, false);
      assert.doesNotMatch(error.message, /linked to the API application/);
      return true;
    });
  });

  test("a failed request does not stick: the next call tries again", async () => {
    let fail = true;
    const stub = stubFetch(() => (fail ? jsonResponse({ error: "unavailable" }, 503) : tokenResponse("tok-ok")));
    const oauth = manager();

    await assert.rejects(oauth.getValidAccessToken());
    fail = false;
    assert.equal(await oauth.getValidAccessToken(), "tok-ok");
    assert.equal(stub.calls.length, 2);
  });

  test("the token request carries an abort signal", async () => {
    const stub = stubFetch(() => tokenResponse("tok"));

    await manager().getValidAccessToken();

    assert.ok(stub.calls[0].init.signal instanceof AbortSignal);
  });
});
