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
  trades: {
    read: ["list_trades", "list_holding_trades", "get_trade"],
    write: ["create_trade", "update_trade", "delete_trade"],
  },
  payouts: {
    read: ["list_payouts", "get_payout"],
    write: ["create_payout", "update_payout", "delete_payout"],
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
  adjustments: {
    read: ["list_adjustments", "get_adjustment"],
    write: ["create_adjustment", "update_adjustment", "delete_adjustment"],
  },
  labels: {
    read: ["list_labels", "get_label"],
    write: ["create_label", "update_label", "delete_label", "delete_holding_label"],
  },
  "unconfirmed payouts and trades": {
    read: ["list_unconfirmed_payouts", "list_unconfirmed_trades", "list_rejected_trades"],
    write: ["confirm_payout", "reject_payout"],
  },
  "performance and portfolio reports": {
    read: [
      "get_capital_gains_report",
      "get_unrealised_cgt_report",
      "get_diversity_report",
      "get_valuation_report",
      "get_performance_report",
      "get_performance_index_chart",
      "list_portfolio_reports",
      "get_portfolio_benchmark",
      "get_portfolio_value",
      "get_portfolio_value_data",
    ],
    write: [],
  },
  "account and reference": {
    read: ["show_coupon_code", "get_my_user", "list_user_instruments", "list_countries"],
    write: ["apply_coupon_code", "delete_coupon_code"],
  },
};

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

const READS_DATA: Annotations = { readOnlyHint: true };
const ADDS_DATA: Annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const CHANGES_DATA: Annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const REMOVES_DATA: Annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

/** The annotations a tool must carry, by the verb its name starts with. A new verb is one entry here. */
const VERB_ANNOTATIONS: Record<string, Annotations> = {
  list: READS_DATA,
  get: READS_DATA,
  show: READS_DATA,
  create: ADDS_DATA,
  apply: ADDS_DATA,
  update: CHANGES_DATA,
  confirm: CHANGES_DATA,
  delete: REMOVES_DATA,
  reject: REMOVES_DATA,
};

/** Update tools that can replace or remove an attachment, which cannot be read back, so they are marked destructive. */
const OVERWRITES = ["update_trade", "update_payout"];

const expectedAnnotations = (name: string): Annotations | undefined => (OVERWRITES.includes(name) ? REMOVES_DATA : VERB_ANNOTATIONS[name.split("_")[0]]);

const READS =Object.values(AREAS).flatMap((area) => area.read).sort();
const WRITES = Object.values(AREAS).flatMap((area) => area.write).sort();

interface ListedTool {
  name: string;
  annotations?: Annotations;
}

const listTools = async (request: Request): Promise<ListedTool[]> => (await request("tools/list", {})).result.tools;
const names = (tools: ListedTool[]) => tools.map((tool) => tool.name).sort();

describe("tool groups", () => {
  test("the server offers exactly the grouped tools", async () => {
    await withServer([], {}, async (_call, _mock, request) => {
      assert.deepEqual(names(await listTools(request)), [...READS, ...WRITES].sort());
      assert.equal(READS.length + WRITES.length, 65);
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
        const expected = expectedAnnotations(name);

        assert.ok(expected, `${name} does not start with a known verb, so its annotations cannot be checked`);
        assert.deepEqual(annotations, expected, `${name} ${JSON.stringify(annotations)}`);
      }
    });
  });

  test("only the delete tools and the attachment-overwriting updates are marked destructive", async () => {
    await withServer([], {}, async (_call, _mock, request) => {
      const destructive = (await listTools(request)).filter((tool) => tool.annotations?.destructiveHint === true);

      assert.deepEqual(names(destructive), WRITES.filter((name) => expectedAnnotations(name)?.destructiveHint).sort());
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
