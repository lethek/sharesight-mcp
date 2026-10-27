/**
 * Streamable HTTP transport for the MCP server.
 *
 * Serves the stateless 2026-07-28 protocol, and 2025-era clients through the SDK's stateless fallback.
 * Every request gets a fresh server instance, so nothing is shared between requests.
 *
 * @module http
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createMcpHandler, type McpServerFactory } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { errorMessage } from "./error-message.js";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/healthz";

export interface HttpServerOptions {
  factory: McpServerFactory;
  host: string;
  port: number;
  /** Bearer token clients must send. Required unless `host` is a loopback address. */
  authToken?: string;
}

/** How long in-flight requests get to finish after a shutdown signal before their connections are cut. */
const SHUTDOWN_GRACE_MS = 8_000;

/** Longer than the 60s idle timeout of common proxies and load balancers, so they never reuse a connection Node has already closed. */
const KEEP_ALIVE_TIMEOUT_MS = 65_000;

/** Removes the brackets from an IPv6 literal such as "[::1]", which listen() and isIP() do not accept. */
export function stripBrackets(host: string): string {
  return host.replace(/^\[(.*)\]$/, "$1");
}

/** The URL the MCP endpoint is served at, with brackets around an IPv6 address. */
export function endpointUrl(host: string, port: number): string {
  const address = stripBrackets(host);

  return `http://${address.includes(":") ? `[${address}]` : address}:${port}${MCP_PATH}`;
}

export function isLoopbackHost(host: string): boolean {
  const address = stripBrackets(host);

  return address.toLowerCase() === "localhost" || address === "::1" || (isIP(address) === 4 && address.startsWith("127."));
}

/** Throws if the endpoint would be reachable beyond this machine without a token. */
export function assertAuthConfigured(host: string, authToken: string | undefined): void {
  if (!authToken && !isLoopbackHost(host)) {
    throw new Error(`MCP_AUTH_TOKEN is required when listening on ${host}, because the endpoint acts as your Sharesight account.`);
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function hasValidToken(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer (.+)$/i.exec(header);

  // Hash both sides so the comparison is constant-time regardless of length
  return match !== null && timingSafeEqual(sha256(match[1]), sha256(token));
}

function reply(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "text/plain", ...headers });
  res.end(body);
}

/** Answers a request whose handler threw, or drops the connection if the response has already started. */
export function respondToFailure(res: ServerResponse, error: unknown): void {
  console.error(`Unhandled error serving MCP request: ${errorMessage(error)}`);

  if (res.headersSent) {
    res.destroy();
  } else {
    reply(res, 500, "Internal server error");
  }
}

/** Starts the HTTP server and resolves once it is listening. */
export async function startHttpServer(options: HttpServerOptions): Promise<Server> {
  const { factory, port, authToken } = options;
  const host = stripBrackets(options.host);

  assertAuthConfigured(host, authToken);

  // Always stream, so the SDK's keepalive frames stop proxies cutting long calls such as the 180s report endpoints
  const handler = createMcpHandler(factory, {
    responseMode: "sse",
    onerror: (error) => console.error(`MCP request error: ${error.message}`),
  });
  const handle = toNodeHandler(handler);

  // Without a token only local processes can reach the server, so guard against DNS rebinding from a browser
  const validateHost = authToken ? undefined : localhostHostValidation();
  const validateOrigin = authToken ? undefined : localhostOriginValidation();

  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];

    if (path === HEALTH_PATH) {
      reply(res, 200, "ok");
      return;
    }

    if (path !== MCP_PATH) {
      reply(res, 404, "Not found");
      return;
    }

    if (authToken && !hasValidToken(req, authToken)) {
      reply(res, 401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
      return;
    }

    if (validateHost && validateOrigin && (!validateHost(req, res) || !validateOrigin(req, res))) {
      return;
    }

    handle(req, res).catch((error) => respondToFailure(res, error));
  });

  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  server.on("close", () => void handler.close());

  return server;
}

/** Stops accepting connections, lets in-flight requests finish, and cuts what is left after the grace period. */
export function shutdownHttpServer(server: Server, graceMs = SHUTDOWN_GRACE_MS): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    // A connection that finishes its request after close() is kept alive and would hold the server open for the keep-alive timeout
    const idleSweep = setInterval(() => server.closeIdleConnections(), 100);
    timer.unref();
    idleSweep.unref();

    server.close(() => {
      clearTimeout(timer);
      clearInterval(idleSweep);
      resolve();
    });
  });
}
