import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { CREATE, DELETE, READ_ONLY, UPDATE, formatError, formatResult } from "./common.js";

export function registerCouponRateReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_coupon_rates",
    {
      description: "Retrieves coupon rates for a fixed interest custom investment",
      annotations: READ_ONLY,
      inputSchema: z.object({
        instrument_id: z.number().describe("The custom investment instrument ID"),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD"),
        page: z.string().optional().describe("Pagination pointer"),
        per_page: z.number().optional().describe("Items per page (max 100)"),
      }),
    },
    async (args) => {
      try {
        const result = await client.listCouponRates(args.instrument_id, {
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

export function registerCouponRateWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "create_coupon_rate",
    {
      description: "Creates a coupon rate for a custom investment",
      annotations: CREATE,
      inputSchema: z.object({
        instrument_id: z.number().describe("The custom investment instrument ID"),
        interest_rate: z.number().describe("The interest rate as a percentage"),
        date: z.string().describe("The date from which the rate applies YYYY-MM-DD"),
      }),
    },
    async (args) => {
      try {
        const result = await client.createCouponRate(args.instrument_id, {
          coupon_rate: {
            interest_rate: args.interest_rate,
            date: args.date,
          },
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_coupon_rate",
    {
      description: "Updates a coupon rate",
      annotations: UPDATE,
      inputSchema: z.object({
        id: z.number().describe("The coupon rate ID"),
        interest_rate: z.number().describe("The interest rate as a percentage"),
        date: z.string().describe("The date from which the rate applies YYYY-MM-DD"),
      }),
    },
    async (args) => {
      try {
        const result = await client.updateCouponRate(args.id, {
          coupon_rate: {
            interest_rate: args.interest_rate,
            date: args.date,
          },
        });

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_coupon_rate",
    {
      description: "Deletes a coupon rate",
      annotations: DELETE,
      inputSchema: z.object({
        id: z.number().describe("The coupon rate ID to delete"),
      }),
    },
    async (args) => {
      try {
        const result = await client.deleteCouponRate(args.id);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
