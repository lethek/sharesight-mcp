import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERSION } from "../src/version.js";
import { inheritedEnv } from "./server-env.js";

const indexPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
const STARTUP_LIMIT_MS = 15_000;

interface Run {
  exitCode: number | null;
  stderr: string;
}

describe("serve startup", () => {
  let dir: string;
  let rejectedPreload: string;
  let offlinePreload: string;
  let hangingPreload: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "sharesight-mcp-test-"));
    rejectedPreload = join(dir, "rejected.mjs");
    offlinePreload = join(dir, "offline.mjs");
    hangingPreload = join(dir, "hanging.mjs");
    writeFileSync(rejectedPreload, `globalThis.fetch = async () => new Response('{"error":"invalid_client"}', { status: 401 });\n`);
    writeFileSync(offlinePreload, `globalThis.fetch = async () => { throw new TypeError("fetch failed"); };\n`);
    writeFileSync(hangingPreload, `globalThis.fetch = () => new Promise(() => {});\n`);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  /** Starts the server with a stubbed fetch and resolves when it exits or prints `until`. */
  function run(preload: string, env: Record<string, string>, until?: string, args: string[] = []): Promise<Run> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, indexPath, "serve", ...args], {
        env: { ...inheritedEnv(), ...env },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`server did not finish within ${STARTUP_LIMIT_MS}ms. stderr: ${stderr}`));
      }, STARTUP_LIMIT_MS);

      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (until && stderr.includes(until)) {
          child.kill(); // the timer stays armed until the child's 'close' event
        }
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stderr });
      });
    });
  }

  const credentials = { SHARESIGHT_CLIENT_ID: "id", SHARESIGHT_CLIENT_SECRET: "secret" };

  test("exits with code 1 when the credentials are rejected", async () => {
    const result = await run(rejectedPreload, credentials);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Token request failed \(401\)/);
    assert.match(result.stderr, /linked to the API application/);
  });

  test("starts anyway when the token endpoint is unreachable", async () => {
    const result = await run(offlinePreload, credentials, "running on stdio");

    assert.match(result.stderr, /Warning: could not get an access token at startup/);
    assert.match(result.stderr, /running on stdio/);
  });

  test("reports the package.json version to clients", async () => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(offlinePreload).href, indexPath, "serve"], {
      env: { ...inheritedEnv(), ...credentials },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const timer = setTimeout(() => child.kill(), STARTUP_LIMIT_MS);

    try {
      const reply = new Promise<string>((resolve, reject) => {
        let out = "";
        child.stdout.on("data", (chunk) => {
          out += chunk;
          if (out.includes("\n")) resolve(out);
        });
        child.on("close", () => reject(new Error(`server closed before replying. stdout: ${out}`)));
      });
      const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } };
      child.stdin.write(`${JSON.stringify(initialize)}\n`);

      assert.equal(JSON.parse(await reply).result.serverInfo.version, VERSION);
    } finally {
      clearTimeout(timer);
      child.kill();
    }
  });

  test("MCP_READ_ONLY=true says so at startup", async () => {
    const result = await run(offlinePreload, { ...credentials, MCP_READ_ONLY: "true" }, "running on stdio");

    assert.match(result.stderr, /Read-only mode: tools that create, change or delete data are not available/);
  });

  test("--http listens on the configured port", async () => {
    const result = await run(offlinePreload, { ...credentials, MCP_PORT: "0" }, "running on http://127.0.0.1:", ["--http"]);

    assert.match(result.stderr, /running on http:\/\/127\.0\.0\.1:\d+\/mcp \(no auth token set\)/);
  });

  test("MCP_TRANSPORT=http selects HTTP without the flag", async () => {
    const result = await run(offlinePreload, { ...credentials, MCP_TRANSPORT: "http", MCP_PORT: "0", MCP_AUTH_TOKEN: "t" }, "running on http://");

    assert.match(result.stderr, /running on http:\/\/127\.0\.0\.1:\d+\/mcp\n/);
  });

  test("--http listens before the startup token request has finished", async () => {
    // The token request never settles, so the server only gets this far if it listens first
    const result = await run(hangingPreload, { ...credentials, MCP_PORT: "0" }, "running on http://", ["--http"]);

    assert.match(result.stderr, /running on http:\/\/127\.0\.0\.1:\d+\/mcp/);
  });

  test("--http stops and exits with code 1 when the credentials are rejected", async () => {
    const result = await run(rejectedPreload, { ...credentials, MCP_PORT: "0" }, undefined, ["--http"]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /running on http:\/\/127\.0\.0\.1:\d+\/mcp[\s\S]*Token request failed \(401\)/);
  });

  test("generic HOST and PORT variables do not change the bind address", async () => {
    const result = await run(offlinePreload, { ...credentials, HOST: "0.0.0.0", PORT: "1", MCP_PORT: "0" }, "running on http://", ["--http"]);

    assert.match(result.stderr, /running on http:\/\/127\.0\.0\.1:\d+\/mcp/);
  });

  describe("rejects bad serve options before contacting the token endpoint", () => {
    const cases: Array<[string, Record<string, string>, string[], RegExp]> = [
      ["a public host without MCP_AUTH_TOKEN", { MCP_HOST: "0.0.0.0", MCP_PORT: "0" }, ["--http"], /MCP_AUTH_TOKEN is required/],
      ["a non-numeric MCP_PORT", { MCP_PORT: "abc" }, ["--http"], /MCP_PORT must be an integer/],
      ["an out of range MCP_PORT", { MCP_PORT: "70000" }, ["--http"], /MCP_PORT must be an integer/],
      ["a mistyped flag", {}, ["--htpp"], /Unknown option for serve: --htpp/],
      ["an unknown MCP_TRANSPORT", { MCP_TRANSPORT: "streamable-http" }, [], /MCP_TRANSPORT must be "stdio" or "http"/],
      ["a non-numeric MCP_MAX_RESPONSE_CHARS", { MCP_MAX_RESPONSE_CHARS: "big" }, [], /MCP_MAX_RESPONSE_CHARS must be a whole number of at least 5000/],
      ["a too small MCP_MAX_RESPONSE_CHARS", { MCP_MAX_RESPONSE_CHARS: "100" }, [], /MCP_MAX_RESPONSE_CHARS must be a whole number of at least 5000/],
      ["a negative MCP_CACHE_TTL_SECONDS", { MCP_CACHE_TTL_SECONDS: "-1" }, [], /MCP_CACHE_TTL_SECONDS must be a whole number of at least 0/],
      ["a SHARESIGHT_BASE_URL that is not a URL", { SHARESIGHT_BASE_URL: "not a url" }, [], /SHARESIGHT_BASE_URL must be an https URL/],
      ["a SHARESIGHT_BASE_URL that is not http", { SHARESIGHT_BASE_URL: "ftp://example.com" }, [], /SHARESIGHT_BASE_URL must be an https URL/],
      ["a SHARESIGHT_BASE_URL with a query", { SHARESIGHT_BASE_URL: "https://proxy.example/sharesight?team=a" }, [], /SHARESIGHT_BASE_URL must be an https URL/],
      ["a SHARESIGHT_BASE_URL with a fragment", { SHARESIGHT_BASE_URL: "https://proxy.example/sharesight#top" }, [], /SHARESIGHT_BASE_URL must be an https URL/],
      ["a plain http SHARESIGHT_BASE_URL for another host", { SHARESIGHT_BASE_URL: "http://api.sharesight.com" }, [], /SHARESIGHT_BASE_URL must be an https URL/],
      ["an MCP_READ_ONLY that is not true or false", { MCP_READ_ONLY: "yes" }, [], /MCP_READ_ONLY must be "true" or "false"/],
      ["an MCP_DATA_ROOT that is not a directory", { MCP_DATA_ROOT: "/no/such/directory/anywhere" }, [], /MCP_DATA_ROOT must be an existing directory/],
      ["a zero MCP_MAX_ATTACHMENT_BYTES", { MCP_MAX_ATTACHMENT_BYTES: "0" }, [], /MCP_MAX_ATTACHMENT_BYTES must be a whole number of at least 1/],
      ["--http together with MCP_TRANSPORT=stdio", { MCP_TRANSPORT: "stdio" }, ["--http"], /--http conflicts with MCP_TRANSPORT=stdio/],
    ];

    for (const [name, env, args, message] of cases) {
      test(name, async () => {
        // The rejected-credentials preload would also fail the run, so the message proves the options were checked first
        const result = await run(rejectedPreload, { ...credentials, ...env }, undefined, args);

        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, message);
        assert.doesNotMatch(result.stderr, /Token request failed/);
      });
    }
  });

  test("exits with code 1 when credentials are missing", async () => {
    const result = await run(offlinePreload, { SHARESIGHT_CLIENT_ID: "", SHARESIGHT_CLIENT_SECRET: "" });

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Missing credentials/);
  });
});
