import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { listWhole, type WholeLister } from "../whole-list.js";
import { CREATE, DELETE, PAGING_HELP, READ_ONLY, UPDATE, formatError, formatResult, pagingInput, portfolioId } from "./common.js";

interface CashTransaction {
  id?: number;
  date_time?: string;
}

/** Dates are ISO 8601, so plain string order is date order. The id keeps transactions at the same moment in a fixed order. */
const newestFirst = (items: object[]) =>
  (items as CashTransaction[]).sort((a, b) => (b.date_time ?? "").localeCompare(a.date_time ?? "") || (b.id ?? 0) - (a.id ?? 0));

const cashAccountId = z.number().describe("The cash account ID");
const transactionId = z.number().describe("The cash account transaction ID");

const cashAccountFields = {
  name: z.string().describe("The cash account's name"),
  currency: z.string().describe("ISO code of the cash account's currency, for example AUD"),
};

/** Sharesight replaces a transaction as a whole on update, so create and update take the same fields. */
const transactionFields = {
  description: z.string().describe("The transaction description"),
  amount: z.number().describe("The transaction amount"),
  type_name: z.string().describe('The transaction type. Any text is accepted, for example "OPENING BALANCE", "DEPOSIT", "WITHDRAWAL", "INTEREST_PAYMENT", "FEE" or "FEE_REIMBURSEMENT".'),
  date_time: z.string().describe("The transaction date and time YYYY-MM-DDThh:mm:ss (ISO 8601)"),
  foreign_identifier: z.string().optional().describe("Your own identifier for the transaction, which list_cash_account_transactions can search on"),
};

/** Cash accounts hold money in a portfolio apart from its holdings. All of their endpoints are in the v2 API. */
export function registerCashAccountReadTools(server: McpServer, client: SharesightClient, lists: WholeLister) {
  server.registerTool(
    "list_cash_accounts",
    {
      description: "Lists the cash accounts of a portfolio, or of every portfolio when none is given, with their balances (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        portfolio_id: portfolioId.optional().describe("Only the cash accounts of this portfolio"),
        date: z.string().optional().describe("Show balances on this date YYYY-MM-DD (default today)"),
      }),
    },
    async ({ portfolio_id, ...options }) => {
      try {
        return formatResult(await client.listCashAccounts(portfolio_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_cash_account",
    {
      description: "Gets a cash account with its balance on a date (v2 API)",
      annotations: READ_ONLY,
      inputSchema: z.object({
        cash_account_id: cashAccountId,
        date: z.string().optional().describe("Show the balance on this date YYYY-MM-DD (default today)"),
      }),
    },
    async ({ cash_account_id, ...options }) => {
      try {
        return formatResult(await client.getCashAccount(cash_account_id, options));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "list_cash_account_transactions",
    {
      description: `Lists the transactions of a cash account, newest first, with the running balance after each (v2 API). ${PAGING_HELP}`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        cash_account_id: cashAccountId,
        from: z.string().optional().describe("Transactions from this date YYYY-MM-DD"),
        to: z.string().optional().describe("Transactions until this date YYYY-MM-DD"),
        description: z.string().optional().describe("Only transactions with this description"),
        foreign_identifier: z.string().optional().describe("Only the transaction with this foreign identifier"),
        ...pagingInput,
      }),
    },
    async ({ cash_account_id, limit, cursor, ...options }) => {
      try {
        // What the query asks Sharesight for is part of the scope, so a cursor only continues the query it came from
        const scope = `list_cash_account_transactions:${cash_account_id}:${JSON.stringify(options)}`;

        return formatResult(
          await listWhole(lists, scope, "cash_account_transactions", () => client.listCashAccountTransactions(cash_account_id, options), { cursor, limit }, newestFirst)
        );
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerCashAccountWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "create_cash_account",
    {
      description: "Creates a cash account in a portfolio (v2 API)",
      annotations: CREATE,
      inputSchema: z.object({ portfolio_id: portfolioId, ...cashAccountFields }),
    },
    async ({ portfolio_id, ...account }) => {
      try {
        return formatResult(await client.createCashAccount(portfolio_id, account));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_cash_account",
    {
      description: "Renames a cash account or changes its currency. Sharesight needs both fields (v2 API)",
      annotations: UPDATE,
      inputSchema: z.object({ cash_account_id: cashAccountId, ...cashAccountFields }),
    },
    async ({ cash_account_id, ...account }) => {
      try {
        return formatResult(await client.updateCashAccount(cash_account_id, account));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_cash_account",
    {
      description: "Deletes a cash account and its transactions (v2 API)",
      annotations: DELETE,
      inputSchema: z.object({ cash_account_id: cashAccountId }),
    },
    async ({ cash_account_id }) => {
      try {
        return formatResult(await client.deleteCashAccount(cash_account_id));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "create_cash_account_transaction",
    {
      description: "Adds a transaction to a cash account. A positive amount adds money and a negative one takes it out (v2 API)",
      annotations: CREATE,
      inputSchema: z.object({ cash_account_id: cashAccountId, ...transactionFields }),
    },
    async ({ cash_account_id, ...transaction }) => {
      try {
        return formatResult(await client.createCashAccountTransaction(cash_account_id, transaction));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_cash_account_transaction",
    {
      description: "Changes a cash account transaction. Sharesight needs every field except foreign_identifier, so send the ones that stay the same too (v2 API)",
      annotations: UPDATE,
      inputSchema: z.object({ transaction_id: transactionId, ...transactionFields }),
    },
    async ({ transaction_id, ...transaction }) => {
      try {
        return formatResult(await client.updateCashAccountTransaction(transaction_id, transaction));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_cash_account_transaction",
    {
      description: "Deletes a cash account transaction (v2 API)",
      annotations: DELETE,
      inputSchema: z.object({ transaction_id: transactionId }),
    },
    async ({ transaction_id }) => {
      try {
        return formatResult(await client.deleteCashAccountTransaction(transaction_id));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
