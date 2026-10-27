# Sharesight MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with access to the [Sharesight](https://www.sharesight.com/) portfolio tracking platform via the v3 API.

## Quick Start

### Step 1: Get OAuth Credentials

You'll need a **Client ID** and **Client Secret** from Sharesight to use this server. The server uses the OAuth client credentials grant, so it acts as the single Sharesight account that is linked to your API application.

**How to get credentials:**
- Contact Sharesight support at support@sharesight.com to request API access
- Visit the [Sharesight API documentation](https://api.sharesight.com/doc/api/v3) for more information
- API access may require a specific Sharesight plan

### Step 2: Add MCP Server Configuration

This requires Node.js 24 or later.

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sharesight": {
      "command": "npx",
      "args": ["-y", "github:lethek/sharesight-mcp", "serve"],
      "env": {
        "SHARESIGHT_CLIENT_ID": "your_client_id",
        "SHARESIGHT_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Restart Claude Desktop and you're ready to go!

### Pinning a release

Without a version, `github:lethek/sharesight-mcp` installs the latest commit on `main`, which can include unreleased changes. npx can also keep reusing a copy it cached earlier, so when an update arrives is not predictable. To stay on a release, add its tag to the package spec:

```json
"args": ["-y", "github:lethek/sharesight-mcp#v1.2.3", "serve"],
```

Releases are the `v*` tags on this repository (see [Releasing](#releasing)). To move to a newer release, change the tag. A pinned install reports its version as `0.0.0-dev`, because only the Docker images are stamped with the release version.

## Overview

This MCP server enables Claude and other AI assistants to interact with Sharesight accounts, allowing natural language queries and operations on investment portfolios, holdings, custom investments, and performance reports.

### What is Sharesight?

Sharesight is a portfolio tracking platform that helps investors track their stocks, ETFs, mutual funds, and other investments across multiple markets. It provides performance reporting, dividend tracking, and tax reporting features.

### What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that enables AI assistants to securely connect to external data sources and tools.

## Features

This server exposes **45 tools** covering most Sharesight v3 API endpoints, grouped by feature area. Not covered: labels, file imports, connections, the watchlist, adjustments, bulk prices, and the lookups other than countries. Each area lists its read tools first, then its write tools.

Every tool carries MCP annotations, so clients can tell reads from writes and ask for confirmation before the destructive ones. Read tools are marked read-only. Create tools are marked non-destructive and not idempotent, update tools non-destructive and idempotent, and delete tools destructive and idempotent. The exception is `update_trade` and `update_payout`, which can discard an attachment and are marked destructive. To keep an assistant from changing anything, see [Read-only mode](#read-only-mode).

### Portfolios
| Tool | Kind | Description |
|------|------|-------------|
| `list_portfolios` | Read | List all user portfolios with optional consolidated view |
| `get_portfolio` | Read | Get detailed portfolio information by ID |
| `get_portfolio_user_setting` | Read | Get user display preferences for a portfolio |
| `update_portfolio_user_setting` | Write | Update chart type, grouping, and other display settings |

### Holdings
| Tool | Kind | Description |
|------|------|-------------|
| `list_holdings` | Read | List holdings across all portfolios, with [filtering and paging](#filtering-and-paging-holdings) |
| `list_portfolio_holdings` | Read | List the holdings within a specific portfolio, with [filtering and paging](#filtering-and-paging-holdings) |
| `get_holding` | Read | Get holding details with optional cost base and historical values |
| `update_holding` | Write | Update holding settings (DRP configuration) |
| `delete_holding` | Write | Remove a holding from a portfolio |

### Trades
| Tool | Kind | Description |
|------|------|-------------|
| `list_trades` | Read | List the trades in a portfolio, by date range or unique identifier |
| `list_holding_trades` | Read | List the trades of a holding |
| `get_trade` | Read | Get a trade by ID |
| `create_trade` | Write | Create a trade, optionally with an [attachment](#attachments) |
| `update_trade` | Write | Update a trade, or replace or remove its attachment |
| `delete_trade` | Write | Remove a trade |

### Payouts
| Tool | Kind | Description |
|------|------|-------------|
| `list_payouts` | Read | List the payouts (dividends and interest) of a holding |
| `get_payout` | Read | Get a payout by ID |
| `create_payout` | Write | Create a payout, optionally with an [attachment](#attachments) |
| `update_payout` | Write | Update a payout, or replace or remove its attachment |
| `delete_payout` | Write | Remove a payout |

### Custom investments
| Tool | Kind | Description |
|------|------|-------------|
| `list_custom_investments` | Read | List custom/unlisted investments |
| `get_custom_investment` | Read | Get custom investment details |
| `create_custom_investment` | Write | Create a new custom investment (property, bonds, etc.) |
| `update_custom_investment` | Write | Update custom investment properties |
| `delete_custom_investment` | Write | Remove a custom investment |

### Custom investment prices
| Tool | Kind | Description |
|------|------|-------------|
| `list_custom_investment_prices` | Read | Get price history for a custom investment |
| `create_custom_investment_price` | Write | Add a new price entry |
| `update_custom_investment_price` | Write | Modify an existing price entry |
| `delete_custom_investment_price` | Write | Remove a price entry |

### Coupon rates (fixed interest)
| Tool | Kind | Description |
|------|------|-------------|
| `list_coupon_rates` | Read | List interest rates for fixed interest investments |
| `create_coupon_rate` | Write | Add a new coupon rate |
| `update_coupon_rate` | Write | Modify a coupon rate |
| `delete_coupon_rate` | Write | Remove a coupon rate |

### Performance and portfolio reports
| Tool | Kind | Description |
|------|------|-------------|
| `get_performance_report` | Read | Detailed performance breakdown with gains analysis |
| `get_performance_index_chart` | Read | Chart data for visualizing portfolio performance |
| `list_portfolio_reports` | Read | List the tax or tools reports saved for a portfolio |
| `get_portfolio_overview` | Read | Value and gains of each holding, optionally grouped |
| `get_portfolio_totals` | Read | Portfolio totals |
| `get_portfolio_benchmark` | Read | Compare a portfolio with a benchmark instrument |
| `get_portfolio_value` | Read | Current portfolio value, optionally in another currency |
| `get_portfolio_value_data` | Read | Portfolio value over time with the price difference |

### Account and reference
| Tool | Kind | Description |
|------|------|-------------|
| `show_coupon_code` | Read | View applied promotional coupon code |
| `list_countries` | Read | Get Sharesight-supported countries and their settings |
| `apply_coupon_code` | Write | Apply a promotional coupon code |
| `delete_coupon_code` | Write | Remove applied coupon code |

### Attachments

Sharesight lets a trade or payout carry one attached file, such as a contract note or a statement. `create_trade`, `update_trade`, `create_payout` and `update_payout` take it in one of two ways:

| Input | Effect |
|-------|--------|
| `attachment_base64` | The file, base64 encoded. Needs `attachment_filename`. |
| `attachment_path` | A path on the machine running the server. The server reads and encodes the file, and the name defaults to the file's own. See below for where it may read. |
| `attachment_filename` | The file name with its extension |
| `remove_attachment` | Update tools only: `true` removes the existing attachment |

`attachment_path` reads files according to `MCP_DATA_ROOT`:

- **Set:** paths are relative to that directory, and a file must be inside it. Symbolic links are followed before the check, so a link cannot lead out. This applies over stdio and HTTP. Use it with HTTP when the server can see a shared or mounted directory.
- **Not set, stdio:** any file the server process can read.
- **Not set, HTTP:** `attachment_path` is refused. Send `attachment_base64`.

An attachment may be at most `MCP_MAX_ATTACHMENT_BYTES` (10 MiB by default), measured on the file itself and checked before a file is read. Sharesight documents no limit of its own. A path must also be a regular file. The directory must exist when the server starts. Anyone who can call the server can attach any file inside the root to a trade or payout, so keep the root to files you are happy to upload.

A new attachment replaces the existing one, and this server cannot read back a replaced or removed attachment. For that reason `update_trade` and `update_payout` are annotated as destructive. This server cannot download attachments. The v3 API has no download endpoint, and the older v2 API has `GET /documents/:id.json`, which this server does not use. The trade and payout read tools list each attachment's id, file name, size and type, and nothing more.

### Read-only mode

Set `MCP_READ_ONLY=true` to leave out every write tool, so the server offers only the 25 read tools. The write tools are not registered at all, so a client cannot call them even if it ignores the annotations. The value is `true` or `false`, in any case, and anything else stops the server at startup.

### Filtering and paging holdings

`list_holdings` and `list_portfolio_holdings` return one page of holdings at a time, because a full list can be too large for an assistant to read. A page is filled until the response reaches a size limit (30,000 characters by default, see [Settings](#settings)), so the number of holdings per page varies. They accept these optional inputs:

| Input | Effect |
|-------|--------|
| `search` | Only holdings whose instrument code or name contains the text, ignoring case (at most 100 characters) |
| `market_code` | Only holdings on this market, for example `ASX` or `NASDAQ` |
| `valid_position` | `true` for holdings with a current position, `false` for closed ones |
| `limit` | Most holdings in one page, 1 to 200. A page is also cut short when it fills the size limit. |
| `cursor` | The `next_cursor` from the previous page. Leave out for the first page. |
| `portfolio_id` | `list_holdings` only: only holdings in this portfolio |

The result keeps Sharesight's other fields and adds a `pagination` object with `total` (matches before paging), `returned`, `has_more` and `next_cursor`, which is `null` on the last page. Pass `next_cursor` as `cursor` to get the next page. The cursor carries the filters, so they need not be repeated, and repeating them with different values is an error. A cursor is signed, so an altered one is refused, and it only works for the query it came from.

Sharesight offers no filter or paging options for holdings, so the server fetches the full list and applies these itself. The first page always fetches fresh from Sharesight and names that list a snapshot, whose id the cursor carries. Later pages use the same snapshot from a short-lived in-memory cache, so a walk sees one consistent list and other calls cannot change it under a walk in progress. If the cache has lost the snapshot, the next page fetches again and carries on from the same position, so the data may have changed in between. Results that fit in one page are not cached. Holdings are ordered by id so pages stay stable.

### Settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `MCP_MAX_RESPONSE_CHARS` | `30000` | Size limit for one page of a paged list, in characters (at least 5000). Keep it well under your client's tool output limit, which in Claude Code defaults to 25,000 tokens. The default is about a third of the size that exceeded that limit in testing. |
| `MCP_CACHE_TTL_SECONDS` | `60` | How long the holdings list is cached for later pages. `0` turns the cache off. |
| `MCP_READ_ONLY` | `false` | `true` leaves out the tools that create, change or delete data. See [Read-only mode](#read-only-mode). |
| `MCP_DATA_ROOT` | none | Directory that `attachment_path` reads from. See [Attachments](#attachments). |
| `MCP_MAX_ATTACHMENT_BYTES` | `10485760` | Largest attachment, in bytes. See [Attachments](#attachments). |
| `MCP_CURSOR_SECRET` | random | Signs cursors. By default each process picks its own, so a cursor stops working after a restart and does not work on another instance. Set the same value on every instance to avoid that. |
| `SHARESIGHT_BASE_URL` | `https://api.sharesight.com` | Replaces the Sharesight address, for tests or a proxy. It must be `https`, except that `http` is accepted for localhost, because your client secret is sent to this address. It cannot have a query or fragment. |

## Install from Source

```bash
git clone https://github.com/lethek/sharesight-mcp.git
cd sharesight-mcp
npm install
npm run build
```

Then configure:

```json
{
  "mcpServers": {
    "sharesight": {
      "command": "node",
      "args": ["/path/to/sharesight-mcp/dist/index.js", "serve"],
      "env": {
        "SHARESIGHT_CLIENT_ID": "your_client_id",
        "SHARESIGHT_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

## HTTP Mode

By default the server talks to a local client over stdio. To serve MCP over Streamable HTTP instead, run `sharesight-mcp serve --http` (or set `MCP_TRANSPORT=http`).

| Variable | Default | Purpose |
|----------|---------|---------|
| `MCP_PORT` | `3000` | Port to listen on |
| `MCP_HOST` | `127.0.0.1` | Address to bind |
| `MCP_AUTH_TOKEN` | none | Bearer token clients must send |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`, an alternative to the `--http` flag (using `--http` with `MCP_TRANSPORT=stdio` is an error) |

`MCP_HOST` accepts IPv6 addresses with or without brackets, for example `[::1]`.

The endpoint is `/mcp`, and `/healthz` returns `ok` without authentication, for container health checks. It only reports that the process is up and listening. It does not check that Sharesight is reachable or that the credentials still work.

The endpoint acts as your single Sharesight account, so anyone who can call it can read and change your portfolio. `MCP_AUTH_TOKEN` is required when `MCP_HOST` is not a loopback address, and the server will not start without it. Without a token on loopback, requests with a non-local `Host` or `Origin` header are rejected. The server speaks plain HTTP, so put it behind a TLS-terminating proxy before exposing it beyond your machine.

Clients send the token as `Authorization: Bearer <token>`.

The server is stateless. Each request gets a fresh server instance and there are no sessions, so it works behind a round-robin load balancer. It serves both the 2026-07-28 protocol and 2025-era clients, over stdio as well as HTTP.

Responses are streamed with a keepalive every 15 seconds, so long calls such as the performance reports (up to 180 seconds) are not cut by a proxy's idle timeout. A proxy's total request timeout should still be above 180 seconds.

On SIGINT or SIGTERM the server stops accepting connections and gives in-flight requests 8 seconds to finish before cutting them.

## Docker

Images are published to GitHub Container Registry for `linux/amd64` and `linux/arm64`:

| Tag | Published when |
|-----|----------------|
| `main`, `sha-<short>` | A commit is pushed to `main`. The server reports the version `0.0.0-main.<sha>`. |
| `1.2.3`, `1.2`, `1`, `latest` | A tag `v1.2.3` is pushed. `latest` is skipped for prereleases such as `v1.2.3-rc.1`. |

```bash
docker run -d --name sharesight-mcp -p 3000:3000 \
  -e SHARESIGHT_CLIENT_ID=your_client_id \
  -e SHARESIGHT_CLIENT_SECRET=your_client_secret \
  -e MCP_AUTH_TOKEN=a_long_random_token \
  ghcr.io/lethek/sharesight-mcp:latest
```

The container runs in HTTP mode, listens on all interfaces and runs as a non-root user. It will not start without `MCP_AUTH_TOKEN`. Add `-e MCP_READ_ONLY=true` to run it without the write tools. See [HTTP Mode](#http-mode) for the other settings and for putting TLS in front of it. The image has a health check against `/healthz`.

## Releasing

The git tag is the only place a version is written. To release, tag a commit on `main` and push the tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The Docker workflow runs the tests, rejects a tag that is not `v<major>.<minor>.<patch>` or is not on `main`, and stamps the version into the image. `package.json` keeps the placeholder `0.0.0-dev`.

## Token Handling

Access tokens are held in memory only. The server requests a new one when the current token expires, so nothing is written to disk.

## Error Handling

Common errors:
- **401** - Credentials rejected, or the API still refused a fresh token after one automatic retry
- **403** - The API application lacks permission for the request
- **404** - Resource not found
- **422** - Validation error (check field values)

## Development

```bash
npm run dev     # Watch mode
npm run build   # Build for production
npm start       # Run the server
npm test        # Build and run the tests
```

## License

MIT

## Support

- **Sharesight Support**: support@sharesight.com
- **API Documentation**: https://api.sharesight.com/doc/api/v3
- **MCP Protocol**: https://modelcontextprotocol.io/
