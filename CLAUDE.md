# CLAUDE.md - Project Instructions for Claude

This file provides guidance for Claude when working with the Sharesight MCP Server codebase.

## Project Overview

This is an MCP (Model Context Protocol) server that wraps the Sharesight v3 API, allowing AI assistants to interact with Sharesight portfolio data through natural language.

**Tech Stack:**
- TypeScript
- Node.js 24+
- MCP SDK (`@modelcontextprotocol/sdk`)

## Project Structure

```
sharesight-mcp/
├── src/
│   ├── index.ts              # CLI entry point with the serve command
│   ├── http.ts               # Streamable HTTP server (bearer auth, /healthz) for serve --http
│   ├── oauth.ts              # OAuth 2.0 client credentials token management
│   ├── sharesight-client.ts  # HTTP client for Sharesight API
│   ├── types.ts              # TypeScript interfaces for API types
│   ├── *.test.ts             # node:test suites (oauth, client, startup)
│   └── test-helpers.ts       # stubFetch and response builders shared by the tests
├── .github/workflows/ci.yml  # Build and test on PRs and main; reusable via workflow_call
├── scripts/                  # Build helpers (clean-test-build.mjs, used by npm test)
├── tsconfig.build.json       # Used by npm run build; leaves the tests out of dist/
├── tsconfig.test.json        # Builds everything, tests included, into .test-build/ (gitignored)
├── dist/                     # Compiled output (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

## Key Files

### `src/index.ts`
The main CLI entry point with one command:
- `sharesight-mcp serve` - Run the MCP server over stdio (default)
- `sharesight-mcp serve --http` - Run it over Streamable HTTP (also `MCP_TRANSPORT=http`)
Contains tool definitions using Zod schemas for validation. A new server instance is built per HTTP request, so `registerTools` must stay cheap and keep no state outside the shared `SharesightClient`.

### `src/http.ts`
Wraps the SDK's `createMcpHandler` (from `@modelcontextprotocol/server`) with `toNodeHandler` (from `@modelcontextprotocol/node`) on `node:http`. Stateless, serves 2026-07-28 and 2025-era clients. Requires `MCP_AUTH_TOKEN` unless bound to loopback. Configured with `PORT`, `HOST` and `MCP_AUTH_TOKEN`.

### `src/oauth.ts`
OAuth 2.0 manager class using the client credentials grant. Holds the access token in memory and requests a new one when it expires.

### `src/sharesight-client.ts`
HTTP client class with methods for each API endpoint. All methods:
- Are async and return typed responses
- Use the private `request()` method for HTTP calls
- Handle query parameters and request bodies

### `src/types.ts`
TypeScript interfaces matching Sharesight API v3 response structures. Organized into:
- Common types (ApiTransaction, Currency, Pagination)
- Domain types (Portfolio, Holding, CustomInvestment, etc.)
- Response types (PortfoliosResponse, HoldingsResponse, etc.)
- Request types (CreateCustomInvestmentRequest, etc.)

## Build Commands

```bash
npm install     # Install dependencies
npm run build   # Compile TypeScript to dist/
npm run dev     # Watch mode for development
npm start       # Run the compiled server
npm test        # Build the tests into .test-build/ and run the node:test suites
```

## Adding a New Tool

1. **Add API method** to `src/sharesight-client.ts`:
   ```typescript
   async newMethod(param: string): Promise<SomeResponse> {
     return this.request<SomeResponse>("GET", `/endpoint/${param}`);
   }
   ```

2. **Add types** to `src/types.ts` if needed

3. **Add tool** to `registerTools()` in `src/index.ts`:
   ```typescript
   server.registerTool(
     "new_tool",
     {
       description: "Description of what it does",
       inputSchema: z.object({
         param: z.string().describe("..."),
       }),
     },
     async (args) => {
       try {
         const result = await client.newMethod(args.param);

         return formatResult(result);
       } catch (error) {
         return formatError(error);
       }
     }
   );
   ```

## API Conventions

### Sharesight API v3
- Base URL: `https://api.sharesight.com/api/v3`
- Auth: Bearer token in Authorization header
- Dates: `YYYY-MM-DD` format
- Pagination: cursor-based with `page` and `per_page`

### Error Handling
The client throws errors for non-2xx responses. The MCP handler catches these and returns `isError: true` responses.

`request()` retries once with a new token on a 401 from a cached token, and aborts after 30 seconds (180 for the performance report endpoints). A timeout on a write says the change may still have been applied.

## Authentication

Set `SHARESIGHT_CLIENT_ID` and `SHARESIGHT_CLIENT_SECRET`. The server uses the OAuth client credentials grant and acts as the single account linked to the API application. Tokens are kept in memory only.

## Testing

`npm test` builds `src/*.test.ts` into `.test-build/` and runs them with `node:test` and a stubbed `fetch`, so it needs no credentials or external network (some tests use a local loopback server). It covers token caching, the 401 retry, timeouts, the startup checks and the HTTP transport (auth, health check, protocol round trips). The tool handlers in `src/index.ts` are not covered. Test those manually:

1. Set `SHARESIGHT_CLIENT_ID` and `SHARESIGHT_CLIENT_SECRET` env vars
2. Run `node dist/index.js serve`
3. Use MCP inspector or Claude Desktop to test tools

## Common Tasks

### Update an existing tool
1. Find the tool in `registerTools()` in `src/index.ts`
2. Modify the `inputSchema` as needed
3. Update the handler if parameters changed
4. Update client method in `src/sharesight-client.ts` if needed

### Fix type errors
1. Check `src/types.ts` matches actual API responses
2. The API sometimes returns different field names (camelCase vs snake_case)
3. Mark optional fields with `?`

### Debug API issues
1. Check the access token is valid (not expired)
2. Look at the error message from Sharesight
3. Compare request against API documentation

## Notes

- The server uses stdio transport (stdin/stdout) unless started with `--http`
- Authentication: OAuth client credentials, tokens held in memory
- All tool responses are JSON stringified with 2-space indentation
