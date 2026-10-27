import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { READ_ONLY, UPDATE, consolidated, formatError, formatResult, portfolioId } from "./common.js";

export function registerPortfolioReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_portfolios",
    {
      description: "Retrieves a list of the user's portfolios. Optionally filter by consolidated view or instrument.",
      annotations: READ_ONLY,
      inputSchema: z.object({
        consolidated: z.boolean().optional().describe("Set to true to see consolidated portfolio views"),
        instrument_id: z.number().optional().describe("Filter by instrument ID. When set, consolidated defaults to false"),
      }),
    },
    async (args) => {
      try {
        const result = await client.listPortfolios(args);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_portfolio",
    {
      description: "Retrieves a single portfolio by ID",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        consolidated,
      }),
    },
    async (args) => {
      try {
        const result = await client.getPortfolio(args.portfolio_id, args.consolidated);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_portfolio_user_setting",
    {
      description: "Retrieves user settings for a portfolio (chart type, grouping, etc.)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        consolidated,
      }),
    },
    async (args) => {
      try {
        const result = await client.showPortfolioUserSetting(args.portfolio_id, args.consolidated);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerPortfolioWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "update_portfolio_user_setting",
    {
      description: "Updates user settings for a portfolio",
      annotations: UPDATE,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        consolidated,
        portfolio_chart: z.string().optional().describe("Chart type: VALUE, VALUELINE, GROWTH, BENCHMARK, or HIDE"),
        holding_chart: z.string().optional().describe("Holding chart type: PRICE, HOLDING_VALUE, BENCHMARK, or HIDE"),
        combined: z.boolean().optional().describe("True to combine holdings in consolidated portfolios"),
        grouping: z.string().optional().describe("Grouping to use (e.g., market, country, currency)"),
        include_sold_shares: z.boolean().optional().describe("True to include sold shares in calculations"),
      }),
    },
    async (args) => {
      try {
        const { portfolio_id, consolidated, ...settings } = args;
        const result = await client.updatePortfolioUserSetting(
          portfolio_id,
          { portfolio_user_setting: settings },
          consolidated
        );

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
