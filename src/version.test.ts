import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "./version.js";

describe("VERSION", () => {
  test("is the version in package.json", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    assert.equal(VERSION, packageJson.version);
  });

  test("is a semantic version", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/);
  });
});
