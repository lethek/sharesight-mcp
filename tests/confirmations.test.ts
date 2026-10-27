import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withServer } from "./stdio-session.js";

type Seen = { requests: Array<{ method: string; path: string; body?: any }> };

const lastPost = (mock: Seen) => mock.requests.filter((r) => r.method === "POST" && r.path.startsWith("/api/v2/")).at(-1)!;
const noPost = (mock: Seen) => mock.requests.filter((r) => r.method === "POST" && r.path.startsWith("/api/v2/")).length === 0;

describe("unconfirmed payouts and trades", () => {
  test("list_unconfirmed_payouts keeps only the unconfirmed ones and asks for a wide date range", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_unconfirmed_payouts", { portfolio_id: 7 });

      assert.equal(result.isError, false, result.text);
      assert.equal(result.payload.count, 1);
      assert.deepEqual(result.payload.unconfirmed_payouts, [{ id: null, state: "unconfirmed", company_event_id: 77 }]);
    });
  });

  test("list_unconfirmed_trades keeps only the unconfirmed ones", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_unconfirmed_trades", { portfolio_id: 7, start_date: "2025-01-01" });

      assert.equal(result.payload.count, 2);
    });
  });

  test("confirm_payout posts the state under payout", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("confirm_payout", { holding_id: 5, company_event_id: 77 });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastPost(mock), { method: "POST", path: "/api/v2/payouts.json", body: { payout: { holding_id: 5, company_event_id: 77, state: "confirmed" } } });
    });
  });

  test("confirm_payout sends the reinvestment as drp_trade_attributes", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("confirm_payout", { holding_id: 5, company_event_id: 77, reinvestment: { quantity: 10, price: 1.2 } });

      assert.deepEqual(lastPost(mock).body, {
        payout: { holding_id: 5, company_event_id: 77, state: "confirmed", drp_trade_attributes: { dividend_reinvested: true, quantity: 10, price: 1.2, source_adjustment_id: 77 } },
      });
    });
  });

  test("confirm_payout can name an interest payout by paid_on", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("confirm_payout", { holding_id: 5, paid_on: "2025-12-20" });

      assert.deepEqual(lastPost(mock).body, { payout: { holding_id: 5, paid_on: "2025-12-20", state: "confirmed" } });
    });
  });

  test("reject_payout posts the rejected state", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("reject_payout", { holding_id: 5, company_event_id: 77 });

      assert.deepEqual(lastPost(mock).body, { payout: { holding_id: 5, company_event_id: 77, state: "rejected" } });
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
      for (const args of [{ holding_id: 5 }, { holding_id: 5, company_event_id: 77, paid_on: "2025-12-20" }]) {
        const result = await call("confirm_payout", args);

        assert.equal(result.isError, true);
        assert.match(result.text, /company_event_id/);
      }

      assert.equal(noPost(mock), true);
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
