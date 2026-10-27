import { copyFileSync, mkdirSync, rmSync } from "node:fs";

const testBuild = new URL("../.test-build/", import.meta.url);

rmSync(testBuild, { recursive: true, force: true });
mkdirSync(testBuild, { recursive: true });

// src/version.ts reads ../package.json, which in the test build is .test-build/package.json
copyFileSync(new URL("../package.json", import.meta.url), new URL("package.json", testBuild));
