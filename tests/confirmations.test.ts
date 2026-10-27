import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  HOLDING_WITH_NOTHING_PENDING as NOTHING_PENDING,
  HOLDING_WITH_PENDING_INTEREST as PENDING_INTEREST,
  HOLDING_WITH_PENDING_REINVESTMENT as PENDING_REINVESTMENT,
  HOLDING_WITH_STUCK_INTEREST as STUCK_INTEREST,
  PORTFOLIO_WITH_LONG_LISTS as LONG_LISTS,
  type MockSharesight,
} from "./mock-sharesight.js";
import { walkPages } from "./pages.js";
import { withServer } from "./stdio-session.js";

/** The holding the mock has no pending reinvestment trade for, so a plain confirmation goes straight through */
const PLAIN_HOLDING = 6;

const posts = (mock: MockSharesight) => mock.requests.filter((r) => r.method === "POST" && r.path.startsWith("/api/v2/"));
const lastPost = (mock: MockSharesight) => posts(mock).at(-1)!;

describe("unconfirmed payouts and trades", () => {
  test("list_unconfirmed_payouts keeps only the unconfirmed ones and says which dates it searched", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_unconfirmed_payouts", { portfolio_id: 7 });

      assert.equal(result.isError, false, result.text);
      assert.equal(result.payload.pagination.total, 1);
      assert.deepEqual(result.payload.unconfirmed_payouts, [{ id: null, state: "unconfirmed", company_event_id: 77 }]);
      assert.deepEqual(result.payload.searched, { start_date: "2000-01-01", end_date: "2100-12-31" });
    });
  });

  test("list_unconfirmed_trades keeps only the unconfirmed ones and reports the dates it was given", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_unconfirmed_trades", { portfolio_id: 7, start_date: "2025-01-01" });

      assert.equal(result.payload.pagination.total, 2);
      assert.deepEqual(result.payload.searched, { start_date: "2025-01-01", end_date: "2100-12-31" });
    });
  });

  test("a long unconfirmed list comes in pages from one fetch, oldest first, and the cursor only fits its own query", async () => {
    await withServer([], { MCP_MAX_RESPONSE_CHARS: "5000" }, async (call, mock) => {
      const first = await call("list_unconfirmed_payouts", { portfolio_id: LONG_LISTS });
      const pages = await walkPages(first.payload, async (cursor) => (await call("list_unconfirmed_payouts", { portfolio_id: LONG_LISTS, cursor })).payload);
      const seen: number[] = pages.flatMap((page) => page.unconfirmed_payouts.map((p: { company_event_id: number }) => p.company_event_id));

      assert.equal(first.payload.pagination.total, 60);
      assert.ok(pages.length > 1);
      assert.equal(mock.requests.filter((r) => r.path === `/api/v2/portfolios/${LONG_LISTS}/payouts.json`).length, 1, "later pages come from the cached list");
      assert.equal(seen.length, 60);
      assert.equal(new Set(seen).size, 60);
      assert.deepEqual(seen, [...seen].sort((a, b) => b - a), "oldest first means highest event number first in this data");

      const other = await call("list_unconfirmed_payouts", { portfolio_id: LONG_LISTS, start_date: "2025-01-01", cursor: first.payload.pagination.next_cursor });

      assert.equal(other.isError, true);
      assert.match(other.text, /different query/);
    });
  });

  test("confirm_payout posts the state under payout", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("confirm_payout", { holding_id: PLAIN_HOLDING, company_event_id: 77 });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastPost(mock), { method: "POST", path: "/api/v2/payouts.json", body: { payout: { holding_id: PLAIN_HOLDING, company_event_id: 77, state: "confirmed" } } });
    });
  });

  test("confirm_payout sends the reinvestment as drp_trade_attributes", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("confirm_payout", { holding_id: PENDING_REINVESTMENT, company_event_id: 77, reinvestment: { quantity: 10, price: 1.2 } });

      assert.deepEqual(lastPost(mock).body, {
        payout: { holding_id: PENDING_REINVESTMENT, company_event_id: 77, state: "confirmed", drp_trade_attributes: { dividend_reinvested: true, quantity: 10, price: 1.2, source_adjustment_id: 77 } },
      });
    });
  });

  test("confirm_payout refuses when a reinvestment trade is pending and the caller did not choose", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("confirm_payout", { holding_id: PENDING_REINVESTMENT, company_event_id: 77 });

      assert.equal(result.isError, true);
      assert.match(result.text, /pending reinvestment trade.*quantity 3 at price 4/);
      assert.equal(posts(mock).length, 0);
    });
  });

  test("skip_reinvestment confirms the payout anyway, without sending the flag", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("confirm_payout", { holding_id: PENDING_REINVESTMENT, company_event_id: 77, skip_reinvestment: true });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastPost(mock).body, { payout: { holding_id: PENDING_REINVESTMENT, company_event_id: 77, state: "confirmed" } });
    });
  });

  test("reinvestment and skip_reinvestment together are refused", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("confirm_payout", { holding_id: PENDING_REINVESTMENT, company_event_id: 77, reinvestment: { quantity: 1, price: 1 }, skip_reinvestment: true });

      assert.equal(result.isError, true);
      assert.equal(posts(mock).length, 0);
    });
  });

  test("a reinvestment without company_event_id is refused", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("confirm_payout", { holding_id: PENDING_INTEREST, paid_on: "2025-12-20", reinvestment: { quantity: 1, price: 1 } });

      assert.equal(result.isError, true);
      assert.match(result.text, /company_event_id/);
      assert.equal(posts(mock).length, 0);
    });
  });

  test("confirm_payout can name an interest payout by paid_on", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("confirm_payout", { holding_id: PENDING_INTEREST, paid_on: "2025-12-20" });

      assert.deepEqual(lastPost(mock).body, { payout: { holding_id: PENDING_INTEREST, paid_on: "2025-12-20", state: "confirmed" } });
    });
  });

  test("reject_payout posts the rejected state", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("reject_payout", { holding_id: PENDING_REINVESTMENT, company_event_id: 77 });

      assert.deepEqual(lastPost(mock).body, { payout: { holding_id: PENDING_REINVESTMENT, company_event_id: 77, state: "rejected" } });
    });
  });

  test("rejecting by paid_on succeeds when Sharesight errors but the pending payout is gone", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("reject_payout", { holding_id: PENDING_INTEREST, paid_on: "2025-12-20" });

      assert.equal(result.isError, false, result.text);
      assert.equal(result.payload.rejected, true);
      assert.deepEqual(lastPost(mock).body, { payout: { holding_id: PENDING_INTEREST, paid_on: "2025-12-20", state: "rejected" } });
    });
  });

  test("rejecting by paid_on is refused, and nothing is sent, when no payout is pending on that date", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("reject_payout", { holding_id: NOTHING_PENDING, paid_on: "2025-12-20" });

      assert.equal(result.isError, true);
      assert.match(result.text, /no unconfirmed payout paid on 2025-12-20/);
      assert.equal(posts(mock).length, 0);
    });
  });

  test("rejecting by paid_on reports the error when the payout is still pending", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("reject_payout", { holding_id: STUCK_INTEREST, paid_on: "2025-12-20" });

      assert.equal(result.isError, true);
      assert.match(result.text, /500/);
    });
  });

  test("there is no tool to confirm or reject a trade", async () => {
    await withServer([], {}, async (_call, _mock, request) => {
      const names = (await request("tools/list", {})).result.tools.map((tool: { name: string }) => tool.name);

      assert.equal(names.includes("confirm_trade"), false);
      assert.equal(names.includes("reject_trade"), false);
    });
  });

  test("a payout must be named by exactly one of company_event_id and paid_on, and nothing is sent otherwise", async () => {
    await withServer([], {}, async (call, mock) => {
      for (const name of ["confirm_payout", "reject_payout"]) {
        for (const args of [{ holding_id: PLAIN_HOLDING }, { holding_id: PLAIN_HOLDING, company_event_id: 77, paid_on: "2025-12-20" }]) {
          const result = await call(name, args);

          assert.equal(result.isError, true, name);
          assert.match(result.text, /company_event_id/, name);
        }
      }

      assert.equal(posts(mock).length, 0);
    });
  });
});

describe("v2 reports and account tools", () => {
  test("the reports are fetched from v2 with their options", async () => {
    await withServer([], {}, async (call, mock) => {
      const valuation = await call("get_valuation_report", { portfolio_id: 7, balance_date: "2026-06-30", include_sales: true, grouping: "market" });

      assert.equal(valuation.payload.query, "?balance_date=2026-06-30&include_sales=true&grouping=market");
      assert.equal(mock.requests.at(-1)!.path, "/api/v2/portfolios/7/valuation.json");

      assert.equal((await call("get_capital_gains_report", { portfolio_id: 7 })).isError, false);
      assert.equal((await call("get_unrealised_cgt_report", { portfolio_id: 7, balance_date: "2026-06-30" })).isError, false);
      assert.equal((await call("get_diversity_report", { portfolio_id: 7, grouping: "country" })).isError, false);
    });
  });

  test("get_my_user and list_user_instruments read from v2", async () => {
    await withServer([], {}, async (call, mock) => {
      assert.equal((await call("get_my_user")).isError, false);
      assert.equal(mock.requests.at(-1)!.path, "/api/v2/my_user.json");

      assert.equal((await call("list_user_instruments")).isError, false);
      assert.equal(mock.requests.at(-1)!.path, "/api/v2/user_instruments.json");
    });
  });
});
