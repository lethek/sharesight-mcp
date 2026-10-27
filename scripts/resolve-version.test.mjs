import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveVersion } from "./resolve-version.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const script = fileURLToPath(new URL("./resolve-version.mjs", import.meta.url));

describe("resolveVersion", () => {
  test("a version tag gives its version without the v", () => {
    assert.equal(resolveVersion({ refType: "tag", refName: "v1.2.3", sha: SHA }), "1.2.3");
  });

  test("a prerelease tag keeps its suffix", () => {
    assert.equal(resolveVersion({ refType: "tag", refName: "v1.2.3-rc.1", sha: SHA }), "1.2.3-rc.1");
  });

  test("tags that are not versions are rejected", () => {
    for (const refName of ["vNext", "v1", "v1.2", "v1.2.3.4", "1.2.3", "v1.2.3+build", "v01.2.3x", "v1.2.3-"]) {
      assert.throws(() => resolveVersion({ refType: "tag", refName, sha: SHA }), /not a version tag/, refName);
    }
  });

  test("a branch gives 0.0.0-<branch>.<short sha>", () => {
    assert.equal(resolveVersion({ refType: "branch", refName: "main", sha: SHA }), "0.0.0-main.0123456");
  });

  test("characters that are not valid in a semver identifier are replaced in a branch name", () => {
    assert.equal(resolveVersion({ refType: "branch", refName: "feature/new_thing", sha: SHA }), "0.0.0-feature-new-thing.0123456");
  });

  test("an unknown ref type is rejected", () => {
    assert.throws(() => resolveVersion({ refType: "pull_request", refName: "1/merge", sha: SHA }), /ref type/);
  });
});

describe("resolve-version command", () => {
  const run = (env) => spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });

  test("prints the version in $GITHUB_OUTPUT format", () => {
    const result = run({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v2.0.1", GITHUB_SHA: SHA });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "version=2.0.1\n");
  });

  test("exits with code 1 for a bad tag", () => {
    const result = run({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "vNext", GITHUB_SHA: SHA });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a version tag/);
  });
});
