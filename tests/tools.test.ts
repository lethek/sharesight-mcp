import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startMockSharesight, type MockSharesight } from "./mock-sharesight.js";
import { walkPages } from "./pages.js";
import { inheritedEnv } from "./server-env.js";
import { withServer as runServer, type Call } from "./stdio-session.js";

const indexPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
const LIMIT_MS = 15_000;
const MAX_RESPONSE_CHARS = 6_000;

// 30 holdings: C0..C29, portfolio 1 for the first 20 and portfolio 2 for the rest, every tenth one closed, ASX on odd ids
const HOLDINGS = Array.from({ length: 30 }, (_, i) => ({
  id: 100 + i,
  symbol: `C${i}`,
  valid_position: i % 10 !== 0,
  instrument: { code: `C${i}`, name: `Company ${i}`, market_code: i % 2 ? "ASX" : "NASDAQ" },
  portfolio: { id: i < 20 ? 1 : 2, name: "Portfolio" },
}));

describe("holdings list tools", () => {
  /** A server over the 30 test holdings, with a response size limit small enough that they take several pages. */
  const withServer = <T>(env: Record<string, string>, run: (call: Call, mock: MockSharesight) => Promise<T>) =>
    runServer(HOLDINGS, { MCP_MAX_RESPONSE_CHARS: String(MAX_RESPONSE_CHARS), ...env }, run);

  const codes = (payload: any): string[] => payload.holdings.map((h: any) => h.instrument.code);

  /** Follows next_cursor from a first page to the end, returning every page. */
  async function walk(call: Call, tool: string, args: object): Promise<any[]> {
    return walkPages((await call(tool, args)).payload, async (cursor) => (await call(tool, { cursor })).payload);
  }

  test("calls Sharesight with the client credentials and then a bearer token", async () => {
    await withServer({}, async (call, mock) => {
      assert.equal((await call("list_holdings")).isError, false);
      assert.equal((await call("list_portfolio_holdings", { portfolio_id: 7 })).isError, false);

      assert.equal(mock.tokenRequests, 1, "one token request served both tool calls");
      assert.deepEqual(
        mock.requests.filter((r) => r.path !== "/oauth2/token").map((r) => `${r.method} ${r.path}`),
        ["GET /api/v3/holdings", "GET /api/v3/portfolios/7/holdings"]
      );
    });
  });

  test("reports the credentials error when Sharesight rejects them", async () => {
    // The server exits at startup on rejected credentials, so there is no tool call to make; check the exit instead
    const mock = await startMockSharesight(HOLDINGS);

    try {
      const child = spawn(process.execPath, [indexPath, "serve"], {
        env: { ...inheritedEnv(), SHARESIGHT_BASE_URL: mock.url, SHARESIGHT_CLIENT_ID: "wrong", SHARESIGHT_CLIENT_SECRET: "wrong" },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const timer = setTimeout(() => child.kill(), LIMIT_MS);
      const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
      clearTimeout(timer);

      assert.equal(code, 1);
      assert.match(stderr, /Token request failed \(401\)/);
      assert.equal(mock.tokenRequests, 1);
    } finally {
      await mock.close();
    }
  });

  test("a page stops when the response size limit is reached, and says there is more", async () => {
    await withServer({}, async (call) => {
      const { payload, text } = await call("list_holdings");

      assert.ok(payload.holdings.length > 0 && payload.holdings.length < 30);
      assert.ok(text.length <= MAX_RESPONSE_CHARS, `${text.length} characters is over the ${MAX_RESPONSE_CHARS} limit`);
      assert.equal(payload.pagination.total, 30);
      assert.equal(payload.pagination.returned, payload.holdings.length);
      assert.equal(payload.pagination.has_more, true);
      assert.equal(typeof payload.pagination.next_cursor, "string");
      assert.equal(payload.api_transaction.id, 1, "the rest of the Sharesight response is kept");
    });
  });

  test("following next_cursor returns every holding once, and the last page has no cursor", async () => {
    await withServer({}, async (call) => {
      const pages = await walk(call, "list_holdings", {});
      const all = pages.flatMap(codes);

      assert.ok(pages.length > 1);
      assert.deepEqual(all, Array.from({ length: 30 }, (_, i) => `C${i}`));
      assert.deepEqual(pages.map((p) => p.pagination.has_more), [...Array(pages.length - 1).fill(true), false]);
      assert.equal(pages[pages.length - 1].pagination.next_cursor, null);
    });
  });

  test("a new first page does not change the list a walk in progress is reading", async () => {
    await withServer({}, async (call, mock) => {
      const walkA = (await call("list_holdings")).payload;
      assert.equal(walkA.api_transaction.id, 1);

      const walkB = (await call("list_holdings")).payload;
      assert.equal(walkB.api_transaction.id, 2, "the second walk fetched its own list");

      const nextA = (await call("list_holdings", { cursor: walkA.pagination.next_cursor })).payload;
      const nextB = (await call("list_holdings", { cursor: walkB.pagination.next_cursor })).payload;

      assert.equal(nextA.api_transaction.id, 1, "walk A still reads the list it started from");
      assert.equal(nextB.api_transaction.id, 2);
      assert.equal(mock.holdingsRequests, 2, "no refetch was needed");
    });
  });

  test("a search longer than the limit is rejected", async () => {
    await withServer({}, async (call) => {
      const { isError, text } = await call("list_holdings", { search: "x".repeat(101) });

      assert.equal(isError, true);
      assert.match(text, /search/);
    });
  });

  test("later pages come from the cached list, and a first page is always fetched fresh", async () => {
    await withServer({}, async (call, mock) => {
      const pages = await walk(call, "list_holdings", {});
      assert.deepEqual([...new Set(pages.map((p) => p.api_transaction.id))], [1], "one fetch served every page");
      assert.equal(mock.holdingsRequests, 1);

      assert.equal((await call("list_holdings")).payload.api_transaction.id, 2, "a new first page fetches again");
      assert.equal(mock.holdingsRequests, 2);
    });
  });

  test("with the cache off every page fetches again but the walk still completes", async () => {
    await withServer({ MCP_CACHE_TTL_SECONDS: "0" }, async (call) => {
      const pages = await walk(call, "list_holdings", {});

      assert.deepEqual(pages.map((p) => p.api_transaction.id), pages.map((_, i) => i + 1));
      assert.equal(pages.flatMap(codes).length, 30);
    });
  });

  test("the cursor carries the filters to later pages", async () => {
    await withServer({}, async (call) => {
      // 27 of the 30 holdings have an open position, which takes more than one page
      const pages = await walk(call, "list_holdings", { valid_position: true });
      const all = pages.flatMap(codes);

      assert.ok(pages.length > 1);
      assert.equal(all.length, 27);
      assert.ok(!["C0", "C10", "C20"].some((closed) => all.includes(closed)), "closed holdings stay out of later pages");
      assert.ok(pages.every((p) => p.pagination.total === 27));
    });
  });

  test("a null cursor is treated as no cursor", async () => {
    await withServer({}, async (call) => {
      const { isError, payload } = await call("list_holdings", { cursor: null });

      assert.equal(isError, false);
      assert.equal(payload.holdings[0].instrument.code, "C0");
    });
  });

  test("filters by portfolio, text and position", async () => {
    await withServer({ MCP_MAX_RESPONSE_CHARS: "200000" }, async (call) => {
      assert.equal((await call("list_holdings", { portfolio_id: 2 })).payload.pagination.total, 10);
      assert.equal((await call("list_holdings", { valid_position: false })).payload.pagination.total, 3);
      assert.deepEqual(codes((await call("list_holdings", { search: "company 2" })).payload), ["C2", "C20", "C21", "C22", "C23", "C24", "C25", "C26", "C27", "C28", "C29"]);
    });
  });

  test("limit caps the page and the next cursor continues after it", async () => {
    await withServer({}, async (call) => {
      const first = (await call("list_holdings", { limit: 3 })).payload;
      const second = (await call("list_holdings", { cursor: first.pagination.next_cursor })).payload;

      assert.deepEqual(codes(first), ["C0", "C1", "C2"]);
      assert.deepEqual(codes(second).slice(0, 3), ["C3", "C4", "C5"], "the limit carries over in the cursor");
      assert.equal(second.holdings.length, 3);
    });
  });

  test("repeating the same filters next to a cursor is fine, different ones are refused", async () => {
    await withServer({}, async (call) => {
      const first = (await call("list_holdings", { valid_position: true })).payload;
      const cursor = first.pagination.next_cursor;

      assert.equal((await call("list_holdings", { cursor, valid_position: true })).isError, false);

      const refused = await call("list_holdings", { cursor, valid_position: false });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /different filters/);
    });
  });

  test("a cursor only works for the query it came from", async () => {
    await withServer({}, async (call) => {
      const cursor = (await call("list_holdings")).payload.pagination.next_cursor;

      const otherTool = await call("list_portfolio_holdings", { portfolio_id: 1, cursor });
      assert.equal(otherTool.isError, true);
      assert.match(otherTool.text, /different query/);

      const portfolioCursor = (await call("list_portfolio_holdings", { portfolio_id: 1 })).payload.pagination.next_cursor;
      assert.match((await call("list_portfolio_holdings", { portfolio_id: 2, cursor: portfolioCursor })).text, /different query/);
    });
  });

  test("an altered or invented cursor is refused with advice on how to recover", async () => {
    await withServer({}, async (call) => {
      const cursor = (await call("list_holdings")).payload.pagination.next_cursor as string;
      const [body, signature] = cursor.split(".");
      const forged = `${Buffer.from(JSON.stringify({ scope: "list_holdings", offset: 0, filters: {} })).toString("base64url")}.${signature}`;

      for (const bad of [forged, `${body}.${"A".repeat(signature.length)}`, "not-a-cursor"]) {
        const result = await call("list_holdings", { cursor: bad });

        assert.equal(result.isError, true, bad);
        assert.match(result.text, /Start again without a cursor/);
      }
    });
  });

  test("a cursor from another process is refused unless both share MCP_CURSOR_SECRET", async () => {
    const issue = (env: Record<string, string>) => withServer(env, async (call) => (await call("list_holdings")).payload.pagination.next_cursor as string);
    const use = (env: Record<string, string>, cursor: string) => withServer(env, (call) => call("list_holdings", { cursor }));

    assert.equal((await use({}, await issue({}))).isError, true, "each process has its own secret by default");

    const shared = { MCP_CURSOR_SECRET: "shared-secret" };
    const resumed = await use(shared, await issue(shared));

    assert.equal(resumed.isError, false, "a cursor survives a restart when the secret is fixed");
    assert.ok(resumed.payload.holdings.length > 0);
  });

  test("list_portfolio_holdings pages and filters", async () => {
    await withServer({}, async (call) => {
      const pages = await walk(call, "list_portfolio_holdings", { portfolio_id: 1, market_code: "NASDAQ" });

      assert.deepEqual(pages.flatMap(codes), ["C0", "C2", "C4", "C6", "C8", "C10", "C12", "C14", "C16", "C18", "C20", "C22", "C24", "C26", "C28"]);
      assert.equal(pages[0].pagination.total, 15);
    });
  });

  test("list_portfolio_holdings does not filter by its own portfolio_id", async () => {
    await withServer({ MCP_MAX_RESPONSE_CHARS: "200000" }, async (call) => {
      // The stub returns holdings from portfolios 1 and 2 for any id, as a consolidated view does
      const { payload } = await call("list_portfolio_holdings", { portfolio_id: 9, consolidated: true });

      assert.equal(payload.pagination.total, 30);
    });
  });

  test("a limit above the maximum is rejected", async () => {
    await withServer({}, async (call) => {
      const { isError, text } = await call("list_holdings", { limit: 201 });

      assert.equal(isError, true);
      assert.match(text, /limit/);
    });
  });
});
