import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { request, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { assertAuthConfigured, endpointUrl, isLoopbackHost, respondToFailure, shutdownHttpServer, startHttpServer, stripBrackets } from "./http.js";

const TOKEN = "test-token";
const WAIT_MS = 10_000;

/** Fails the test instead of hanging when `promise` takes longer than WAIT_MS. */
async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), WAIT_MS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function createTestServer(): McpServer {
  const server = new McpServer({ name: "test-server", version: "0.0.1" });

  server.registerTool(
    "echo",
    { description: "Echoes the text", inputSchema: z.object({ text: z.string() }) },
    async (args) => ({ content: [{ type: "text" as const, text: args.text }] })
  );

  return server;
}

async function listen(authToken?: string, factory = createTestServer): Promise<{ server: Server; url: string }> {
  const server = await startHttpServer({ factory, host: "127.0.0.1", port: 0, authToken });

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
    signal: AbortSignal.timeout(WAIT_MS),
  });
  const text = await response.text();
  // The reply is either plain JSON or a single SSE event
  const data = text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? text;

  return { status: response.status, body: data ? JSON.parse(data) : undefined };
}

/** Sends a request with node:http, because fetch does not let a caller set Host or Origin. */
function send(url: string, method: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${url}/mcp`, { method, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.setTimeout(WAIT_MS, () => req.destroy(new Error("Timed out waiting for the response")));
    req.end(method === "POST" ? "{}" : undefined);
  });
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

  for (const mode of ["legacy", "auto", { pin: "2026-07-28" }] as const) {
    test(`a real client connects and calls a tool (${typeof mode === "string" ? mode : `pinned ${mode.pin}`})`, async () => {
      const client = new Client({ name: "test-client", version: "0.0.1" }, { versionNegotiation: { mode } });

      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: authorized } }));

        const call = await client.callTool({ name: "echo", arguments: { text: "hi" } });

        assert.deepEqual(call.content, [{ type: "text", text: "hi" }]);
      } finally {
        await client.close();
      }
    });
  }

  test("answers GET and DELETE with 405 because there are no sessions", async () => {
    const legacyHeaders = { ...authorized, "MCP-Protocol-Version": "2025-06-18", Accept: "text/event-stream" };

    for (const method of ["GET", "DELETE"]) {
      assert.equal(await send(url, method, legacyHeaders), 405, method);
    }
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
    assert.equal(await send(url, "POST", { Host: "evil.example" }), 403);
  });

  test("rejects an Origin header that is not local", async () => {
    assert.equal(await send(url, "POST", { Origin: "http://evil.example" }), 403);
  });
});

describe("HTTP shutdown", () => {
  /** A server whose `slow` tool signals when it starts, then waits until released. */
  function slowServer() {
    let started!: () => void;
    let release!: () => void;
    const hasStarted = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));

    const factory = () => {
      const server = new McpServer({ name: "slow-server", version: "0.0.1" });

      server.registerTool("slow", { description: "Waits for the gate" }, async () => {
        started();
        await gate;

        return { content: [{ type: "text" as const, text: "done" }] };
      });

      return server;
    };

    return { factory, hasStarted, release };
  }

  const callSlow = (url: string) =>
    rpc(url, { id: 1, method: "tools/call", params: { name: "slow", arguments: {} } }, { "MCP-Protocol-Version": "2025-06-18" });

  test("lets an in-flight request finish before closing", async () => {
    const { factory, hasStarted, release } = slowServer();
    const { server, url } = await listen(undefined, factory);

    try {
      const reply = callSlow(url);
      // If a wait below fails first, the reply rejects once the server closes; the test still sees it when it awaits the reply
      reply.catch(() => {});
      await within(hasStarted, "the slow tool to start");

      let closed = false;
      const shutdown = shutdownHttpServer(server, 5_000).then(() => (closed = true));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(closed, false, "closed while a request was still running");

      release();

      assert.equal((await within(reply, "the reply")).body.result.content[0].text, "done");
      await within(shutdown, "shutdown to finish");
    } finally {
      release();
      await close(server);
    }
  });

  test("cuts the connection once the grace period has passed", async () => {
    const { factory, hasStarted, release } = slowServer();
    const { server, url } = await listen(undefined, factory);

    try {
      const reply = callSlow(url).then(
        () => "completed",
        () => "cut"
      );
      await within(hasStarted, "the slow tool to start");

      await within(shutdownHttpServer(server, 50), "shutdown to finish");

      assert.equal(await within(reply, "the connection to be cut"), "cut");
    } finally {
      release();
      await close(server);
    }
  });
});

describe("HTTP failure handling", () => {
  /** A stand-in for ServerResponse that records which way the failure was handled. */
  function fakeResponse(headersSent: boolean) {
    const calls: string[] = [];
    const res = {
      headersSent,
      writeHead: (status: number) => calls.push(`writeHead ${status}`),
      end: () => calls.push("end"),
      destroy: () => calls.push("destroy"),
    };

    return { res: res as unknown as ServerResponse, calls };
  }

  test("answers 500 when nothing has been sent yet", () => {
    const log = mock.method(console, "error", () => {});
    const { res, calls } = fakeResponse(false);

    try {
      respondToFailure(res, new Error("boom"));
    } finally {
      log.mock.restore();
    }

    assert.deepEqual(calls, ["writeHead 500", "end"]);
    assert.match(String(log.mock.calls[0].arguments[0]), /boom/);
  });

  test("drops the connection when the response has already started", () => {
    const log = mock.method(console, "error", () => {});
    const { res, calls } = fakeResponse(true);

    try {
      respondToFailure(res, new Error("boom"));
    } finally {
      log.mock.restore();
    }

    assert.deepEqual(calls, ["destroy"]);
  });
});

describe("HTTP startup checks", () => {
  test("builds the endpoint URL, bracketing IPv6 addresses", () => {
    assert.equal(endpointUrl("127.0.0.1", 3000), "http://127.0.0.1:3000/mcp");
    assert.equal(endpointUrl("::1", 3000), "http://[::1]:3000/mcp");
    assert.equal(endpointUrl("[::1]", 3000), "http://[::1]:3000/mcp");
  });

  test("strips brackets only around a whole IPv6 literal", () => {
    assert.equal(stripBrackets("[::1]"), "::1");
    assert.equal(stripBrackets("::1"), "::1");
    assert.equal(stripBrackets("example.com"), "example.com");
  });

  test("refuses a non-loopback host without a token", async () => {
    await assert.rejects(
      startHttpServer({ factory: createTestServer, host: "0.0.0.0", port: 0 }),
      /MCP_AUTH_TOKEN is required/
    );
  });

  test("allows a non-loopback host when a token is set", () => {
    assert.doesNotThrow(() => assertAuthConfigured("0.0.0.0", TOKEN));
  });

  test("recognises loopback hosts", () => {
    for (const host of ["127.0.0.1", "127.0.0.2", "localhost", "LOCALHOST", "Localhost", "::1", "[::1]"]) {
      assert.equal(isLoopbackHost(host), true, host);
    }
  });

  test("does not treat other hosts as loopback, including names that start with 127.", () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.5", "example.com", "127.example.com", "127.0.0.1.example.com"]) {
      assert.equal(isLoopbackHost(host), false, host);
    }
  });
});
