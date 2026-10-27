import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const indexPath = fileURLToPath(new URL("./index.js", import.meta.url));
const STARTUP_LIMIT_MS = 15_000;

interface Run {
  exitCode: number | null;
  stderr: string;
}

describe("serve startup", () => {
  let dir: string;
  let rejectedPreload: string;
  let offlinePreload: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "sharesight-mcp-test-"));
    rejectedPreload = join(dir, "rejected.mjs");
    offlinePreload = join(dir, "offline.mjs");
    writeFileSync(rejectedPreload, `globalThis.fetch = async () => new Response('{"error":"invalid_client"}', { status: 401 });\n`);
    writeFileSync(offlinePreload, `globalThis.fetch = async () => { throw new TypeError("fetch failed"); };\n`);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  /** Starts the server with a stubbed fetch and resolves when it exits or prints `until`. */
  function run(preload: string, env: Record<string, string>, until?: string, args: string[] = []): Promise<Run> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, indexPath, "serve", ...args], {
        env: { ...process.env, ...env },
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

  test("--http listens on the configured port", async () => {
    const result = await run(offlinePreload, { ...credentials, PORT: "0" }, "running on http://127.0.0.1:", ["--http"]);

    assert.match(result.stderr, /running on http:\/\/127\.0\.0\.1:\d+\/mcp \(no auth token set\)/);
  });

  test("MCP_TRANSPORT=http selects HTTP without the flag", async () => {
    const result = await run(offlinePreload, { ...credentials, MCP_TRANSPORT: "http", PORT: "0", MCP_AUTH_TOKEN: "t" }, "running on http://");

    assert.match(result.stderr, /running on http:\/\/127\.0\.0\.1:\d+\/mcp\n/);
  });

  test("--http exits with code 1 on a public host without MCP_AUTH_TOKEN", async () => {
    const result = await run(offlinePreload, { ...credentials, HOST: "0.0.0.0", PORT: "0", MCP_AUTH_TOKEN: "" }, undefined, ["--http"]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /MCP_AUTH_TOKEN is required/);
  });

  test("--http exits with code 1 on an invalid PORT", async () => {
    const result = await run(offlinePreload, { ...credentials, PORT: "abc" }, undefined, ["--http"]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /PORT must be an integer/);
  });

  test("exits with code 1 when credentials are missing", async () => {
    const result = await run(offlinePreload, { SHARESIGHT_CLIENT_ID: "", SHARESIGHT_CLIENT_SECRET: "" });

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Missing credentials/);
  });
});
