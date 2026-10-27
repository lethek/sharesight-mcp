/**
 * Works out the version to stamp into an image build from the git ref that triggered it.
 *
 * - A `v<semver>` tag gives that version without the `v`, for example v1.2.3 gives 1.2.3.
 * - A branch gives 0.0.0-<branch>.<short sha>.
 * - Any other tag is an error, so a stray `v*` tag such as `vNext` cannot publish an image.
 *
 * With GITHUB_REF_TYPE, GITHUB_REF_NAME and GITHUB_SHA set it prints `version=<version>`, which is the format of $GITHUB_OUTPUT.
 */

import { pathToFileURL } from "node:url";

const TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function resolveVersion({ refType, refName, sha }) {
  if (refType === "tag") {
    const match = TAG_PATTERN.exec(refName);

    if (!match) {
      throw new Error(`Tag "${refName}" is not a version tag. Expected v<major>.<minor>.<patch> with an optional -prerelease suffix.`);
    }

    return match[1];
  }

  if (refType === "branch") {
    // Branch names can contain characters that are not valid in a semver identifier
    const branch = refName.replace(/[^0-9A-Za-z-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";

    return `0.0.0-${branch}.${sha.slice(0, 7)}`;
  }

  throw new Error(`Cannot work out a version for ref type "${refType}".`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: refName, GITHUB_SHA: sha } = process.env;

    console.log(`version=${resolveVersion({ refType, refName, sha: sha ?? "" })}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
