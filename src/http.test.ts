import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isLoopbackHost, startHttpServer } from "./http.js";

const TOKEN = "test-token";

function createTestServer(): McpServer {
  const server = new McpServer({ name: "test-server", version: "0.0.1" });

  server.registerTool(
    "echo",
    { description: "Echoes the text", inputSchema: z.object({ text: z.string() }) },
    async (args) => ({ content: [{ type: "text" as const, text: args.text }] })
  );

  return server;
}

async function listen(authToken?: string): Promise<{ server: Server; url: string }> {
  const server = await startHttpServer({ factory: createTestServer, host: "127.0.0.1", port: 0, authToken });

  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function close(server: Server): Promise<void> {
  server.closeAllConnections();

  return new Promise((resolve) => server.close(() => resolve()));
}

/** Sends one JSON-RPC message the way a 2025-era client does and returns the parsed reply. */
async function rpc(url: string, message: object, headers: Record<string, string> = {}) {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
  const text = await response.text();
  // The reply is either plain JSON or a single SSE event
  const data = text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? text;

  return { status: response.status, body: data ? JSON.parse(data) : undefined };
}

const initialize = {
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "0.0.1" } },
};

describe("HTTP transport with a bearer token", () => {
  let server: Server;
  let url: string;

  before(async () => ({ server, url } = await listen(TOKEN)));
  after(() => close(server));

  const authorized = { Authorization: `Bearer ${TOKEN}` };

  test("rejects a request without a token", async () => {
    const response = await fetch(`${url}/mcp`, { method: "POST", body: "{}" });

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
  });

  test("rejects a wrong token, including one that shares a prefix with the real token", async () => {
    for (const token of ["wrong", `${TOKEN}x`, TOKEN.slice(0, -1)]) {
      const response = await fetch(`${url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" });

      assert.equal(response.status, 401, token);
    }
  });

  test("answers initialize with the server name", async () => {
    const { status, body } = await rpc(url, initialize, authorized);

    assert.equal(status, 200);
    assert.equal(body.result.serverInfo.name, "test-server");
  });

  test("lists and calls tools without a session", async () => {
    const list = await rpc(url, { id: 2, method: "tools/list" }, authorized);
    assert.deepEqual(list.body.result.tools.map((tool: { name: string }) => tool.name), ["echo"]);

    const call = await rpc(url, { id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }, authorized);
    assert.equal(call.body.result.content[0].text, "hi");
  });

  test("serves the health check without a token", async () => {
    const response = await fetch(`${url}/healthz`);

    assert.equal(response.status, 200);
  });

  test("returns 404 for other paths", async () => {
    const response = await fetch(`${url}/other`, { headers: authorized });

    assert.equal(response.status, 404);
  });
});

describe("HTTP transport without a token", () => {
  let server: Server;
  let url: string;

  before(async () => ({ server, url } = await listen()));
  after(() => close(server));

  test("accepts local requests", async () => {
    const { status } = await rpc(url, initialize);

    assert.equal(status, 200);
  });

  test("rejects a Host header that is not local", async () => {
    // fetch cannot override Host, so send the request with node:http
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${url}/mcp`, { method: "POST", headers: { Host: "evil.example", "Content-Type": "application/json" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end("{}");
    });

    assert.equal(status, 403);
  });
});

describe("HTTP startup checks", () => {
  test("refuses a non-loopback host without a token", async () => {
    await assert.rejects(
      startHttpServer({ factory: createTestServer, host: "0.0.0.0", port: 0 }),
      /MCP_AUTH_TOKEN is required/
    );
  });

  test("recognises loopback hosts", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      assert.equal(isLoopbackHost(host), true, host);
    }
    for (const host of ["0.0.0.0", "::", "192.168.1.5", "example.com"]) {
      assert.equal(isLoopbackHost(host), false, host);
    }
  });
});
