import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { READ_ONLY, formatError, formatResult } from "./common.js";

/** Performance and portfolio reports. They only read data, so this area has no write tools. */
export function registerPerformanceReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "get_performance_report",
    {
      description: "Retrieves the performance report for a portfolio with gains, holdings breakdown, and benchmarks",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().describe("The portfolio ID"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD (defaults to portfolio inception)"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD (defaults to today)"),
        consolidated: z.boolean().optional().describe("Set to true for consolidated portfolio views"),
        include_sales: z.boolean().optional().describe("Include or exclude sales"),
        report_combined: z.boolean().optional().describe("Receive combined totals for same instruments across portfolios"),
        grouping: z.string().optional().describe("Group by: country, currency, custom_group, industry_classification, investment_type, market, portfolio, sector_classification, ungrouped"),
        custom_group_id: z.number().optional().describe("Custom group ID (requires grouping=custom_group)"),
        include_limited: z.boolean().optional().describe("Include holdings limited by user plan"),
        benchmark_code: z.string().optional().describe("Benchmark code and market (e.g., SPY.NYSE)"),
      }),
    },
    async (args) => {
      try {
        const result = await client.getPerformanceReport(args.portfolio_id, {
          start_date: args.start_date,
          end_date: args.end_date,
          consolidated: args.consolidated,
          include_sales: args.include_sales,
          report_combined: args.report_combined,
          grouping: args.grouping,
          custom_group_id: args.custom_group_id,
          include_limited: args.include_limited,
          benchmark_code: args.benchmark_code,
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_performance_index_chart",
    {
      description: "Returns performance index chart data points for visualizing portfolio performance over time",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().describe("The portfolio ID"),
        consolidated: z.boolean().optional().describe("True if consolidated view is requested"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD (defaults to inception)"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD (defaults to today)"),
        grouping: z.string().optional().describe("Group by: country, currency, custom_group, industry_classification, investment_type, market, portfolio, sector_classification, ungrouped"),
        custom_group_id: z.number().optional().describe("Custom group ID (requires grouping=custom_group)"),
        benchmark_code: z.string().optional().describe("Benchmark code and market (e.g., SPY.NYSE)"),
      }),
    },
    async (args) => {
      try {
        const result = await client.getPerformanceIndexChart(args.portfolio_id, {
          consolidated: args.consolidated,
          start_date: args.start_date,
          end_date: args.end_date,
          grouping: args.grouping,
          custom_group_id: args.custom_group_id,
          benchmark_code: args.benchmark_code,
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_portfolio_reports",
    {
      description: "Retrieves the reports saved for a portfolio",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().describe("The portfolio ID"),
        type: z.enum(["tax", "tools"]).describe("Which reports to list: tax or tools"),
      }),
    },
    async (args) => {
      try {
        return formatResult(await client.listPortfolioReports(args.portfolio_id, args.type));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_portfolio_overview",
    {
      description: "Retrieves a portfolio overview: the value and gains of each holding, optionally grouped",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().describe("The portfolio ID"),
        consolidated: z.boolean().optional().describe("Set to true for consolidated portfolio views"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD (defaults to portfolio inception)"),
        grouping: z.string().optional().describe("Group by: country, currency, custom_group, industry_classification, investment_type, market, portfolio, sector_classification, ungrouped"),
        custom_grouping_id: z.number().optional().describe("Custom group ID (requires grouping=custom_group)"),
        report_combined: z.boolean().optional().describe("Also receive totals for holdings combined by instrument"),
        include_sales: z.boolean().optional().describe("true to include holdings sold between the start date and today"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getPortfolioOverview(portfolio_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_portfolio_totals",
    {
      description: "Retrieves the totals of a portfolio",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().describe("The portfolio ID"),
        consolidated: z.boolean().optional().describe("Set to true for consolidated portfolio views"),
        include_sales: z.boolean().optional().describe("true to include sales, false to exclude them"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getPortfolioTotals(portfolio_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_portfolio_benchmark",
    {
      description: "Compares a portfolio's performance with a benchmark instrument",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().describe("The portfolio ID"),
        start_date: z.string().describe("Calculate from this date YYYY-MM-DD, in the portfolio's time zone"),
        end_date: z.string().optional().describe("Calculate to this date YYYY-MM-DD (defaults to today)"),
        instrument_id: z.number().optional().describe("The instrument to use as the benchmark"),
        consolidated: z.boolean().optional().describe("Set to true for consolidated portfolio views"),
        interest_method: z.enum(["simple", "compound"]).optional().describe("Interest method for percentage calculations (default simple)"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getPortfolioBenchmark(portfolio_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_portfolio_value",
    {
      description: "Retrieves the current value of a portfolio, optionally in another currency",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().describe("The portfolio ID"),
        consolidated: z.boolean().optional().describe("Set to true for consolidated portfolio views"),
        currency_code: z.string().optional().describe("ISO code of the currency to return the value in"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getPortfolioValue(portfolio_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_portfolio_value_data",
    {
      description: "Retrieves a portfolio's value over time with the price difference for the period",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().describe("The portfolio ID"),
        consolidated: z.boolean().optional().describe("Set to true for consolidated portfolio views"),
        start_date: z.string().optional().describe("Start of the period YYYY-MM-DD (defaults to portfolio inception)"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.getPortfolioValueData(portfolio_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
