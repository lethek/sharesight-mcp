import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { CREATE, DELETE, READ_ONLY, UPDATE, formatError, formatResult } from "./common.js";

const adjustmentFields = {
  announced_on: z.string().describe("The date the adjustment was announced YYYY-MM-DD"),
  goes_ex_on: z.string().describe("The ex-dividend date YYYY-MM-DD"),
  paid_on: z.string().describe("The date the adjustment was paid YYYY-MM-DD"),
  amount_per_share: z.number().describe("The amount per share, in the adjustment currency"),
  tax_credit: z.number().describe("The tax credit amount"),
  currency_code: z.string().describe("The currency code, for example AUD, USD or NZD"),
  drp_indicator: z.number().int().optional().describe("Dividend Reinvestment Plan indicator"),
  franked_percent: z.number().optional().describe("The percentage of the dividend that is franked"),
  drp_price: z.number().optional().describe("The Dividend Reinvestment Plan price"),
};

export function registerAdjustmentReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_adjustments",
    {
      description: "Lists the adjustments (dividends) of an ordinary custom investment",
      annotations: READ_ONLY,
      inputSchema: z.object({
        instrument_id: z.number().describe("The custom investment instrument ID"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD"),
        page: z.string().optional().describe("Pagination pointer from the previous response"),
        per_page: z.number().optional().describe("Items per page (default 50, max 100)"),
      }),
    },
    async ({ instrument_id, ...options }) => {
      try {
        return formatResult(await client.listAdjustments(instrument_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_adjustment",
    {
      description: "Gets one custom investment adjustment (dividend)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        adjustment_id: z.number().describe("The adjustment ID"),
      }),
    },
    async (args) => {
      try {
        return formatResult(await client.getAdjustment(args.adjustment_id));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerAdjustmentWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "create_adjustment",
    {
      description: "Creates an adjustment (dividend) for an ordinary custom investment",
      annotations: CREATE,
      inputSchema: z.object({
        instrument_id: z.number().describe("The custom investment instrument ID"),
        ...adjustmentFields,
      }),
    },
    async ({ instrument_id, ...adjustment }) => {
      try {
        return formatResult(await client.createAdjustment(instrument_id, adjustment));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_adjustment",
    {
      description: "Updates an adjustment (dividend). Only the fields you send change.",
      annotations: UPDATE,
      inputSchema: z.object(adjustmentFields).partial().extend({
        adjustment_id: z.number().describe("The adjustment ID"),
      }),
    },
    async ({ adjustment_id, ...adjustment }) => {
      try {
        return formatResult(await client.updateAdjustment(adjustment_id, adjustment));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_adjustment",
    {
      description: "Deletes an adjustment (dividend)",
      annotations: DELETE,
      inputSchema: z.object({
        adjustment_id: z.number().describe("The adjustment ID to delete"),
      }),
    },
    async (args) => {
      try {
        return formatResult(await client.deleteAdjustment(args.adjustment_id));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
