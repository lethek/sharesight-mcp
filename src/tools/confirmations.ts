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
const companyEventId = z.number().optional().describe("The company_event_id of the unconfirmed payout, as listed by list_unconfirmed_payouts");
const paidOnInput = z.string().optional().describe("The payment date YYYY-MM-DD, to name an interest payout, which has no company_event_id");

const EARLIEST = "2000-01-01";
/** Far enough ahead that no unconfirmed item falls after it */
const LATEST = "2100-12-31";

const rangeInput = {
  portfolio_id: z.number().describe("The portfolio ID"),
  start_date: z.string().optional().describe(`Start date YYYY-MM-DD (default ${EARLIEST}). A later date makes the call faster.`),
  end_date: z.string().optional().describe(`End date YYYY-MM-DD (default ${LATEST})`),
};

type Item = { state?: string; company_event_id?: number | null; paid_on?: string; quantity?: number; price?: number };

/** Exactly one of company_event_id and paid_on must name the payout. */
function identify(companyEventId: number | undefined, paidOn: string | undefined): string | undefined {
  if (companyEventId !== undefined && paidOn !== undefined) {
    return "Give company_event_id or paid_on, not both.";
  }

  if (companyEventId === undefined && paidOn === undefined) {
    return "Give company_event_id, or paid_on for an interest payout.";
  }

  return undefined;
}

const fail = (message: string) => formatError(new Error(message));

export function registerConfirmationReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_unconfirmed_payouts",
    {
      description:
        "Lists the payouts in a portfolio that are waiting to be confirmed or rejected (v2 API). Dividend payouts have a company_event_id. Interest payouts have none and are named by paid_on.",
      annotations: READ_ONLY,
      inputSchema: z.object(rangeInput),
    },
    async ({ portfolio_id, start_date, end_date }) => {
      try {
        const searched = { start_date: start_date ?? EARLIEST, end_date: end_date ?? LATEST };
        const result = await client.listPortfolioPayoutsV2(portfolio_id, searched);
        const payouts = ((result.payouts as Item[] | undefined) ?? []).filter((payout) => payout.state === "unconfirmed");

        return formatResult({ unconfirmed_payouts: payouts, count: payouts.length, searched });
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
        const searched = { start_date: start_date ?? EARLIEST, end_date: end_date ?? LATEST };
        const result = await client.listPortfolioTradesV2(portfolio_id, searched);
        const trades = ((result.trades as Item[] | undefined) ?? []).filter((trade) => trade.state === "unconfirmed");

        return formatResult({ unconfirmed_trades: trades, count: trades.length, searched });
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
        "Confirms an unconfirmed payout, so it counts in the portfolio. Name it with company_event_id, or with paid_on for an interest payment. If the holding reinvests dividends, the payout has a pending reinvestment trade: pass reinvestment with its quantity and price to keep that trade, or skip_reinvestment to confirm the payout and drop the trade. Without one of them the call is refused. (v2 API)",
      annotations: UPDATE,
      inputSchema: z.object({
        holding_id: holdingId,
        company_event_id: companyEventId,
        paid_on: paidOnInput,
        reinvestment: z
          .object({
            quantity: z.number().describe("How many units were reinvested"),
            price: z.number().describe("The price per reinvested unit"),
          })
          .optional()
          .describe("Details of the reinvestment, when the payout was reinvested"),
        skip_reinvestment: z.boolean().optional().describe("True to confirm the payout without its pending reinvestment trade, which is then removed"),
      }),
    },
    async ({ holding_id, company_event_id, paid_on, reinvestment, skip_reinvestment }) => {
      const problem = identify(company_event_id, paid_on);

      if (problem) {
        return fail(problem);
      }

      if (reinvestment && skip_reinvestment) {
        return fail("Give reinvestment or skip_reinvestment, not both.");
      }

      try {
        if (company_event_id !== undefined && !reinvestment && !skip_reinvestment) {
          // Confirming a payout without a reinvestment removes the holding's pending reinvestment trade for it, so make the caller choose
          const trades = await client.listHoldingTradesV2(holding_id, { start_date: EARLIEST, end_date: LATEST });
          const pending = ((trades.trades as Item[] | undefined) ?? []).find((trade) => trade.state === "unconfirmed" && trade.company_event_id === company_event_id);

          if (pending) {
            return fail(
              `Holding ${holding_id} has a pending reinvestment trade for this payout (quantity ${pending.quantity} at price ${pending.price}). ` +
                "Confirming without a reinvestment would remove it. Pass reinvestment with its quantity and price to keep it, or skip_reinvestment: true to drop it."
            );
          }
        }

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
        "Rejects an unconfirmed payout, so it no longer appears in the portfolio. This is the 'Reject this Payout' button. Name it with company_event_id, or with paid_on for an interest payout. Use delete_payout for a confirmed payout. (v2 API)",
      annotations: DELETE,
      inputSchema: z.object({
        holding_id: holdingId,
        company_event_id: companyEventId,
        paid_on: paidOnInput,
      }),
    },
    async ({ holding_id, company_event_id, paid_on }) => {
      const problem = identify(company_event_id, paid_on);

      if (problem) {
        return fail(problem);
      }

      try {
        return formatResult(await client.setPayoutStateV2({ holding_id, company_event_id, paid_on, state: "rejected" }));
      } catch (error) {
        // Sharesight answers a rejection by paid_on with a 500 even though it rejects the payout, so look before reporting a failure
        if (paid_on === undefined) {
          return formatError(error);
        }

        try {
          const payouts = await client.listHoldingPayoutsV2(holding_id, { start_date: paid_on, end_date: paid_on });
          const stillPending = ((payouts.payouts as Item[] | undefined) ?? []).some((payout) => payout.state === "unconfirmed" && payout.paid_on === paid_on);

          if (!stillPending) {
            return formatResult({
              rejected: true,
              note: "Sharesight reported an error, but no unconfirmed payout remains on that date, so it is rejected.",
            });
          }
        } catch {
          // The check failed too, so report the original error
        }

        return formatError(error);
      }
    }
  );
}
