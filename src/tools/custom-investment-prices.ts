import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { CREATE, DELETE, READ_ONLY, UPDATE, formatError, formatResult } from "./common.js";

export function registerCustomInvestmentPriceReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_custom_investment_prices",
    {
      description: "Retrieves prices for a custom investment",
      annotations: READ_ONLY,
      inputSchema: z.object({
        custom_investment_id: z.number().describe("The custom investment ID"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD"),
        page: z.string().optional().describe("Pagination pointer"),
        per_page: z.number().optional().describe("Items per page (max 100)"),
      }),
    },
    async (args) => {
      try {
        const result = await client.listCustomInvestmentPrices(args.custom_investment_id, {
          start_date: args.start_date,
          end_date: args.end_date,
          page: args.page,
          per_page: args.per_page,
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerCustomInvestmentPriceWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "create_custom_investment_price",
    {
      description: "Creates a price entry for a custom investment",
      annotations: CREATE,
      inputSchema: z.object({
        custom_investment_id: z.number().describe("The custom investment ID"),
        last_traded_price: z.number().describe("The price in instrument currency"),
        last_traded_on: z.string().describe("The date YYYY-MM-DD"),
      }),
    },
    async (args) => {
      try {
        const result = await client.createCustomInvestmentPrice(args.custom_investment_id, {
          last_traded_price: args.last_traded_price,
          last_traded_on: args.last_traded_on,
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_custom_investment_price",
    {
      description: "Updates a price for a custom investment",
      annotations: UPDATE,
      inputSchema: z.object({
        price_id: z.number().describe("The price ID"),
        last_traded_price: z.number().optional().describe("The price in instrument currency"),
        last_traded_on: z.string().optional().describe("The date YYYY-MM-DD"),
      }),
    },
    async (args) => {
      try {
        const result = await client.updateCustomInvestmentPrice(args.price_id, {
          last_traded_price: args.last_traded_price,
          last_traded_on: args.last_traded_on,
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_custom_investment_price",
    {
      description: "Deletes a price for a custom investment",
      annotations: DELETE,
      inputSchema: z.object({
        price_id: z.number().describe("The price ID to delete"),
      }),
    },
    async (args) => {
      try {
        const result = await client.deleteCustomInvestmentPrice(args.price_id);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
