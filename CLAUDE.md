# CLAUDE.md - Project Instructions for Claude

This file provides guidance for Claude when working with the Sharesight MCP Server codebase.

## Project Overview

This is an MCP (Model Context Protocol) server that wraps the Sharesight v3 API, allowing AI assistants to interact with Sharesight portfolio data through natural language.

**Tech Stack:**
- TypeScript
- Node.js 24+
- MCP SDK v2 (`@modelcontextprotocol/server`, plus `@modelcontextprotocol/node` for HTTP)

## Project Structure

```
sharesight-mcp/
├── src/
│   ├── index.ts              # CLI entry point with the serve command
│   ├── tools/                # Tool registration, one file per feature area
│   │   ├── index.ts          # registerTools(): all read tools, then the write tools unless read-only
│   │   ├── common.ts         # formatResult, formatError and the annotation constants
│   │   ├── attachments.ts    # Attachment inputs and withAttachment(): base64 or file path to Sharesight's attachment fields
│   │   ├── portfolios.ts, holdings.ts, trades.ts, payouts.ts, custom-investments.ts, custom-investment-prices.ts,
│   │   │   coupon-rates.ts, adjustments.ts, labels.ts, performance.ts, reports.ts (v2 reports), confirmations.ts (v2 unconfirmed
│   │   │   payouts and trades), account.ts   # one area each, read tools and write tools
│   ├── http.ts               # Streamable HTTP server (bearer auth, /healthz) for serve --http
│   ├── error-message.ts      # errorMessage(): message of a thrown value
│   ├── version.ts            # VERSION, read from package.json at runtime
│   ├── paged-list.ts         # PagedLister<T>: generic fetch-once, filter, cache and size-budgeted paging with signed cursors; pageItems()
│   ├── holdings-page.ts      # Holding filters and ordering, and pageHoldings()
│   ├── holdings-list.ts      # HoldingsLister: PagedLister for list_holdings / list_portfolio_holdings
│   ├── unconfirmed-list.ts   # createUnconfirmedLister(): PagedLister for the v2 unconfirmed payout and trade lists
│   ├── cursor.ts             # CursorCodec: signed, stateless paging cursors
│   ├── cache.ts              # Cache interface and MemoryCache (TTL, entry cap)
│   ├── oauth.ts              # OAuth 2.0 client credentials token management
│   ├── sharesight-client.ts  # HTTP client for Sharesight API
│   └── types.ts              # TypeScript interfaces for API types
├── tests/                    # Mirrors src/. Compiled with src/ into .test-build/ by npm test
│   ├── *.test.ts             # node:test suites (oauth, client, startup, http, holdings-page, cursor, cache, tools, tool-groups, version)
│   ├── stdio-session.ts      # withServer(): spawns the built server over stdio against a fresh mock Sharesight
│   ├── test-helpers.ts       # stubFetch and response builders shared by the tests
│   ├── server-env.ts         # inheritedEnv(): the parent environment minus the server's own settings, for tests that spawn it
│   ├── mock-sharesight.ts    # Mock Sharesight API server for the tool tests
│   └── scripts/              # Tests for scripts/ (resolve-version.test.mjs), run as plain JavaScript
├── .github/workflows/ci.yml  # Build and test on PRs; reusable via workflow_call
├── .github/workflows/docker.yml  # Tests, then builds and publishes the image on main and v* tags
├── Dockerfile                # Multi-stage image, runs HTTP mode as a non-root user
├── scripts/                  # Build helpers (prepare-test-build.mjs, resolve-version.mjs)
├── tsconfig.json             # Shared options; includes src/ and tests/ for editors
├── tsconfig.build.json       # Used by npm run build; src/ only, into dist/
├── tsconfig.test.json        # Builds src/ and tests/ into .test-build/ (gitignored)
├── dist/                     # Compiled output (gitignored)
├── package.json
└── README.md
```

## Key Files

### `src/index.ts`
The main CLI entry point with one command:
- `sharesight-mcp serve` - Run the MCP server over stdio (default)
- `sharesight-mcp serve --http` - Run it over Streamable HTTP (also `MCP_TRANSPORT=http`)
Reads the serve settings (`MCP_READ_ONLY` among them) and builds the shared `SharesightClient`, `HoldingsLister` and unconfirmed lister. A new server instance is built per HTTP request, so `registerTools` must stay cheap and keep no state outside those, which `runServe` builds once. To page another list that Sharesight returns whole, give `PagedLister` a `matches` predicate (run on the fetched list before anything is cached) and an optional `compare`, as `unconfirmed-list.ts` does; keep the query that decides what to fetch in the `scope` string.

### `src/tools/`
Tool definitions using Zod schemas, one file per feature area. Each file exports a `register<Area>ReadTools` function and, if the area has any, a `register<Area>WriteTools` function. `tools/index.ts` calls every read function, then returns early when `readOnly` is set, so read-only mode never registers a write tool. Every tool has `annotations` from `common.ts`: `READ_ONLY`, `CREATE`, `UPDATE` or `DELETE`. Trade and payout create/update tools take a `PathPolicy` because `attachment_path` reads a file on the server's machine: with `MCP_DATA_ROOT` set, paths are relative to it and confined to it (symlinks resolved first), over both transports; without it, only stdio may read any path (`unrestricted`) and HTTP refuses. v3 has no attachment download endpoint. v2 documents `GET /documents/:id.json` (the id is the v3 attachment id), but in live tests (October 2026) it returned a Cloudflare 502 for every existing document and a normal 404 for a missing one, with the same token that reads v2 trades, so no download tool is exposed. The v1 Connect API has no document endpoint. `tests/tool-groups.test.ts` holds the table of expected tool names and checks the annotations against the name prefix.

### `src/http.ts`
Wraps the SDK's `createMcpHandler` (from `@modelcontextprotocol/server`) with `toNodeHandler` (from `@modelcontextprotocol/node`) on `node:http`. Stateless, serves 2026-07-28 and 2025-era clients. Requires `MCP_AUTH_TOKEN` unless bound to loopback. Configured with `MCP_PORT`, `MCP_HOST` and `MCP_AUTH_TOKEN`; the generic `PORT` and `HOST` are deliberately not read. Stdio uses `serveStdio` so it also serves both protocol eras, and `serve` rejects unknown options before it contacts the token endpoint.

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
npm test        # Build src/ and tests/ into .test-build/ and run the node:test suites
```

## Adding a New Tool

1. **Add API method** to `src/sharesight-client.ts`:
   ```typescript
   async newMethod(param: string): Promise<SomeResponse> {
     return this.request<SomeResponse>("GET", `/endpoint/${param}`);
   }
   ```

2. **Add types** to `src/types.ts` if needed

3. **Add tool** to the `register<Area>ReadTools` or `register<Area>WriteTools` function in `src/tools/<area>.ts`. A new area gets its own file, with its functions called from `src/tools/index.ts` (read tools before the `readOnly` return, write tools after it). Pick the annotation from `common.ts`, and add the name to the table in `tests/tool-groups.test.ts`:
   ```typescript
   server.registerTool(
     "new_tool",
     {
       description: "Description of what it does",
       annotations: READ_ONLY,
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

## Versioning

The git tag is the only place a release version is written. `package.json` holds the placeholder `0.0.0-dev`, and `src/version.ts` reads it at runtime for the server version. `scripts/resolve-version.mjs` turns the git ref into a version (a `v<semver>` tag gives the semver, a branch gives `0.0.0-<branch>.<short sha>`, any other tag is an error), and the Dockerfile `VERSION` build arg stamps it into `package.json` with `npm version`. Never hardcode a version in the source.

## Docker

`.github/workflows/docker.yml` runs on pushes to `main` and on `v*` tags. It calls `ci.yml` first, then builds `linux/amd64` and `linux/arm64` and pushes to `ghcr.io/<repo>`. `ci.yml` has no push trigger of its own, because this workflow calls it. The image runs HTTP mode as the `node` user and refuses to start without `MCP_AUTH_TOKEN`. To check the Dockerfile locally, run `docker build --build-arg VERSION=1.2.3 -t sharesight-mcp:local .`.

## API Conventions

### Sharesight API v3
- Base URL: `https://api.sharesight.com/api/v3`
- Auth: Bearer token in Authorization header
- Dates: `YYYY-MM-DD` format
- Pagination: cursor-based with `page` and `per_page`

### Sharesight API v2
A few tools use v2, because v3 lacks them: the capital gains, unrealised CGT, diversity and valuation reports, `my_user`, `user_instruments`, and the unconfirmed payout and trade lists with payout confirm and reject. The same OAuth token works. A client method reaches v2 by passing an endpoint that starts with `/api/v2/`. The v2 docs are at `https://portfolio.sharesight.com/api/2/doc/api_data.json`. Do not add a trade confirm or reject tool on `POST /api/v2/trades.json`: live tests showed it creates a new confirmed trade instead, even with `state: "rejected"`.

### Error Handling
The client throws errors for non-2xx responses. The MCP handler catches these and returns `isError: true` responses.

`request()` retries once with a new token on a 401 from a cached token, and aborts after 30 seconds (180 for the performance report endpoints). A timeout on a write says the change may still have been applied.

## Authentication

Set `SHARESIGHT_CLIENT_ID` and `SHARESIGHT_CLIENT_SECRET`. The server uses the OAuth client credentials grant and acts as the single account linked to the API application. Tokens are kept in memory only.

## Testing

`npm test` compiles `src/` and `tests/` together into `.test-build/` (`scripts/prepare-test-build.mjs` clears it first and copies `package.json` in, because `src/version.ts` reads it) and runs the suites with `node:test` and a stubbed `fetch`, so it needs no credentials or external network (some tests use a local loopback server). It covers token caching, the 401 retry, timeouts, the startup checks and the HTTP transport (auth, health check, protocol round trips). `tests/tools.test.ts` runs the server over stdio against `tests/mock-sharesight.ts`, a local HTTP stand-in for Sharesight reached through `SHARESIGHT_BASE_URL`, and covers the holdings list tools. Extend the mock when a test needs another endpoint by adding a route to the table in `routes()`; `lastBody`, `lastRequest` and `lastCall` read what it recorded, and `tests/pages.ts` has `walkPages()` for following `next_cursor`. New tests go in `tests/`, named after the `src/` file they cover, and import from `../src/`. A test that spawns the server must build its environment from `inheritedEnv()`, so settings exported in a developer's shell cannot change the result. `tests/tool-groups.test.ts` covers the tool set, the annotations and read-only mode. The other tool handlers in `src/tools/` are not covered. Test those manually:

1. Set `SHARESIGHT_CLIENT_ID` and `SHARESIGHT_CLIENT_SECRET` env vars
2. Run `node dist/index.js serve`
3. Use MCP inspector or Claude Desktop to test tools

## Common Tasks

### Update an existing tool
1. Find the tool in `src/tools/`
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
