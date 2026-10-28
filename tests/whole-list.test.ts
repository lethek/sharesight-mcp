import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { HOLDING_WITH_LONG_HISTORY, PORTFOLIO_WITH_LONG_LISTS } from "./mock-sharesight.js";
import { walkPages } from "./pages.js";
import { withServer } from "./stdio-session.js";

const SMALL_PAGES = { MCP_MAX_RESPONSE_CHARS: "5000" };

// Each list has its own ids, so a tool routed to the wrong list fails the ids check. Trades go oldest first, the rest newest first.
const CASES = [
  { tool: "list_trades", args: { portfolio_id: PORTFOLIO_WITH_LONG_LISTS }, key: "trades", path: `/api/v3/portfolios/${PORTFOLIO_WITH_LONG_LISTS}/trades.json`, firstId: 1000, oldestFirst: true },
  { tool: "list_holding_trades", args: { holding_id: HOLDING_WITH_LONG_HISTORY }, key: "trades", path: `/api/v3/holdings/${HOLDING_WITH_LONG_HISTORY}/trades.json`, firstId: 1000, oldestFirst: false },
  { tool: "list_payouts", args: { holding_id: HOLDING_WITH_LONG_HISTORY }, key: "payouts", path: `/api/v3/holdings/${HOLDING_WITH_LONG_HISTORY}/payouts`, firstId: 2000, oldestFirst: false },
  { tool: "list_user_instruments", args: {}, key: "instruments", path: "/api/v2/user_instruments.json", firstId: 4000, oldestFirst: true },
  { tool: "list_countries", args: {}, key: "countries", path: "/api/v3/countries", firstId: 3000, oldestFirst: true },
];

describe("lists that Sharesight returns whole", () => {
  for (const { tool, args, key, path, firstId, oldestFirst } of CASES) {
    test(`${tool} comes in pages from one fetch, in a fixed order, with the rest of the reply on every page`, async () => {
      await withServer([], SMALL_PAGES, async (call, mock) => {
        const first = await call(tool, args);
        const pages = await walkPages(first.payload, async (cursor) => (await call(tool, { ...args, cursor })).payload);
        const ids: number[] = pages.flatMap((page) => page[key].map((item: { id: number }) => item.id));
        const expected = Array.from({ length: 80 }, (_, i) => firstId + i);

        assert.equal(first.payload.pagination.total, 80);
        assert.ok(pages.length > 1);
        assert.equal(mock.requests.filter((r) => r.path === path).length, 1, "later pages come from the cached list");
        assert.deepEqual(ids, oldestFirst ? expected : expected.reverse());

        for (const page of pages) {
          assert.deepEqual(page.links, { self: "mock" }, "the rest of Sharesight's reply comes back with every page");
        }
      });
    });
  }

  test("a reply without the list is an error, not an empty list", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_payouts", { holding_id: 7 });

      assert.equal(result.isError, true);
      assert.match(result.text, /no "payouts" list/);
    });
  });

  test("a cursor only fits the tool and query it came from", async () => {
    await withServer([], SMALL_PAGES, async (call) => {
      const first = await call("list_trades", { portfolio_id: PORTFOLIO_WITH_LONG_LISTS });
      const cursor = first.payload.pagination.next_cursor;

      const otherTool = await call("list_holding_trades", { holding_id: HOLDING_WITH_LONG_HISTORY, cursor });
      const otherQuery = await call("list_trades", { portfolio_id: PORTFOLIO_WITH_LONG_LISTS, start_date: "2026-01-01", cursor });

      for (const result of [otherTool, otherQuery]) {
        assert.equal(result.isError, true);
        assert.match(result.text, /different query/);
      }
    });
  });

  test("limit cuts a page short", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_countries", { limit: 10 });

      assert.equal(result.payload.countries.length, 10);
      assert.equal(result.payload.pagination.has_more, true);
    });
  });
});
