/** Not an MCP_ setting, but one the server reads. Credentials are not listed because the tests always set them. */
const OTHER_SERVER_SETTINGS = ["SHARESIGHT_BASE_URL"];

/**
 * The parent environment without the server's own settings (every MCP_ variable and the others listed above), so a developer's
 * exported values can't change a test's result. New MCP_ settings are covered without being added here.
 */
export function inheritedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  for (const name of Object.keys(env)) {
    if (name.startsWith("MCP_") || OTHER_SERVER_SETTINGS.includes(name)) {
      delete env[name];
    }
  }

  return env;
}
