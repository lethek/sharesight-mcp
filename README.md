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

This server exposes **28 tools** covering all Sharesight v3 API endpoints:

### Portfolio Management
| Tool | Description |
|------|-------------|
| `list_portfolios` | List all user portfolios with optional consolidated view |
| `get_portfolio` | Get detailed portfolio information by ID |
| `list_portfolio_holdings` | List all holdings within a specific portfolio |
| `get_portfolio_user_setting` | Get user display preferences for a portfolio |
| `update_portfolio_user_setting` | Update chart type, grouping, and other display settings |

### Holdings Management
| Tool | Description |
|------|-------------|
| `list_holdings` | List all holdings across all portfolios |
| `get_holding` | Get holding details with optional cost base and historical values |
| `update_holding` | Update holding settings (DRP configuration) |
| `delete_holding` | Remove a holding from a portfolio |

### Custom Investments
| Tool | Description |
|------|-------------|
| `list_custom_investments` | List custom/unlisted investments |
| `get_custom_investment` | Get custom investment details |
| `create_custom_investment` | Create a new custom investment (property, bonds, etc.) |
| `update_custom_investment` | Update custom investment properties |
| `delete_custom_investment` | Remove a custom investment |

### Custom Investment Prices
| Tool | Description |
|------|-------------|
| `list_custom_investment_prices` | Get price history for a custom investment |
| `create_custom_investment_price` | Add a new price entry |
| `update_custom_investment_price` | Modify an existing price entry |
| `delete_custom_investment_price` | Remove a price entry |

### Coupon Rates (Fixed Interest)
| Tool | Description |
|------|-------------|
| `list_coupon_rates` | List interest rates for fixed interest investments |
| `create_coupon_rate` | Add a new coupon rate |
| `update_coupon_rate` | Modify a coupon rate |
| `delete_coupon_rate` | Remove a coupon rate |

### Performance Reports
| Tool | Description |
|------|-------------|
| `get_performance_report` | Detailed performance breakdown with gains analysis |
| `get_performance_index_chart` | Chart data for visualizing portfolio performance |

### Other
| Tool | Description |
|------|-------------|
| `list_countries` | Get Sharesight-supported countries and their settings |
| `show_coupon_code` | View applied promotional coupon code |
| `apply_coupon_code` | Apply a promotional coupon code |
| `delete_coupon_code` | Remove applied coupon code |

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

The container runs in HTTP mode, listens on all interfaces and runs as a non-root user. It will not start without `MCP_AUTH_TOKEN`. See [HTTP Mode](#http-mode) for the other settings and for putting TLS in front of it. The image has a health check against `/healthz`.

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
