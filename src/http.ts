/**
 * Streamable HTTP transport for the MCP server.
 *
 * Serves the stateless 2026-07-28 protocol, and 2025-era clients through the SDK's stateless fallback.
 * Every request gets a fresh server instance, so nothing is shared between requests.
 *
 * @module http
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createMcpHandler, type McpServerFactory } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/healthz";

export interface HttpServerOptions {
  factory: McpServerFactory;
  host: string;
  port: number;
  /** Bearer token clients must send. Required unless `host` is a loopback address. */
  authToken?: string;
}

export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
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

/** Starts the HTTP server and resolves once it is listening. */
export async function startHttpServer(options: HttpServerOptions): Promise<Server> {
  const { factory, host, port, authToken } = options;

  if (!authToken && !isLoopbackHost(host)) {
    throw new Error(`MCP_AUTH_TOKEN is required when listening on ${host}, because the endpoint acts as your Sharesight account.`);
  }

  const handler = createMcpHandler(factory, { onerror: (error) => console.error(`MCP request error: ${error.message}`) });
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

    handle(req, res).catch((error) => {
      console.error(`Unhandled error serving MCP request: ${error instanceof Error ? error.message : String(error)}`);

      if (!res.headersSent) {
        reply(res, 500, "Internal server error");
      }
    });
  });

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
