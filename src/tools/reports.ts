import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { READ_ONLY, consolidated, formatError, formatResult, portfolioId } from "./common.js";

const grouping = z
  .string()
  .optional()
  .describe(
    "One of: market, industry_classification, sector_classification, investment_type, country, portfolio, ungrouped or custom_group"
  );
const customGroupId = z.number().optional().describe("The custom group ID, when grouping is custom_group");

/** The portfolio reports that only the v2 API offers. */
export function registerReportReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "get_capital_gains_report",
    {
      description: "Returns the capital gains tax report for an Australian portfolio (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        start_date: z.string().optional().describe("Report from this date YYYY-MM-DD (default: inception)"),
        end_date: z.string().optional().describe("Report until this date YYYY-MM-DD"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getReportV2(portfolio_id, "capital_gains", options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_unrealised_cgt_report",
    {
      description: "Returns the unrealised capital gains tax report for an Australian portfolio (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        balance_date: z.string().describe("The date to price the holdings on YYYY-MM-DD"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getReportV2(portfolio_id, "unrealised_cgt", options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_diversity_report",
    {
      description: "Returns the diversity report for a portfolio (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        date: z.string().optional().describe("Report date YYYY-MM-DD"),
        consolidated,
        grouping,
        custom_group_id: customGroupId,
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getReportV2(portfolio_id, "diversity", options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_valuation_report",
    {
      description: "Returns the valuation report for a portfolio (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        balance_date: z.string().optional().describe("Report as of this date YYYY-MM-DD"),
        consolidated,
        include_sales: z.boolean().optional().describe("True to include sold holdings"),
        grouping,
        custom_group_id: customGroupId,
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getReportV2(portfolio_id, "valuation", options));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
