import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { MAX_SEARCH_LENGTH, type HoldingsLister } from "../holdings-list.js";
import { DELETE, READ_ONLY, UPDATE, consolidated, formatError, formatResult, holdingId, portfolioId } from "./common.js";

const MAX_LIMIT = 200;

/** Filter and paging inputs shared by the holdings list tools. Sharesight has no such parameters, so they are applied here. */
const holdingListOptions = {
  search: z.string().max(MAX_SEARCH_LENGTH).optional().describe(`Only holdings whose instrument code or name contains this text (case-insensitive, at most ${MAX_SEARCH_LENGTH} characters)`),
  market_code: z.string().optional().describe("Only holdings on this market, for example ASX or NASDAQ"),
  valid_position: z.boolean().optional().describe("true for holdings with a current position, false for closed ones"),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Most holdings to return in one page (maximum ${MAX_LIMIT}). A page is also cut short when it fills the response size limit.`),
  cursor: z.string().nullish().describe("The pagination.next_cursor from the previous page, to get the next page. Leave out for the first page. The cursor carries the filters."),
};

const HOLDINGS_PAGING_HELP =
  "Results come in pages sized to fit the response limit. Check pagination.has_more, and pass pagination.next_cursor as cursor to get the next page; never work out a cursor yourself.";

export function registerHoldingReadTools(server: McpServer, client: SharesightClient, holdings: HoldingsLister) {
  server.registerTool(
    "list_holdings",
    {
      description: `Retrieves holdings across all portfolios. ${HOLDINGS_PAGING_HELP}`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().optional().describe("Only holdings in this portfolio"),
        ...holdingListOptions,
      }),
    },
    async (args) => {
      try {
        return formatResult(await holdings.list("list_holdings", () => client.listHoldings(), args));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_portfolio_holdings",
    {
      description: `Retrieves the holdings for a specific portfolio. ${HOLDINGS_PAGING_HELP}`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        consolidated,
        ...holdingListOptions,
      }),
    },
    async (args) => {
      try {
        // portfolio_id selects the endpoint here, so it must not also filter the holdings (a consolidated view spans portfolios)
        const { portfolio_id, consolidated, ...options } = args;
        const scope = `list_portfolio_holdings:${portfolio_id}:${consolidated ?? false}`;

        return formatResult(await holdings.list(scope, () => client.listPortfolioHoldings(portfolio_id, consolidated), options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_holding",
    {
      description: "Retrieves details of a specific holding",
      annotations: READ_ONLY,
      inputSchema: z.object({
        holding_id: holdingId,
        average_purchase_price: z.boolean().optional().describe("Include average purchase price in response"),
        cost_base: z.boolean().optional().describe("Include cost base in response"),
        values_over_time: z.string().optional().describe("Set to 'true' for values from inception, or a date (YYYY-MM-DD) for start date"),
      }),
    },
    async (args) => {
      try {
        const result = await client.getHolding(args.holding_id, {
          average_purchase_price: args.average_purchase_price,
          cost_base: args.cost_base,
          values_over_time: args.values_over_time,
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerHoldingWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "update_holding",
    {
      description: "Updates a holding (currently supports DRP settings)",
      annotations: UPDATE,
      inputSchema: z.object({
        holding_id: holdingId,
        enable_drp: z.boolean().optional().describe("Set to true to enable DRP, false to disable"),
        drp_mode_setting: z.string().optional().describe("DRP mode: up, down, half, or down_track"),
      }),
    },
    async (args) => {
      try {
        const result = await client.updateHolding(args.holding_id, {
          enable_drp: args.enable_drp,
          drp_mode_setting: args.drp_mode_setting,
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_holding",
    {
      description: "Deletes a holding",
      annotations: DELETE,
      inputSchema: z.object({
        holding_id: z.number().describe("The holding ID to delete"),
      }),
    },
    async (args) => {
      try {
        const result = await client.deleteHolding(args.holding_id);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
