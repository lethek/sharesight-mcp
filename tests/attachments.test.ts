import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAttachment, type AttachmentSettings } from "../src/tools/attachments.js";
import { lastBody } from "./mock-sharesight.js";
import { withServer } from "./stdio-session.js";

const CONTENT = "contract note text";
const BASE64 = Buffer.from(CONTENT).toString("base64");

const ANYWHERE: AttachmentSettings = { unrestricted: true, maxBytes: 1024 };
const NOWHERE: AttachmentSettings = { unrestricted: false, maxBytes: 1024 };

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
    assert.deepEqual(await withAttachment({ price: 5 } as any, ANYWHERE), { price: 5 });
  });

  test("base64 passes through with its file name", async () => {
    const result = await withAttachment({ price: 5, attachment_base64: BASE64, attachment_filename: "a.txt" }, NOWHERE);

    assert.deepEqual(result, { price: 5, attachment: BASE64, attachment_filename: "a.txt" });
  });

  test("a path is read and encoded, named after the file by default", async () => {
    assert.deepEqual(await withAttachment({ attachment_path: file }, ANYWHERE), { attachment: BASE64, attachment_filename: "note.txt" });
    assert.deepEqual(await withAttachment({ attachment_path: file, attachment_filename: "other.txt" }, ANYWHERE), { attachment: BASE64, attachment_filename: "other.txt" });
  });

  test("a path is refused when there is no data root and paths are not unrestricted", async () => {
    await assert.rejects(withAttachment({ attachment_path: file }, NOWHERE), /no MCP_DATA_ROOT/);
  });

  test("a missing file is an error", async () => {
    await assert.rejects(withAttachment({ attachment_path: join(dir, "missing.txt") }, ANYWHERE), /ENOENT/);
  });

  test("remove sends nulls", async () => {
    assert.deepEqual(await withAttachment({ remove_attachment: true }, ANYWHERE), { attachment: null, attachment_filename: null });
  });

  test("bad combinations are refused", async () => {
    await assert.rejects(withAttachment({ attachment_base64: BASE64 }, ANYWHERE), /attachment_filename is required/);
    await assert.rejects(withAttachment({ attachment_base64: BASE64, attachment_path: file, attachment_filename: "a" }, ANYWHERE), /not both/);
    await assert.rejects(withAttachment({ attachment_filename: "a" }, ANYWHERE), /needs attachment_base64 or attachment_path/);
    await assert.rejects(withAttachment({ remove_attachment: true, attachment_base64: BASE64 }, ANYWHERE), /cannot be combined/);
    await assert.rejects(withAttachment({ attachment_base64: "not base64!", attachment_filename: "a" }, ANYWHERE), /not valid base64/);
  });

  test("remove_attachment: false does nothing", async () => {
    assert.deepEqual(await withAttachment({ remove_attachment: false } as any, ANYWHERE), {});
  });
});

describe("the size limit", () => {
  let dir: string;
  const settings = (maxBytes: number): AttachmentSettings => ({ unrestricted: true, maxBytes });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "sharesight-mcp-size-"));
    writeFileSync(join(dir, "ten.bin"), Buffer.alloc(10, 1));
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  test("a file at the limit is accepted and one byte over is refused", async () => {
    assert.equal((await withAttachment({ attachment_path: join(dir, "ten.bin") }, settings(10))).attachment, Buffer.alloc(10, 1).toString("base64"));
    await assert.rejects(withAttachment({ attachment_path: join(dir, "ten.bin") }, settings(9)), /10 bytes, over the limit of 9 bytes/);
  });

  test("base64 is measured by the file it decodes to", async () => {
    const ten = Buffer.alloc(10, 1).toString("base64");

    assert.ok((await withAttachment({ attachment_base64: ten, attachment_filename: "a" }, settings(10))).attachment);
    await assert.rejects(withAttachment({ attachment_base64: ten, attachment_filename: "a" }, settings(9)), /over the limit of 9 bytes/);
  });

  test("a directory is not a regular file", async () => {
    await assert.rejects(withAttachment({ attachment_path: dir }, settings(1000)), /regular file/);
  });
});

describe("a data root", () => {
  let base: string;
  let root: string;
  let linkMade = false;

  before(() => {
    base = mkdtempSync(join(tmpdir(), "sharesight-mcp-root-"));
    root = join(base, "data");
    mkdirSync(join(root, "sub"), { recursive: true });
    mkdirSync(join(base, "data-evil"));
    writeFileSync(join(root, "sub", "inside.txt"), CONTENT);
    writeFileSync(join(base, "outside.txt"), "secret");
    writeFileSync(join(base, "data-evil", "x.txt"), "secret");

    try {
      symlinkSync(join(base, "outside.txt"), join(root, "link.txt"));
      linkMade = true;
    } catch {
      // Creating a symbolic link can need a privilege the test user lacks (Windows)
    }
  });

  after(() => rmSync(base, { recursive: true, force: true }));

  // The policy an HTTP server gets: nothing is allowed without a root
  const policy = (): AttachmentSettings => ({ root, unrestricted: false, maxBytes: 1024 });
  const read = (path: string) => withAttachment({ attachment_path: path }, policy());

  test("reads a file by path relative to the root, over HTTP too", async () => {
    assert.deepEqual(await read("sub/inside.txt"), { attachment: BASE64, attachment_filename: "inside.txt" });
  });

  test("reads an absolute path that is inside the root", async () => {
    assert.deepEqual(await read(join(root, "sub", "inside.txt")), { attachment: BASE64, attachment_filename: "inside.txt" });
  });

  test("accepts a file whose name merely starts with two dots", async () => {
    writeFileSync(join(root, "..dots.txt"), CONTENT);

    assert.deepEqual(await read("..dots.txt"), { attachment: BASE64, attachment_filename: "..dots.txt" });
  });

  test("refuses a path that climbs out of the root", async () => {
    await assert.rejects(read("../outside.txt"), /inside the server's data root/);
    await assert.rejects(read("sub/../../outside.txt"), /inside the server's data root/);
  });

  test("refuses an absolute path outside the root", async () => {
    await assert.rejects(read(join(base, "outside.txt")), /inside the server's data root/);
  });

  test("refuses a sibling directory that only shares the root's name as a prefix", async () => {
    await assert.rejects(read("../data-evil/x.txt"), /inside the server's data root/);
  });

  test("refuses the root itself", async () => {
    await assert.rejects(read("."), /inside the server's data root/);
  });

  test("refuses a symbolic link that leads out of the root", { skip: !linkMade && "cannot create symbolic links here" }, async () => {
    await assert.rejects(read("link.txt"), /inside the server's data root/);
  });

  test("the root also confines a stdio server", async () => {
    await assert.rejects(withAttachment({ attachment_path: join(base, "outside.txt") }, { root, unrestricted: true, maxBytes: 1024 }), /inside the server's data root/);
  });
});

describe("attachments through the tools", () => {
  test("create_trade nests the fields under trade, with the attachment", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("create_trade", { portfolio_id: 7, instrument_id: 3, description_code: "BUY", quantity: 2, price: 9.5, transaction_date: "2024-01-02", attachment_base64: BASE64, attachment_filename: "cn.txt" });

      assert.equal(result.isError, false);
      assert.deepEqual(lastBody(mock), {
        method: "POST",
        path: "/api/v3/trades.json",
        body: { trade: { portfolio_id: 7, instrument_id: 3, description_code: "BUY", quantity: 2, price: 9.5, transaction_date: "2024-01-02", attachment: BASE64, attachment_filename: "cn.txt" } },
      });
    });
  });

  test("update_trade can remove the attachment, and the id stays out of the body", async () => {
    await withServer([], {}, async (call, mock) => {
      await call("update_trade", { trade_id: 12, comments: "x", remove_attachment: true });

      assert.deepEqual(lastBody(mock), { method: "PUT", path: "/api/v3/trades/12.json", body: { trade: { comments: "x", attachment: null, attachment_filename: null } } });
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
          body: { payout: { type: "au_local_dividend", paid_on: "2024-03-01", au_local_dividend: { trust: false, franked_amount: 10 }, reinvestment_trade: { reinvested: false, quantity: 0 }, attachment: BASE64, attachment_filename: "statement.pdf" } },
        });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with MCP_DATA_ROOT, attachment_path is relative to it and cannot leave it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sharesight-mcp-attach-"));
    mkdirSync(join(dir, "root"));
    writeFileSync(join(dir, "root", "cn.txt"), CONTENT);
    writeFileSync(join(dir, "outside.txt"), "secret");

    try {
      await withServer([], { MCP_DATA_ROOT: join(dir, "root") }, async (call, mock) => {
        const ok = await call("create_trade", { holding_id: 1, attachment_path: "cn.txt" });

        assert.equal(ok.isError, false, ok.text);
        assert.equal(lastBody(mock).body.trade.attachment, BASE64);

        const sent = mock.requests.length;
        const refused = await call("create_trade", { holding_id: 1, attachment_path: "../outside.txt" });

        assert.equal(refused.isError, true);
        assert.match(refused.text, /inside the server's data root/);
        assert.equal(mock.requests.length, sent);
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

  test("update_payout needs reinvestment_trade but not paid_on", async () => {
    await withServer([], {}, async (call, mock) => {
      const missing = await call("update_payout", { payout_id: 9, comments: "x" });

      assert.equal(missing.isError, true);

      const result = await call("update_payout", { payout_id: 9, comments: "x", reinvestment_trade: { reinvested: false, quantity: 0 } });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastBody(mock), { method: "PUT", path: "/api/v3/payouts/9", body: { payout: { comments: "x", reinvestment_trade: { reinvested: false, quantity: 0 } } } });
    });
  });

  test("update_payout sets currency_code through v2 before the v3 update, and needs exchange_rate with it", async () => {
    await withServer([], {}, async (call, mock) => {
      const noRate = await call("update_payout", { payout_id: 9, currency_code: "USD", reinvestment_trade: { reinvested: false, quantity: 0 } });

      assert.equal(noRate.isError, true);
      assert.match(noRate.text, /exchange_rate/);
      assert.equal(mock.requests.filter((r) => r.method === "PUT").length, 0);

      const drp = { reinvested: false, quantity: 0 };
      const result = await call("update_payout", { payout_id: 9, currency_code: "USD", exchange_rate: 0.65, reinvestment_trade: drp });
      const puts = mock.requests.filter((r) => r.method === "PUT").map(({ path, body }) => ({ path, body }));

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(puts, [
        { path: "/api/v2/payouts/9.json", body: { payout: { currency_code: "USD", exchange_rate: 0.65 } } },
        { path: "/api/v3/payouts/9", body: { payout: { exchange_rate: 0.65, reinvestment_trade: drp } } },
      ]);
    });
  });

  test("update_portfolio_user_setting PATCHes the settings under portfolio_user_setting", async () => {
    await withServer([], {}, async (call, mock) => {
      const result = await call("update_portfolio_user_setting", { portfolio_id: 7, grouping: "market", combined: false });

      assert.equal(result.isError, false, result.text);
      assert.deepEqual(lastBody(mock), { method: "PATCH", path: "/api/v3/portfolios/7/user_setting", body: { portfolio_user_setting: { grouping: "market", combined: false } } });
    });
  });

  test("list_portfolio_reports sends the report type", async () => {
    await withServer([], {}, async (call) => {
      const result = await call("list_portfolio_reports", { portfolio_id: 7, type: "tax" });

      assert.equal(result.payload.query, "?type=tax");
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
