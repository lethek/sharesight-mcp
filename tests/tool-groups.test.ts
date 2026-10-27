import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { withServer, type Call, type Request } from "./stdio-session.js";
import type { MockSharesight } from "./mock-sharesight.js";

/** Every tool, by feature area, split into the ones that only read and the ones that create, change or delete data. */
const AREAS: Record<string, { read: string[]; write: string[] }> = {
  portfolios: {
    read: ["list_portfolios", "get_portfolio", "get_portfolio_user_setting"],
    write: ["update_portfolio_user_setting"],
  },
  holdings: {
    read: ["list_holdings", "list_portfolio_holdings", "get_holding"],
    write: ["update_holding", "delete_holding"],
  },
  "custom investments": {
    read: ["list_custom_investments", "get_custom_investment"],
    write: ["create_custom_investment", "update_custom_investment", "delete_custom_investment"],
  },
  "custom investment prices": {
    read: ["list_custom_investment_prices"],
    write: ["create_custom_investment_price", "update_custom_investment_price", "delete_custom_investment_price"],
  },
  "coupon rates": {
    read: ["list_coupon_rates"],
    write: ["create_coupon_rate", "update_coupon_rate", "delete_coupon_rate"],
  },
  "performance reports": {
    read: ["get_performance_report", "get_performance_index_chart"],
    write: [],
  },
  "account and reference": {
    read: ["show_coupon_code", "list_countries"],
    write: ["apply_coupon_code", "delete_coupon_code"],
  },
};

const READS = Object.values(AREAS).flatMap((area) => area.read).sort();
const WRITES = Object.values(AREAS).flatMap((area) => area.write).sort();

interface ListedTool {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

const listTools = async (request: Request): Promise<ListedTool[]> => (await request("tools/list", {})).result.tools;
const names = (tools: ListedTool[]) => tools.map((tool) => tool.name).sort();

describe("tool groups", () => {
  test("the server offers exactly the grouped tools", async () => {
    await withServer([], {}, async (_call, _mock, request) => {
      assert.deepEqual(names(await listTools(request)), [...READS, ...WRITES].sort());
      assert.equal(READS.length + WRITES.length, 28);
    });
  });

  test("read tools are marked read-only and write tools are not", async () => {
    await withServer([], {}, async (_call, _mock, request) => {
      for (const tool of await listTools(request)) {
        const isRead = READS.includes(tool.name);

        assert.equal(tool.annotations?.readOnlyHint, isRead, `${tool.name} readOnlyHint`);
      }
    });
  });

  test("the tool name says how the tool is annotated", async () => {
    await withServer([], {}, async (_call, _mock, request) => {
      for (const { name, annotations } of await listTools(request)) {
        const hints = JSON.stringify(annotations);

        if (/^(list|get|show)_/.test(name)) {
          assert.deepEqual(annotations, { readOnlyHint: true }, `${name} ${hints}`);
        } else if (/^(create|apply)_/.test(name)) {
          assert.deepEqual(annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, `${name} ${hints}`);
        } else if (/^update_/.test(name)) {
          assert.deepEqual(annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, `${name} ${hints}`);
        } else if (/^delete_/.test(name)) {
          assert.deepEqual(annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, `${name} ${hints}`);
        } else {
          assert.fail(`${name} does not start with a known verb, so its annotations cannot be checked`);
        }
      }
    });
  });

  test("only the delete tools are marked destructive", async () => {
    await withServer([], {}, async (_call, _mock, request) => {
      const destructive = (await listTools(request)).filter((tool) => tool.annotations?.destructiveHint === true);

      assert.deepEqual(names(destructive), WRITES.filter((name) => name.startsWith("delete_")));
    });
  });
});

describe("read-only mode", () => {
  /** Every request the mock saw that could have changed data. */
  const writesSeen = (mock: MockSharesight) => mock.requests.filter((r) => r.method !== "GET" && r.path !== "/oauth2/token");

  test("MCP_READ_ONLY=true offers only the read tools", async () => {
    await withServer([], { MCP_READ_ONLY: "true" }, async (_call, _mock, request) => {
      const tools = await listTools(request);

      assert.deepEqual(names(tools), READS);
      assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true));
    });
  });

  test("the value is not case sensitive", async () => {
    await withServer([], { MCP_READ_ONLY: " TRUE " }, async (_call, _mock, request) => {
      assert.deepEqual(names(await listTools(request)), READS);
    });
  });

  test("MCP_READ_ONLY=false, or not set, offers everything", async () => {
    await withServer([], { MCP_READ_ONLY: "false" }, async (_call, _mock, request) => {
      assert.equal((await listTools(request)).length, READS.length + WRITES.length);
    });
  });

  test("a write tool cannot be called, and nothing reaches Sharesight", async () => {
    await withServer([], { MCP_READ_ONLY: "true" }, async (call: Call, mock) => {
      for (const [name, args] of [["delete_holding", { holding_id: 1 }], ["update_holding", { holding_id: 1, enable_drp: true }], ["apply_coupon_code", { code: "X" }]] as const) {
        const result = await call(name, args);

        assert.equal(result.isError, true, name);
        assert.match(result.text, new RegExp(name), name);
      }

      assert.deepEqual(writesSeen(mock), []);
    });
  });

  test("read tools still work", async () => {
    await withServer([], { MCP_READ_ONLY: "true" }, async (call) => {
      assert.equal((await call("list_holdings")).isError, false);
    });
  });
});
