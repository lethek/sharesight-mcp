import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withServer } from "./stdio-session.js";

const lastBody = (mock: { requests: Array<{ method: string; path: string; body?: any }> }) => mock.requests.filter((r) => r.body !== undefined).at(-1)!;
const lastRequest = (mock: { requests: Array<{ method: string; path: string; body?: any }> }) => mock.requests.at(-1)!;

const ADJUSTMENT = { announced_on: "2026-09-01", goes_ex_on: "2026-09-10", paid_on: "2026-09-20", amount_per_share: 0.5, tax_credit: 0, currency_code: "AUD" };

describe("adjustment tools", () => {
  test("create_adjustment nests the fields under adjustment", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("create_adjustment", { instrument_id: 9, ...ADJUSTMENT, franked_percent: 100 });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastBody(mock), { method: "POST", path: "/api/v3/custom_investments/9/adjustments", body: { adjustment: { ...ADJUSTMENT, franked_percent: 100 } } });
    });
  });

  test("update_adjustment sends only the fields given, under adjustment", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("update_adjustment", { adjustment_id: 4, paid_on: "2026-09-21" });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastBody(mock), { method: "PUT", path: "/api/v3/adjustments/4", body: { adjustment: { paid_on: "2026-09-21" } } });
    });
  });

  test("delete_adjustment deletes by id", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("delete_adjustment", { adjustment_id: 4 });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual({ method: lastRequest(mock).method, path: lastRequest(mock).path }, { method: "DELETE", path: "/api/v3/adjustments/4" });
    });
  });

  test("list_adjustments sends the date range", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_adjustments", { instrument_id: 9, start_date: "2026-09-01", end_date: "2026-09-30" });

      assert.equal(result.payload.query, "?start_date=2026-09-01&end_date=2026-09-30");
    });
  });
});

describe("label tools", () => {
  test("create_label posts the name and holdings", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("create_label", { portfolio_id: 7, label: "growth stocks", holding_ids: [1, 2] });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastBody(mock), { method: "POST", path: "/api/v3/portfolios/7/labels", body: { label: "growth stocks", holding_ids: [1, 2] } });
    });
  });

  test("update_label encodes the label in the path", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("update_label", { portfolio_id: 7, label: "growth stocks", holding_ids: [3] });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastBody(mock), { method: "PUT", path: "/api/v3/portfolios/7/labels/growth%20stocks", body: { label: "growth stocks", holding_ids: [3] } });
    });
  });

  test("get_label and list_labels read", async () => {
    await withServer([], {}, async (call, mock) => {
      assert.equal((await call("get_label", { portfolio_id: 7, label: "growth stocks" })).isError, false);
      assert.equal(lastRequest(mock).path, "/api/v3/portfolios/7/labels/growth%20stocks");

      const listed = await call("list_labels", { portfolio_id: 7, consolidated: true });

      assert.equal(listed.payload.query, "?consolidated=true");
    });
  });

  test("delete_holding_label copes with the empty 204 reply", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("delete_holding_label", { holding_id: 5, label: "growth stocks" });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual({ method: lastRequest(mock).method, path: lastRequest(mock).path }, { method: "DELETE", path: "/api/v3/holdings/5/labels/growth%20stocks" });
    });
  });

  test("delete_label deletes the label from the portfolio", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("delete_label", { portfolio_id: 7, label: "growth stocks" });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual({ method: lastRequest(mock).method, path: lastRequest(mock).path }, { method: "DELETE", path: "/api/v3/portfolios/7/labels/growth%20stocks" });
    });
  });
});
