import { rmSync } from "node:fs";

rmSync(new URL("../.test-build", import.meta.url), { recursive: true, force: true });
