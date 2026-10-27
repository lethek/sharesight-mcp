import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { attachmentInput, attachmentRemoval, withAttachment, type AttachmentSettings } from "./attachments.js";
import { CREATE, DELETE, OVERWRITE, READ_ONLY, formatError, formatResult, holdingId, portfolioId } from "./common.js";

const ATTACHMENT_HELP = "Trades list their attachments (id, file name, size, type) but this server cannot download the file itself.";

/** The fields Sharesight takes when creating or updating a trade. Display-only fields (display_*) are left out. */
const tradeFields = {
  portfolio_id: z.number().optional().describe("Portfolio to trade in. Alternatively give holding_id."),
  holding_id: z.number().optional().describe("Holding to trade. Then portfolio_id and the instrument lookup are not needed."),
  instrument_id: z.number().optional().describe("Instrument to look up. Needed unless holding_id, or instrument_code with instrument_market_code, is given."),
  instrument_code: z.string().optional().describe("Instrument code, together with instrument_market_code"),
  instrument_market_code: z.string().optional().describe("Market code for instrument_code"),
  instrument_market_country_code: z.string().optional().describe("Market country code, an alternative to instrument_market_code"),
  description_code: z.string().optional().describe("BUY, SELL, SPLIT, BONUS, CONSOLD, CANCEL, CAPITAL_RETURN, OPENING_BALANCE, ADJUST_COST_BASE, CAPITAL_CALL or TRANSFER_OUT"),
  transaction_date: z.string().optional().describe("Trade date YYYY-MM-DD"),
  quantity: z.number().optional().describe("Units traded. A whole number unless the market allows fractions."),
  price: z.number().optional().describe("Price per unit"),
  cost_base: z.number().optional().describe("Cost base, for an opening balance"),
  exchange_rate: z.number().optional().describe("Exchange rate as portfolio currency / instrument currency"),
  brokerage: z.number().optional().describe("Brokerage fee"),
  brokerage_currency_code: z.string().optional().describe("ISO code of the brokerage currency: the portfolio's or the instrument's"),
  adjust_cost_base_value: z.number().optional().describe("Required for ADJUST_COST_BASE"),
  capital_return_value: z.number().optional().describe("Required for CAPITAL_RETURN and CAPITAL_CALL"),
  paid_on: z.string().optional().describe("Paid on date YYYY-MM-DD, for CAPITAL_RETURN and CAPITAL_CALL"),
  price_currency_code: z.string().optional().describe("Currency a precious metal trade was bought in"),
  market_price: z.number().optional().describe("Market price on the opening balance date, for an opening balance"),
  market_price_exchange_rate: z.number().optional().describe("Exchange rate on the opening balance date, for an opening balance"),
  broker: z.object({ id: z.number().describe("Broker ID") }).optional().describe("The broker the trade came from"),
  comments: z.string().optional().describe("Comments on the trade"),
  unique_identifier: z.string().max(255).optional().describe("Up to 255 characters. Sharesight uses it to reject a trade it has already loaded."),
  validate_position: z.boolean().optional().describe("true to check the position after this trade is not negative"),
  send_to_xero: z.boolean().optional().describe("true to sync the trade with Xero"),
};

export function registerTradeReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_trades",
    {
      description: `Retrieves the trades in a portfolio. ${ATTACHMENT_HELP}`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId,
        start_date: z.string().optional().describe("Trades from this date YYYY-MM-DD (defaults to portfolio inception)"),
        end_date: z.string().optional().describe("Trades until this date YYYY-MM-DD (defaults to today)"),
        unique_identifier: z.string().optional().describe("Only the trade with this unique identifier"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.listTrades(portfolio_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_holding_trades",
    {
      description: `Retrieves the trades of a holding. ${ATTACHMENT_HELP}`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        holding_id: holdingId,
        unique_identifier: z.string().optional().describe("Only the trade with this unique identifier"),
      }),
    },
    async ({ holding_id, ...options }) => {
      try {
        return formatResult(await client.listHoldingTrades(holding_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_trade",
    {
      description: `Retrieves a single trade by ID. ${ATTACHMENT_HELP}`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        trade_id: z.number().describe("The trade ID"),
      }),
    },
    async (args) => {
      try {
        return formatResult(await client.getTrade(args.trade_id));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

/** @param paths - where attachment_path may read from, and the size limit */
export function registerTradeWriteTools(server: McpServer, client: SharesightClient, paths: AttachmentSettings) {
  server.registerTool(
    "create_trade",
    {
      description: "Creates a trade in a portfolio or against a holding, optionally with an attached file such as a contract note",
      annotations: CREATE,
      inputSchema: z.object({ ...tradeFields, ...attachmentInput }),
    },
    async (args) => {
      try {
        return formatResult(await client.createTrade(await withAttachment(args, paths)));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_trade",
    {
      description: "Updates a trade. Giving a new attachment replaces the existing one.",
      annotations: OVERWRITE,
      inputSchema: z.object({
        trade_id: z.number().describe("The trade ID"),
        ...tradeFields,
        ...attachmentInput,
        ...attachmentRemoval,
      }),
    },
    async ({ trade_id, ...fields }) => {
      try {
        return formatResult(await client.updateTrade(trade_id, await withAttachment(fields, paths)));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_trade",
    {
      description: "Deletes a trade",
      annotations: DELETE,
      inputSchema: z.object({
        trade_id: z.number().describe("The trade ID to delete"),
      }),
    },
    async (args) => {
      try {
        return formatResult(await client.deleteTrade(args.trade_id));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
