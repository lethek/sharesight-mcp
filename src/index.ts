#!/usr/bin/env node

/**
 * Sharesight MCP Server
 *
 * A CLI tool with one command:
 * - `sharesight-mcp serve` - Run the MCP server (default)
 *
 * @see https://api.sharesight.com/doc/api/v3
 * @see https://modelcontextprotocol.io/
 *
 * @module index
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { statSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { SharesightClient } from "./sharesight-client.js";
import { DEFAULT_BASE_URL, OAuthManager, TokenRequestError } from "./oauth.js";
import { MCP_PATH, assertAuthConfigured, endpointUrl, isLoopbackHost, shutdownHttpServer, startHttpServer, type HttpServerOptions } from "./http.js";
import { errorMessage } from "./error-message.js";
import { VERSION } from "./version.js";
import { MemoryCache } from "./cache.js";
import { CursorCodec } from "./cursor.js";
import { HoldingsLister } from "./holdings-list.js";
import { registerTools } from "./tools/index.js";

const DEFAULT_MAX_RESPONSE_CHARS = 30_000;
const MIN_MAX_RESPONSE_CHARS = 5_000;
const DEFAULT_CACHE_TTL_SECONDS = 60;
/** Each entry is a whole holdings list, so keep few: enough for several walks at once, not enough to hold much memory */
const MAX_CACHED_LISTS = 20;

const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 3000;

// ============================================================================
// Serve Command
// ============================================================================

/**
 * Reads SHARESIGHT_BASE_URL, which replaces https://api.sharesight.com for tests or a proxy. The client secret is sent to it, so
 * plain http is only accepted for this machine.
 */
function readBaseUrl(env: NodeJS.ProcessEnv): string {
  const text = env.SHARESIGHT_BASE_URL?.trim() || DEFAULT_BASE_URL;

  try {
    const url = new URL(text);

    // A query or fragment would end up in the middle of the endpoint paths added after it
    const hasQueryOrFragment = url.search !== "" || url.hash !== "";

    if (!hasQueryOrFragment && (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname)))) {
      return text;
    }
  } catch {
    // Reported below with the other invalid values
  }

  throw new Error(`SHARESIGHT_BASE_URL must be an https URL, or an http URL for localhost, without a query or fragment, got "${text}".`);
}

/** Reads MCP_READ_ONLY: true leaves out every tool that creates, changes or deletes data. */
function readReadOnly(env: NodeJS.ProcessEnv): boolean {
  const text = env.MCP_READ_ONLY?.trim().toLowerCase() || "false";

  if (text !== "true" && text !== "false") {
    throw new Error(`MCP_READ_ONLY must be "true" or "false", got "${env.MCP_READ_ONLY}".`);
  }

  return text === "true";
}

/** Reads MCP_DATA_ROOT: the directory attachment_path reads from. It must exist, so a typo is caught at startup. */
function readDataRoot(env: NodeJS.ProcessEnv): string | undefined {
  const text = env.MCP_DATA_ROOT?.trim();

  if (!text) {
    return undefined;
  }

  const root = resolve(text);

  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`MCP_DATA_ROOT must be an existing directory, got "${text}".`);
  }

  return root;
}

function createOAuthManager(baseUrl: string): OAuthManager {
  const clientId = process.env.SHARESIGHT_CLIENT_ID?.trim();
  const clientSecret = process.env.SHARESIGHT_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    console.error(
      "Error: Missing credentials. Set SHARESIGHT_CLIENT_ID and SHARESIGHT_CLIENT_SECRET environment variables."
    );
    process.exit(1);
  }

  return new OAuthManager({ clientId, clientSecret, baseUrl });
}

type HttpConfig = Omit<HttpServerOptions, "factory">;

/** Reads the `serve` options. Returns the HTTP settings when HTTP is selected, or undefined for stdio. */
function readServeConfig(args: string[], env: NodeJS.ProcessEnv): HttpConfig | undefined {
  const unknown = args.find((arg) => arg !== "--http");

  if (unknown) {
    throw new Error(`Unknown option for serve: ${unknown}`);
  }

  const transport = env.MCP_TRANSPORT?.trim().toLowerCase() || undefined;
  const httpFlag = args.includes("--http");

  if (transport !== undefined && transport !== "stdio" && transport !== "http") {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http", got "${env.MCP_TRANSPORT}".`);
  }

  if (httpFlag && transport === "stdio") {
    throw new Error("--http conflicts with MCP_TRANSPORT=stdio. Remove one of them.");
  }

  if (!httpFlag && transport !== "http") {
    return undefined;
  }

  const host = env.MCP_HOST?.trim() || DEFAULT_HTTP_HOST;
  const portText = env.MCP_PORT?.trim() || String(DEFAULT_HTTP_PORT);
  const port = Number(portText);
  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;

  if (!/^\d+$/.test(portText) || port > 65535) {
    throw new Error(`MCP_PORT must be an integer from 0 to 65535, got "${portText}".`);
  }

  assertAuthConfigured(host, authToken);

  return { host, port, authToken };
}

interface ListingSettings {
  maxResponseChars: number;
  cacheTtlSeconds: number;
  cursorSecret?: string;
}

/** Reads the settings for paged list tools, which apply to both transports. */
function readListingSettings(env: NodeJS.ProcessEnv): ListingSettings {
  const integer = (name: string, fallback: number, min: number): number => {
    const text = env[name]?.trim() || String(fallback);
    const value = Number(text);

    if (!/^\d+$/.test(text) || value < min) {
      throw new Error(`${name} must be a whole number of at least ${min}, got "${text}".`);
    }

    return value;
  };

  return {
    maxResponseChars: integer("MCP_MAX_RESPONSE_CHARS", DEFAULT_MAX_RESPONSE_CHARS, MIN_MAX_RESPONSE_CHARS),
    cacheTtlSeconds: integer("MCP_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS, 0),
    cursorSecret: env.MCP_CURSOR_SECRET?.trim() || undefined,
  };
}

async function runServe(): Promise<void> {
  // Check the options before anything slow, so a typo is reported straight away
  let httpConfig: HttpConfig | undefined;
  let listing: ListingSettings;
  let baseUrl: string;
  let readOnly: boolean;
  let dataRoot: string | undefined;

  try {
    httpConfig = readServeConfig(process.argv.slice(3), process.env);
    listing = readListingSettings(process.env);
    baseUrl = readBaseUrl(process.env);
    readOnly = readReadOnly(process.env);
    dataRoot = readDataRoot(process.env);
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  const oauth = createOAuthManager(baseUrl);
  const client = new SharesightClient(oauth, baseUrl);

  // Built once and shared, because in HTTP mode a new server is built for every request
  const holdings = new HoldingsLister({
    cache: new MemoryCache(listing.cacheTtlSeconds * 1000, MAX_CACHED_LISTS),
    cursors: new CursorCodec(listing.cursorSecret),
    maxResponseChars: listing.maxResponseChars,
  });

  const createServer = (): McpServer => {
    const server = new McpServer({
      name: "sharesight-mcp",
      version: VERSION,
    });

    registerTools(server, client, { holdings, readOnly, paths: { root: dataRoot, unrestricted: !httpConfig } });

    return server;
  };

  if (readOnly) {
    console.error("Read-only mode: tools that create, change or delete data are not available");
  }

  if (httpConfig) {
    // Listen before the token check, so a slow token endpoint does not hold up health checks
    const httpServer = await runHttp(createServer, httpConfig);

    if (httpServer && !(await prefetchToken(oauth))) {
      await shutdownHttpServer(httpServer);
    }

    return;
  }

  if (!(await prefetchToken(oauth))) {
    return;
  }

  // serveStdio picks the protocol era from the client's opening message, so 2025 and 2026-07-28 clients both connect
  serveStdio(createServer, { onerror: (error) => console.error(`MCP error: ${error.message}`) });
  console.error("Sharesight MCP server running on stdio");
}

/** Checks the credentials with a token request. Returns false, and sets a failing exit code, only if they were rejected. */
async function prefetchToken(oauth: OAuthManager): Promise<boolean> {
  try {
    await oauth.getValidAccessToken();
  } catch (error) {
    const message = errorMessage(error);

    // Wrong credentials will never recover; other failures (network, 5xx) may, so retry on the first tool call
    if (error instanceof TokenRequestError && error.isCredentialError) {
      console.error(`Error: ${message}`);
      process.exitCode = 1;
      return false;
    }

    console.error(`Warning: could not get an access token at startup, will retry on first use: ${message}`);
  }

  return true;
}

/** Starts the HTTP server and registers the shutdown signals. Returns undefined, with a failing exit code, if it could not start. */
async function runHttp(createServer: () => McpServer, { host, port, authToken }: HttpConfig): Promise<Server | undefined> {
  let httpServer: Server;

  try {
    httpServer = await startHttpServer({ factory: createServer, host, port, authToken });
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`);
    process.exitCode = 1;
    return undefined;
  }

  const address = httpServer.address();
  const listeningPort = typeof address === "object" && address ? address.port : port;
  console.error(`Sharesight MCP server running on ${endpointUrl(host, listeningPort)}${authToken ? "" : " (no auth token set)"}`);

  // Exit once the server has closed, rather than waiting for Sharesight calls whose clients have already gone
  const shutdown = () => void shutdownHttpServer(httpServer).then(() => process.exit());
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return httpServer;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function printUsage(): void {
  console.log(`
Sharesight MCP Server

Usage:
  sharesight-mcp <command>

Commands:
  serve [--http]   Run the MCP server over stdio (default) or Streamable HTTP

Environment variables:
  MCP_READ_ONLY    "true" leaves out every tool that creates, changes or deletes data (default "false")
  MCP_DATA_ROOT    Directory attachment_path reads from, relative to it and confined to it; required for attachment_path over HTTP

HTTP environment variables:
  MCP_PORT         Port to listen on (default ${DEFAULT_HTTP_PORT})
  MCP_HOST         Address to bind (default ${DEFAULT_HTTP_HOST})
  MCP_AUTH_TOKEN   Bearer token clients must send; required when MCP_HOST is not a loopback address
  MCP_TRANSPORT    "stdio" (default) or "http", an alternative to the --http flag

Examples:
  sharesight-mcp serve          # Start the MCP server on stdio
  sharesight-mcp serve --http   # Start the MCP server on http://127.0.0.1:${DEFAULT_HTTP_PORT}${MCP_PATH}
  sharesight-mcp                # Same as 'serve'
`);
}

async function main(): Promise<void> {
  const command = process.argv[2] || "serve";

  switch (command) {
    case "serve":
      await runServe();
      break;
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
