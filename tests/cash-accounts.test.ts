import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { lastBody, lastCall, lastRequest } from "./mock-sharesight.js";
import { withServer } from "./stdio-session.js";

const TRANSACTION = { description: "Salary", amount: 100, type_name: "DEPOSIT", date_time: "2026-01-02T00:00:00" };

describe("list_groups", () => {
  test("reads the groups from v2", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("list_groups", {});

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastCall(mock), { method: "GET", path: "/api/v2/groups.json" });
    });
  });
});

describe("cash account tools", () => {
  test("list_cash_accounts reads one portfolio's accounts, or all of them", async () => {
    await withServer([], {}, async (call, mock) => {
      const one = await call("list_cash_accounts", { portfolio_id: 7, date: "2026-06-30" });

      assert.equal(one.payload.query, "?date=2026-06-30");
      assert.equal(lastRequest(mock).path, "/api/v2/portfolios/7/cash_accounts.json");

      await call("list_cash_accounts", {});

      assert.equal(lastRequest(mock).path, "/api/v2/cash_accounts.json");
    });
  });

  test("get_cash_account sends the balance date", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("get_cash_account", { cash_account_id: 3, date: "2026-01-01" });

      assert.equal(result.payload.query, "?date=2026-01-01");
      assert.equal(lastRequest(mock).path, "/api/v2/cash_accounts/3.json");
    });
  });

  test("create_cash_account nests the fields under cash_account", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("create_cash_account", { portfolio_id: 7, name: "Savings", currency: "AUD" });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastBody(mock), { method: "POST", path: "/api/v2/portfolios/7/cash_accounts.json", body: { cash_account: { name: "Savings", currency: "AUD" } } });
    });
  });

  test("update_cash_account sends a flat body", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("update_cash_account", { cash_account_id: 3, name: "Bills", currency: "AUD" });

      assert.deepEqual(lastBody(mock), { method: "PUT", path: "/api/v2/cash_accounts/3.json", body: { name: "Bills", currency: "AUD" } });
    });
  });

  test("delete_cash_account accepts the 204 reply", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("delete_cash_account", { cash_account_id: 3 });

      assert.equal(result.isError, false, result.text);
      assert.equal(result.payload.status, 204);
      assert.deepEqual(lastCall(mock), { method: "DELETE", path: "/api/v2/cash_accounts/3.json" });
    });
  });
});

describe("cash account transaction tools", () => {
  test("list_cash_account_transactions sends its filters", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("list_cash_account_transactions", { cash_account_id: 3, from: "2026-01-01", to: "2026-12-31", foreign_identifier: "x-1" });

      assert.equal(result.payload.query, "?from=2026-01-01&to=2026-12-31&foreign_identifier=x-1");
      assert.equal(lastRequest(mock).path, "/api/v2/cash_accounts/3/cash_account_transactions.json");
    });
  });

  test("create_cash_account_transaction sends a flat body", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("create_cash_account_transaction", { cash_account_id: 3, ...TRANSACTION, foreign_identifier: "x-1" });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastBody(mock), { method: "POST", path: "/api/v2/cash_accounts/3/cash_account_transactions.json", body: { ...TRANSACTION, foreign_identifier: "x-1" } });
    });
  });

  test("update_cash_account_transaction puts the whole transaction by its id", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("update_cash_account_transaction", { transaction_id: 9, ...TRANSACTION, amount: 75 });

      assert.deepEqual(lastBody(mock), { method: "PUT", path: "/api/v2/cash_account_transactions/9.json", body: { ...TRANSACTION, amount: 75 } });
    });
  });

  test("delete_cash_account_transaction accepts the 204 reply", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("delete_cash_account_transaction", { transaction_id: 9 });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastCall(mock), { method: "DELETE", path: "/api/v2/cash_account_transactions/9.json" });
    });
  });

  test("a transaction without its required fields is refused before anything is sent", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("create_cash_account_transaction", { cash_account_id: 3, description: "x" });

      assert.equal(result.isError, true);
      assert.equal(mock.requests.filter((r) => r.path.includes("cash_account")).length, 0);
    });
  });
});
