import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import type { UnconfirmedItem, UnconfirmedLister } from "../unconfirmed-list.js";
import { DELETE, PAGING_HELP, READ_ONLY, UPDATE, formatError, formatFailure, formatResult, holdingId, pagingInput, portfolioId } from "./common.js";

/**
 * Sharesight builds payouts and trades from company events (dividends, splits, mergers) and from maturing interest instruments, and
 * leaves them unconfirmed until the user accepts or rejects them. Only the v2 API lists and changes them.
 *
 * There is no tool to confirm or reject a trade. The documented v2 call (POST /trades.json with a state) creates a new confirmed trade
 * from the fields it is given instead, even with state "rejected", and the v3 equivalents are not available to API clients. A dividend
 * reinvestment (DRP) trade follows its payout, so confirming or rejecting the payout settles the trade too.
 */

const companyEventId = z.number().optional().describe("The company_event_id of the unconfirmed payout, as listed by list_unconfirmed_payouts");
const paidOnInput = z.string().optional().describe("The payment date YYYY-MM-DD, to name an interest payout, which has no company_event_id");

const EARLIEST = "2000-01-01";
/** Far enough ahead that no unconfirmed item falls after it */
const LATEST = "2100-12-31";

const rangeInput = {
  portfolio_id: portfolioId,
  start_date: z.string().optional().describe(`Start date YYYY-MM-DD (default ${EARLIEST}). A later date makes the call faster.`),
  end_date: z.string().optional().describe(`End date YYYY-MM-DD (default ${LATEST})`),
};

/** The payouts or trades in a v2 list reply */
const itemsOf = (reply: Record<string, unknown>, field: "payouts" | "trades"): UnconfirmedItem[] => (reply[field] as UnconfirmedItem[] | undefined) ?? [];

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

const CONFIRMING_HELP = `${PAGING_HELP} After confirming or rejecting items, start again from the first page.`;

export function registerConfirmationReadTools(server: McpServer, client: SharesightClient, unconfirmed: UnconfirmedLister) {
  /** Both lists work the same way: fetch the portfolio's whole v2 list, keep the unconfirmed items, and page them. */
  function registerUnconfirmedList(kind: "payouts" | "trades", description: string) {
    const name = `list_unconfirmed_${kind}`;

    server.registerTool(
      name,
      {
        description: `${description} ${CONFIRMING_HELP}`,
        annotations: READ_ONLY,
        inputSchema: z.object({ ...rangeInput, ...pagingInput }),
      },
      async ({ portfolio_id, start_date, end_date, limit, cursor }) => {
        try {
          const searched = { start_date: start_date ?? EARLIEST, end_date: end_date ?? LATEST };
          // The portfolio and dates are part of the scope, so a cursor only continues the query it came from
          const scope = `${name}:${portfolio_id}:${searched.start_date}:${searched.end_date}`;
          const fetch = async () => {
            const reply = kind === "payouts" ? await client.listPortfolioPayoutsV2(portfolio_id, searched) : await client.listPortfolioTradesV2(portfolio_id, searched);

            return { items: itemsOf(reply, kind), envelope: {} };
          };
          const { items, pagination } = await unconfirmed.list(scope, fetch, {}, { cursor, limit });

          return formatResult({ [`unconfirmed_${kind}`]: items, searched, pagination });
        } catch (error) {
          return formatError(error);
        }
      }
    );
  }

  registerUnconfirmedList(
    "payouts",
    "Lists the payouts in a portfolio that are waiting to be confirmed or rejected (v2 API). Dividend payouts have a company_event_id. Interest payouts have none and are named by paid_on."
  );

  registerUnconfirmedList(
    "trades",
    "Lists the trades in a portfolio that are waiting to be confirmed (v2 API). A dividend reinvestment trade is settled by confirming or rejecting its payout with confirm_payout or reject_payout, matched by company_event_id. This server cannot confirm or reject other trades."
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
        return formatFailure(problem);
      }

      if (reinvestment && skip_reinvestment) {
        return formatFailure("Give reinvestment or skip_reinvestment, not both.");
      }

      if (reinvestment && company_event_id === undefined) {
        return formatFailure("A reinvestment belongs to a dividend, so give company_event_id with it. An interest payout named by paid_on has none.");
      }

      try {
        if (company_event_id !== undefined && !reinvestment && !skip_reinvestment) {
          // Confirming a payout without a reinvestment removes the holding's pending reinvestment trade for it, so make the caller choose
          const trades = await client.listHoldingTradesV2(holding_id, { start_date: EARLIEST, end_date: LATEST });
          const pending = itemsOf(trades, "trades").find((trade) => trade.state === "unconfirmed" && trade.company_event_id === company_event_id);

          if (pending) {
            return formatFailure(
              `Holding ${holding_id} has a pending reinvestment trade for this payout (quantity ${pending.quantity} at price ${pending.price}). ` +
                "Confirming without a reinvestment would remove it. Pass reinvestment with its quantity and price to keep it, or skip_reinvestment: true to drop it."
            );
          }
        }

        // Without the currency, Sharesight stores the payout in the instrument's currency: a USD distribution on an ASX CDI becomes AUD
        const pending = await pendingPayout(client, holding_id, company_event_id, paid_on);

        return formatResult(
          await client.setPayoutStateV2({
            holding_id,
            company_event_id,
            paid_on,
            state: "confirmed",
            ...(pending?.currency && { currency_code: pending.currency, exchange_rate: pending.exchange_rate }),
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
        return formatFailure(problem);
      }

      try {
        // Sharesight answers a rejection by paid_on with a 500 even when it works, so the payout must be seen pending first for the check after it to mean anything
        if (paid_on !== undefined && !(await hasPendingPayout(client, holding_id, paid_on))) {
          return formatFailure(`Holding ${holding_id} has no unconfirmed payout paid on ${paid_on}.`);
        }
      } catch (error) {
        return formatError(error);
      }

      try {
        return formatResult(await client.setPayoutStateV2({ holding_id, company_event_id, paid_on, state: "rejected" }));
      } catch (error) {
        // A failed check counts as still pending, so the error is reported
        if (paid_on !== undefined && !(await hasPendingPayout(client, holding_id, paid_on).catch(() => true))) {
          return formatResult({
            rejected: true,
            note: "Sharesight reported an error, but no unconfirmed payout remains on that date, so it is rejected.",
          });
        }

        return formatError(error);
      }
    }
  );
}

/** The holding's unconfirmed payout for that company event, or on that date */
async function pendingPayout(client: SharesightClient, holdingId: number, companyEventId: number | undefined, paidOn: string | undefined): Promise<UnconfirmedItem | undefined> {
  const range = paidOn === undefined ? { start_date: EARLIEST, end_date: LATEST } : { start_date: paidOn, end_date: paidOn, use_date: "paid_on" };
  const payouts = await client.listHoldingPayoutsV2(holdingId, range);

  return itemsOf(payouts, "payouts").find(
    (payout) => payout.state === "unconfirmed" && (paidOn === undefined ? payout.company_event_id === companyEventId : payout.paid_on === paidOn)
  );
}

/** Whether the holding has an unconfirmed payout on that date */
async function hasPendingPayout(client: SharesightClient, holdingId: number, paidOn: string): Promise<boolean> {
  return (await pendingPayout(client, holdingId, undefined, paidOn)) !== undefined;
}
