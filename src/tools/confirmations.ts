import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { DELETE, READ_ONLY, UPDATE, formatError, formatResult } from "./common.js";

/**
 * Sharesight builds payouts and trades from company events (dividends, splits, mergers) and from maturing interest instruments, and
 * leaves them unconfirmed until the user accepts or rejects them. Only the v2 API lists and changes them.
 *
 * There is no tool to confirm or reject a trade. The documented v2 call (POST /trades.json with a state) creates a new confirmed trade
 * from the fields it is given instead, even with state "rejected", and the v3 equivalents are not available to API clients. A dividend
 * reinvestment (DRP) trade follows its payout, so confirming or rejecting the payout settles the trade too.
 */

const holdingId = z.number().describe("The holding ID");
const companyEventId = z.number().optional().describe("The company_event_id of the unconfirmed item, as listed by the list_unconfirmed tools");

const EARLIEST = "2000-01-01";

/** Unconfirmed items can fall after today, so the default window runs to the end of next year. */
const latestDefault = () => `${new Date().getUTCFullYear() + 1}-12-31`;

const rangeInput = {
  portfolio_id: z.number().describe("The portfolio ID"),
  start_date: z.string().optional().describe(`Start date YYYY-MM-DD (default ${EARLIEST})`),
  end_date: z.string().optional().describe("End date YYYY-MM-DD (default: the end of next year)"),
};

/** Exactly one of the two ways to name an unconfirmed item must be given. */
function identify(companyEventId: number | undefined, other: string | undefined, otherName: string): string | undefined {
  if (companyEventId !== undefined && other !== undefined) {
    return `Give company_event_id or ${otherName}, not both.`;
  }

  if (companyEventId === undefined && other === undefined) {
    return `Give company_event_id, or ${otherName} for an interest item.`;
  }

  return undefined;
}

const fail = (message: string) => formatError(new Error(message));

export function registerConfirmationReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_unconfirmed_payouts",
    {
      description:
        "Lists the payouts in a portfolio that are waiting to be confirmed or rejected, with the company_event_id each one needs (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object(rangeInput),
    },
    async ({ portfolio_id, start_date, end_date }) => {
      try {
        const result = await client.listPortfolioPayoutsV2(portfolio_id, {
          start_date: start_date ?? EARLIEST,
          end_date: end_date ?? latestDefault(),
        });
        const payouts = ((result.payouts as Array<{ state?: string }> | undefined) ?? []).filter((payout) => payout.state === "unconfirmed");

        return formatResult({ unconfirmed_payouts: payouts, count: payouts.length });
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_unconfirmed_trades",
    {
      description:
        "Lists the trades in a portfolio that are waiting to be confirmed (v2 API). A dividend reinvestment trade is settled by confirming or rejecting its payout with confirm_payout or reject_payout, matched by company_event_id. This server cannot confirm or reject other trades.",
      annotations: READ_ONLY,
      inputSchema: z.object(rangeInput),
    },
    async ({ portfolio_id, start_date, end_date }) => {
      try {
        const result = await client.listPortfolioTradesV2(portfolio_id, {
          start_date: start_date ?? EARLIEST,
          end_date: end_date ?? latestDefault(),
        });
        const trades = ((result.trades as Array<{ state?: string }> | undefined) ?? []).filter((trade) => trade.state === "unconfirmed");

        return formatResult({ unconfirmed_trades: trades, count: trades.length });
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_rejected_trades",
    {
      description: "Lists the trades that were rejected for a holding (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        holding_id: holdingId,
        start_date: z.string().optional().describe("Start date YYYY-MM-DD"),
        end_date: z.string().optional().describe("End date YYYY-MM-DD"),
      }),
    },
    async ({ holding_id, ...options }) => {
      try {
        return formatResult(await client.listRejectedTradesV2(holding_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerConfirmationWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "confirm_payout",
    {
      description:
        "Confirms an unconfirmed payout, so it counts in the portfolio. Name it with company_event_id, or with paid_on for an interest payment. Pass reinvestment if the payout was reinvested (a DRP). (v2 API)",
      annotations: UPDATE,
      inputSchema: z.object({
        holding_id: holdingId,
        company_event_id: companyEventId,
        paid_on: z.string().optional().describe("The payment date YYYY-MM-DD, to name an interest payout instead of a company event"),
        reinvestment: z
          .object({
            quantity: z.number().describe("How many units were reinvested"),
            price: z.number().describe("The price per reinvested unit"),
          })
          .optional()
          .describe("Details of the reinvestment, when the payout was reinvested"),
      }),
    },
    async ({ holding_id, company_event_id, paid_on, reinvestment }) => {
      const problem = identify(company_event_id, paid_on, "paid_on");

      if (problem) {
        return fail(problem);
      }

      try {
        return formatResult(
          await client.setPayoutStateV2({
            holding_id,
            company_event_id,
            paid_on,
            state: "confirmed",
            ...(reinvestment && {
              drp_trade_attributes: {
                dividend_reinvested: true,
                quantity: reinvestment.quantity,
                price: reinvestment.price,
                source_adjustment_id: company_event_id,
              },
            }),
          })
        );
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "reject_payout",
    {
      description:
        "Rejects an unconfirmed payout, so it no longer appears in the portfolio. This is the 'Reject this Payout' button. Use delete_payout for a confirmed payout. (v2 API)",
      annotations: DELETE,
      inputSchema: z.object({
        holding_id: holdingId,
        company_event_id: z.number().describe("The company_event_id of the unconfirmed payout"),
      }),
    },
    async ({ holding_id, company_event_id }) => {
      try {
        return formatResult(await client.setPayoutStateV2({ holding_id, company_event_id, state: "rejected" }));
      } catch (error) {
        return formatError(error);
      }
    }
  );

}
