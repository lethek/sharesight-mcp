import { readFileSync } from "node:fs";

/**
 * The server version, read from package.json at runtime.
 *
 * The repository holds a placeholder (0.0.0-dev). The image build replaces it with the version taken from the git tag,
 * so the tag is the only place a release version is written.
 */
export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
