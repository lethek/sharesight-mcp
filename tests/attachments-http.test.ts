import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, startMockSharesight } from "./mock-sharesight.js";
import { inheritedEnv } from "./server-env.js";

const indexPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
const LIMIT_MS = 15_000;
const CONTENT = "contract note text";

/** Runs the server in HTTP mode against a mock Sharesight and hands `run` a function that calls a tool over HTTP. */
async function withHttpServer(env: Record<string, string>, run: (call: (name: string, args: object) => Promise<{ isError: boolean; text: string }>, requests: Array<{ path: string; body?: any }>) => Promise<void>) {
  const mock = await startMockSharesight([]);
  const child = spawn(process.execPath, [indexPath, "serve", "--http"], {
    env: { ...inheritedEnv(), SHARESIGHT_BASE_URL: mock.url, SHARESIGHT_CLIENT_ID: MOCK_CLIENT_ID, SHARESIGHT_CLIENT_SECRET: MOCK_CLIENT_SECRET, MCP_PORT: "0", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const timer = setTimeout(() => child.kill(), LIMIT_MS);

  try {
    const url = await new Promise<string>((resolve, reject) => {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/running on (http:\/\/\S+\/mcp)/);
        if (match) resolve(match[1]);
      });
      child.on("close", () => reject(new Error(`server closed before listening. stderr: ${stderr}`)));
    });

    const call = async (name: string, args: object) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
        signal: AbortSignal.timeout(LIMIT_MS),
      });
      const text = await response.text();
      const result = JSON.parse(text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? text).result;

      return { isError: Boolean(result.isError), text: result.content[0].text as string };
    };

    await run(call, mock.requests);
  } finally {
    clearTimeout(timer);
    child.kill();
    await mock.close();
  }
}

describe("attachment_path over HTTP", () => {
  test("is refused when the server has no data root", async () => {
    await withHttpServer({}, async (call, requests) => {
      const result = await call("create_trade", { holding_id: 1, attachment_path: "anything.txt" });

      assert.equal(result.isError, true);
      assert.match(result.text, /no MCP_DATA_ROOT/);
      assert.equal(requests.some((r) => r.path === "/api/v3/trades.json"), false);
    });
  });

  test("works inside the data root and is refused outside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sharesight-mcp-http-"));
    mkdirSync(join(dir, "root"));
    writeFileSync(join(dir, "root", "cn.txt"), CONTENT);
    writeFileSync(join(dir, "outside.txt"), "secret");

    try {
      await withHttpServer({ MCP_DATA_ROOT: join(dir, "root") }, async (call, requests) => {
        const ok = await call("create_trade", { holding_id: 1, attachment_path: "cn.txt" });

        assert.equal(ok.isError, false, ok.text);
        assert.equal(requests.filter((r) => r.body !== undefined).at(-1)!.body.attachment, Buffer.from(CONTENT).toString("base64"));

        const refused = await call("create_trade", { holding_id: 1, attachment_path: "../outside.txt" });

        assert.equal(refused.isError, true);
        assert.match(refused.text, /inside the server's data root/);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
