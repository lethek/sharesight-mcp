import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { CREATE, DELETE, READ_ONLY, formatError, formatResult } from "./common.js";

/** Account details and reference data: the coupon code on the account, and Sharesight's country definitions. */
export function registerAccountReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "show_coupon_code",
    {
      description: "Returns the coupon code applied to the current user",
      annotations: READ_ONLY,
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await client.showCouponCode();

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_my_user",
    {
      description: "Returns information on the current user (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return formatResult(await client.getMyUser());
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_user_instruments",
    {
      description: "Lists the instruments held in the current user's portfolios, with prices and fundamentals (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return formatResult(await client.listUserInstruments());
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_groups",
    {
      description:
        "Lists the ways to group a report: the built-in groupings (market, currency, country and so on) and the user's custom groups. A custom group's id is the custom_group_id the report tools take, with grouping set to custom_group (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return formatResult(await client.listGroups());
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_countries",
    {
      description: "Retrieves Sharesight country definitions",
      annotations: READ_ONLY,
      inputSchema: z.object({
        supported: z.boolean().optional().describe("Filter by supported status (omit for all)"),
      }),
    },
    async (args) => {
      try {
        const result = await client.listCountries(args.supported);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerAccountWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "apply_coupon_code",
    {
      description: "Applies a coupon code to the current user",
      annotations: CREATE,
      inputSchema: z.object({
        code: z.string().describe("The coupon code to apply"),
      }),
    },
    async (args) => {
      try {
        const result = await client.applyCouponCode(args.code);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_coupon_code",
    {
      description: "Removes the coupon code from the current user",
      annotations: DELETE,
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const result = await client.deleteCouponCode();

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
