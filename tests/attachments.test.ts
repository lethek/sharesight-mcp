import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAttachment } from "../src/tools/attachments.js";
import { withServer } from "./stdio-session.js";

const CONTENT = "contract note text";
const BASE64 = Buffer.from(CONTENT).toString("base64");

describe("withAttachment", () => {
  let dir: string;
  let file: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "sharesight-mcp-attach-"));
    file = join(dir, "note.txt");
    writeFileSync(file, CONTENT);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  test("leaves the other arguments alone when there is no attachment", async () => {
    assert.deepEqual(await withAttachment({ price: 5 } as any, true), { price: 5 });
  });

  test("base64 passes through with its file name", async () => {
    const result = await withAttachment({ price: 5, attachment_base64: BASE64, attachment_filename: "a.txt" }, false);

    assert.deepEqual(result, { price: 5, attachment: BASE64, attachment_filename: "a.txt" });
  });

  test("a path is read and encoded, named after the file by default", async () => {
    assert.deepEqual(await withAttachment({ attachment_path: file }, true), { attachment: BASE64, attachment_filename: "note.txt" });
    assert.deepEqual(await withAttachment({ attachment_path: file, attachment_filename: "other.txt" }, true), { attachment: BASE64, attachment_filename: "other.txt" });
  });

  test("a path is refused when paths are not allowed", async () => {
    await assert.rejects(withAttachment({ attachment_path: file }, false), /only available when the server runs over stdio/);
  });

  test("a missing file is an error", async () => {
    await assert.rejects(withAttachment({ attachment_path: join(dir, "missing.txt") }, true), /ENOENT/);
  });

  test("remove sends nulls", async () => {
    assert.deepEqual(await withAttachment({ remove_attachment: true }, true), { attachment: null, attachment_filename: null });
  });

  test("bad combinations are refused", async () => {
    await assert.rejects(withAttachment({ attachment_base64: BASE64 }, true), /attachment_filename is required/);
    await assert.rejects(withAttachment({ attachment_base64: BASE64, attachment_path: file, attachment_filename: "a" }, true), /not both/);
    await assert.rejects(withAttachment({ attachment_filename: "a" }, true), /needs attachment_base64 or attachment_path/);
    await assert.rejects(withAttachment({ remove_attachment: true, attachment_base64: BASE64 }, true), /cannot be combined/);
    await assert.rejects(withAttachment({ attachment_base64: "not base64!", attachment_filename: "a" }, true), /not valid base64/);
  });

  test("remove_attachment: false does nothing", async () => {
    assert.deepEqual(await withAttachment({ remove_attachment: false } as any, true), {});
  });
});

describe("attachments through the tools", () => {
  const lastBody = (mock: { requests: Array<{ method: string; path: string; body?: any }> }) => mock.requests.filter((r) => r.body !== undefined).at(-1)!;

  test("create_trade sends a flat body with the attachment", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("create_trade", { portfolio_id: 7, instrument_id: 3, description_code: "BUY", quantity: 2, price: 9.5, transaction_date: "2024-01-02", attachment_base64: BASE64, attachment_filename: "cn.txt" });

      assert.equal(result.isError, false);
      assert.deepEqual(lastBody(mock), {
        method: "POST",
        path: "/api/v3/trades.json",
        body: { portfolio_id: 7, instrument_id: 3, description_code: "BUY", quantity: 2, price: 9.5, transaction_date: "2024-01-02", attachment: BASE64, attachment_filename: "cn.txt" },
      });
    });
  });

  test("update_trade can remove the attachment, and the id stays out of the body", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("update_trade", { trade_id: 12, comments: "x", remove_attachment: true });

      assert.deepEqual(lastBody(mock), { method: "PUT", path: "/api/v3/trades/12.json", body: { comments: "x", attachment: null, attachment_filename: null } });
    });
  });

  test("create_payout reads attachment_path over stdio", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sharesight-mcp-attach-"));
    const file = join(dir, "statement.pdf");
    writeFileSync(file, CONTENT);

    try {
      await withServer([], {}, async (call, mock) => {
        const result = await call("create_payout", { holding_id: 4, type: "au_local_dividend", paid_on: "2024-03-01", au_local_dividend: { trust: false, franked_amount: 10 }, attachment_path: file });

        assert.equal(result.isError, false, result.text);
        assert.deepEqual(lastBody(mock), {
          method: "POST",
          path: "/api/v3/holdings/4/payouts",
          body: { type: "au_local_dividend", paid_on: "2024-03-01", au_local_dividend: { trust: false, franked_amount: 10 }, attachment: BASE64, attachment_filename: "statement.pdf" },
        });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("list_trades passes only the dates and identifier as the query", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_trades", { portfolio_id: 7, start_date: "2024-01-01" });

      assert.equal(result.payload.query, "?start_date=2024-01-01");
    });
  });

  test("a bad attachment is an error and nothing is sent", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("create_trade", { holding_id: 1, attachment_base64: BASE64 });

      assert.equal(result.isError, true);
      assert.match(result.text, /attachment_filename is required/);
      assert.equal(mock.requests.some((r) => r.path === "/api/v3/trades.json"), false);
    });
  });
});
