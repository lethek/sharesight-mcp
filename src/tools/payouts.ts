import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { attachmentInput, attachmentRemoval, withAttachment, type AttachmentSettings } from "./attachments.js";
import { CREATE, DELETE, OVERWRITE, READ_ONLY, formatError, formatResult } from "./common.js";

const ATTACHMENT_HELP = "Payouts list their attachments (id, file name, size, type) but this server cannot download the file itself.";

/** Each payout type has its own object of amounts and tax details, named after the type. */
const PAYOUT_TYPES = [
  "au_local_dividend",
  "au_foreign_dividend",
  "au_local_interest",
  "au_foreign_interest",
  "nz_local_dividend",
  "nz_foreign_dividend",
  "nz_local_interest",
  "nz_foreign_interest",
  "row_local_dividend",
  "row_foreign_dividend",
  "row_local_interest",
  "row_foreign_interest",
] as const;

const typeDetails = Object.fromEntries(
  PAYOUT_TYPES.map((type) => [
    type,
    z.record(z.string(), z.union([z.number(), z.boolean()])).optional().describe(
      `Amounts and tax details when type is ${type}, for example { "amount": 100, "tax_credit": 10 }. The field names are in the Sharesight payouts documentation.`
    ),
  ])
);

const reinvestmentTrade = z.object({
  reinvested: z.boolean().describe("true to create or update a DRP trade, false to remove it"),
  quantity: z.number().describe("Units reinvested"),
  price: z.number().optional().describe("DRP price per unit, in instrument currency"),
  exchange_rate: z.number().optional().describe("The DRP's exchange rate"),
  balance_brought_forward: z.number().optional().describe("DRP balance brought forward, for plans that round down and track a balance"),
});

/** Sharesight rejects a payout write without reinvestment_trade.reinvested and .quantity, so a create without a DRP sends this. */
const NO_REINVESTMENT = { reinvested: false, quantity: 0 };

const payoutFields = {
  goes_ex_on: z.string().optional().describe("Ex date YYYY-MM-DD"),
  exchange_rate: z.number().optional().describe("Exchange rate as portfolio currency / payout currency"),
  non_taxable: z.boolean().optional().describe("true if the payout is not taxable"),
  comments: z.string().optional().describe("Comments on the payout"),
  send_to_xero: z.boolean().optional().describe("true to sync the payout with Xero"),
  ...typeDetails,
};

export function registerPayoutReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_payouts",
    {
      description: `Retrieves the payouts (dividends and interest) of a holding. ${ATTACHMENT_HELP}`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        holding_id: z.number().describe("The holding ID"),
        use_date: z.enum(["paid_on", "ex_date"]).optional().describe("Which payout date to filter on"),
      }),
    },
    async ({ holding_id, ...options }) => {
      try {
        return formatResult(await client.listPayouts(holding_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_payout",
    {
      description: `Retrieves a single payout by ID. ${ATTACHMENT_HELP}`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        payout_id: z.number().describe("The payout ID"),
      }),
    },
    async (args) => {
      try {
        return formatResult(await client.getPayout(args.payout_id));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

/** @param paths - where attachment_path may read from, and the size limit */
export function registerPayoutWriteTools(server: McpServer, client: SharesightClient, paths: AttachmentSettings) {
  server.registerTool(
    "create_payout",
    {
      description: "Creates a payout (dividend or interest) on a holding, optionally with an attached file such as a statement. Give the details object that matches type.",
      annotations: CREATE,
      inputSchema: z.object({
        holding_id: z.number().describe("The holding ID"),
        type: z.enum(PAYOUT_TYPES).describe("The payout type"),
        paid_on: z.string().describe("Payout date YYYY-MM-DD"),
        reinvestment_trade: reinvestmentTrade.optional().describe("Details of the DRP trade when the payout is reinvested. Left out, the payout is not reinvested."),
        ...payoutFields,
        ...attachmentInput,
      }),
    },
    async ({ holding_id, reinvestment_trade = NO_REINVESTMENT, ...fields }) => {
      try {
        return formatResult(await client.createPayout(holding_id, await withAttachment({ ...fields, reinvestment_trade }, paths)));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_payout",
    {
      description: "Updates a payout. Giving a new attachment replaces the existing one. Give the details object that matches the payout's type.",
      annotations: OVERWRITE,
      inputSchema: z.object({
        payout_id: z.number().describe("The payout ID"),
        paid_on: z.string().optional().describe("Payout date YYYY-MM-DD"),
        reinvestment_trade: reinvestmentTrade.describe(
          "Always required by Sharesight. Send the payout's current DRP details, or reinvested false to leave it without one: false removes an existing DRP trade."
        ),
        ...payoutFields,
        confirm_source: z.literal("pro_rata").optional().describe("The source of the confirmation, when confirming a payout"),
        ...attachmentInput,
        ...attachmentRemoval,
      }),
    },
    async ({ payout_id, ...fields }) => {
      try {
        return formatResult(await client.updatePayout(payout_id, await withAttachment(fields, paths)));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_payout",
    {
      description: "Deletes a payout",
      annotations: DELETE,
      inputSchema: z.object({
        payout_id: z.number().describe("The payout ID to delete"),
      }),
    },
    async (args) => {
      try {
        return formatResult(await client.deletePayout(args.payout_id));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
