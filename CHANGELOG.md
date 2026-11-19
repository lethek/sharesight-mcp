# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-11-19

### Added

- Streamable HTTP transport, started with `serve --http` or `MCP_TRANSPORT=http`, with bearer token authentication (`MCP_AUTH_TOKEN`), `MCP_HOST`, `MCP_PORT` and an unauthenticated `/healthz` check.
- `MCP_READ_ONLY`, which leaves out every tool that creates, changes or deletes data.
- MCP annotations on every tool, marking reads, creates, updates and deletes.
- Docker images on `ghcr.io/lethek/sharesight-mcp`, published for `linux/amd64` and `linux/arm64`, which run HTTP mode as a non-root user.
- `SHARESIGHT_BASE_URL`, `MCP_MAX_RESPONSE_CHARS`, `MCP_CACHE_TTL_SECONDS` and `MCP_CURSOR_SECRET` settings.
- Filtering on `list_holdings` and `list_portfolio_holdings` by `search`, `market_code` and `valid_position`.
- Trade tools: `list_trades`, `list_holding_trades`, `get_trade`, `create_trade`, `update_trade` and `delete_trade`.
- Payout tools: `list_payouts`, `get_payout`, `create_payout`, `update_payout` and `delete_payout`. `update_payout` also sets a payout's currency through `currency_code`.
- Attachments on trades and payouts, given as `attachment_base64` or `attachment_path`, with `attachment_filename`. `attachment_path` over HTTP needs `MCP_DATA_ROOT`, and the size limit is `MCP_MAX_ATTACHMENT_BYTES`.
- Adjustment tools: `list_adjustments`, `get_adjustment`, `create_adjustment`, `update_adjustment` and `delete_adjustment`.
- Label tools: `list_labels`, `get_label`, `create_label`, `update_label`, `delete_label` and `delete_holding_label`.
- `list_portfolio_reports`, and the v2 reports `get_capital_gains_report`, `get_unrealised_cgt_report`, `get_diversity_report` and `get_valuation_report`.
- `get_my_user`, `list_user_instruments` and `list_groups`, from the v2 API.
- Unconfirmed payout and trade tools from the v2 API: `list_unconfirmed_payouts`, `list_unconfirmed_trades`, `list_rejected_trades`, `confirm_payout` and `reject_payout`.
- Cash account tools from the v2 API: `list_cash_accounts`, `get_cash_account`, `create_cash_account`, `update_cash_account`, `delete_cash_account`, `list_cash_account_transactions`, `create_cash_account_transaction`, `update_cash_account_transaction` and `delete_cash_account_transaction`.
- Unraid installation instructions in the README, pointing to a community template.

### Changed

- **Breaking:** `MCP_READ_ONLY` defaults to `true`, so the write tools are off unless it is set to `false`.
- **Breaking:** the server authenticates with the OAuth client credentials grant, using `SHARESIGHT_CLIENT_ID` and `SHARESIGHT_CLIENT_SECRET` only. It acts as the single account linked to the API application, and tokens are held in memory.
- **Breaking:** Node.js 24 or later is required, up from 18.
- **Breaking:** `list_holdings`, `list_portfolio_holdings` and `list_countries` return one page at a time with a `pagination` object, taking `limit` and `cursor`. Follow `next_cursor` until `has_more` is false to get the whole list.
- Holdings are listed in id order so pages stay stable.
- The server version comes from the release tag, and `package.json` holds the placeholder `0.0.0-dev`.
- The package depends on MCP SDK v2 (`@modelcontextprotocol/server` and `@modelcontextprotocol/node`) and Zod 4.

### Removed

- **Breaking:** the `auth` command and its saved tokens. Set `SHARESIGHT_CLIENT_ID` and `SHARESIGHT_CLIENT_SECRET` instead.
- **Breaking:** the `revoke_api_access` tool, which called Sharesight's `/oauth/revoke`. There is no replacement in this server.

### Fixed

- `update_portfolio_user_setting` sends `PATCH` with the `portfolio_user_setting` key, which Sharesight accepts, instead of `PUT` with `portfolio_user_settings`.

## [1.0.0] - 2026-01-20

The original release by the upstream author, [Haizzz/sharesight-mcp](https://github.com/Haizzz/sharesight-mcp).

### Added

- MCP server for the Sharesight v3 API over stdio, started with `serve`.
- `auth` command, which signs in through the browser with an authorization code and saves tokens in `~/.sharesight-mcp/tokens.json`. The tokens refresh automatically.
- Portfolio tools: `list_portfolios`, `get_portfolio`, `list_portfolio_holdings`, `get_portfolio_user_setting` and `update_portfolio_user_setting`.
- Holding tools: `list_holdings`, `get_holding`, `update_holding` and `delete_holding`.
- Custom investment tools: `list_custom_investments`, `get_custom_investment`, `create_custom_investment`, `update_custom_investment` and `delete_custom_investment`.
- Custom investment price tools: `list_custom_investment_prices`, `create_custom_investment_price`, `update_custom_investment_price` and `delete_custom_investment_price`.
- Coupon rate tools: `list_coupon_rates`, `create_coupon_rate`, `update_coupon_rate` and `delete_coupon_rate`.
- Performance tools: `get_performance_report` and `get_performance_index_chart`.
- `list_countries`, `show_coupon_code`, `apply_coupon_code`, `delete_coupon_code` and `revoke_api_access`.

[Unreleased]: https://github.com/lethek/sharesight-mcp/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/lethek/sharesight-mcp/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/lethek/sharesight-mcp/releases/tag/v1.0.0
