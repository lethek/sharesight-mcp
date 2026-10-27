import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, startMockSharesight, type MockSharesight } from "./mock-sharesight.js";
import { inheritedEnv } from "./server-env.js";

const indexPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
const LIMIT_MS = 15_000;

export interface ToolResult {
  isError: boolean;
  text: string;
  payload: any;
}

export type Call = (name: string, args?: object) => Promise<ToolResult>;

/** Sends any JSON-RPC request and resolves with the whole reply message. */
export type Request = (method: string, params: object) => Promise<any>;

/**
 * Runs one server process on stdio against its own mock Sharesight API serving `holdings`, so calls inside `run` share the
 * server's cache and secret. The mock numbers each holdings reply, which lets a test tell a fresh fetch from a cached list.
 */
export async function withServer<T>(
  holdings: object[],
  env: Record<string, string>,
  run: (call: Call, mock: MockSharesight, request: Request) => Promise<T>
): Promise<T> {
  const mock = await startMockSharesight(holdings);
  const child = spawn(process.execPath, [indexPath, "serve"], {
    env: {
      ...inheritedEnv(),
      SHARESIGHT_BASE_URL: mock.url,
      SHARESIGHT_CLIENT_ID: MOCK_CLIENT_ID,
      SHARESIGHT_CLIENT_SECRET: MOCK_CLIENT_SECRET,
      ...env,
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const timer = setTimeout(() => child.kill(), LIMIT_MS);
  const waiting = new Map<number, (message: any) => void>();
  let buffer = "";
  let nextId = 1;

  child.stdout.on("data", (chunk) => {
    buffer += chunk;

    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      waiting.get(message.id)?.(message);
    }
  });

  const request: Request = (method, params) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.once("close", () => reject(new Error("server closed before replying")));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  const call: Call = async (name, args = {}) => {
    const message = await request("tools/call", { name, arguments: args });
    const result = message.result ?? { content: [{ text: JSON.stringify(message.error) }], isError: true };
    const text: string = result.content[0].text;

    return { isError: Boolean(result.isError), text, payload: result.isError ? undefined : JSON.parse(text) };
  };

  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    return await run(call, mock, request);
  } finally {
    clearTimeout(timer);
    child.kill();
    await mock.close();
  }
}
