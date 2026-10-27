import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { CREATE, DELETE, READ_ONLY, UPDATE, formatError, formatResult } from "./common.js";

export function registerCustomInvestmentReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_custom_investments",
    {
      description: "Retrieves a list of custom investments",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: z.number().optional().describe("Optional portfolio ID to filter by"),
      }),
    },
    async (args) => {
      try {
        const result = await client.listCustomInvestments(args.portfolio_id);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_custom_investment",
    {
      description: "Retrieves a single custom investment by ID",
      annotations: READ_ONLY,
      inputSchema: z.object({
        id: z.number().describe("The custom investment ID"),
      }),
    },
    async (args) => {
      try {
        const result = await client.getCustomInvestment(args.id);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerCustomInvestmentWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "create_custom_investment",
    {
      description: "Creates a new custom investment",
      annotations: CREATE,
      inputSchema: z.object({
        portfolio_id: z.number().optional().describe("Portfolio ID (optional, links to owner if not provided)"),
        code: z.string().describe("The investment code"),
        name: z.string().describe("The name of the custom investment"),
        country_code: z.string().describe("Country code (e.g., AU, NZ, US)"),
        investment_type: z.string().describe("Type: ORDINARY, WARRANT, SHAREFUND, PROPFUND, PREFERENCE, STAPLEDSEC, OPTIONS, RIGHTS, MANAGED_FUND, FIXED_INTEREST, PIE"),
        face_value: z.number().optional().describe("Face value per unit (FIXED_INTEREST only)"),
        interest_rate: z.number().optional().describe("Initial interest rate (FIXED_INTEREST only)"),
        income_type: z.string().optional().describe("DIVIDEND or INTEREST (FIXED_INTEREST only)"),
        payment_frequency: z.string().optional().describe("ON_MATURITY, YEARLY, TWICE_YEARLY, QUARTERLY, MONTHLY (FIXED_INTEREST only)"),
        first_payment_date: z.string().optional().describe("First payment date YYYY-MM-DD (FIXED_INTEREST only)"),
        maturity_date: z.string().optional().describe("Maturity date YYYY-MM-DD (FIXED_INTEREST only)"),
        auto_calc_income: z.boolean().optional().describe("Auto-populate income payments (FIXED_INTEREST only)"),
      }),
    },
    async (args) => {
      try {
        const result = await client.createCustomInvestment(args);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_custom_investment",
    {
      description: "Updates an existing custom investment",
      annotations: UPDATE,
      inputSchema: z.object({
        id: z.number().describe("The custom investment ID"),
        code: z.string().optional().describe("The investment code"),
        name: z.string().optional().describe("The name of the custom investment"),
        portfolio_id: z.number().optional().describe("Portfolio ID to associate with"),
        face_value: z.number().optional().describe("Face value per unit"),
        interest_rate: z.number().optional().describe("Interest rate"),
        income_type: z.string().optional().describe("DIVIDEND or INTEREST"),
        payment_frequency: z.string().optional().describe("Payment frequency"),
        first_payment_date: z.string().optional().describe("First payment date YYYY-MM-DD"),
        maturity_date: z.string().optional().describe("Maturity date YYYY-MM-DD"),
        auto_calc_income: z.boolean().optional().describe("Auto-populate income payments"),
      }),
    },
    async (args) => {
      try {
        const { id, ...updateData } = args;
        const result = await client.updateCustomInvestment(id, updateData);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_custom_investment",
    {
      description: "Deletes a custom investment",
      annotations: DELETE,
      inputSchema: z.object({
        id: z.number().describe("The custom investment ID to delete"),
      }),
    },
    async (args) => {
      try {
        const result = await client.deleteCustomInvestment(args.id);

        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
