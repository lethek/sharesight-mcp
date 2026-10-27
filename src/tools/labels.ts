import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SharesightClient } from "../sharesight-client.js";
import { CREATE, DELETE, READ_ONLY, UPDATE, formatError, formatResult } from "./common.js";

const portfolioId = z.number().describe("The portfolio ID");
const consolidated = z.boolean().optional().describe("True if portfolio_id is a consolidated portfolio view");
const labelName = z.string().describe("The label name. Only letters, digits, spaces and underscores are allowed, so no hyphens.");
const holdingIds = z.array(z.number()).describe("The holding IDs to attach the label to");

export function registerLabelReadTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "list_labels",
    {
      description: "Lists the labels of a portfolio, with the holdings each one is attached to",
      annotations: READ_ONLY,
      inputSchema: z.object({ portfolio_id: portfolioId, consolidated }),
    },
    async ({ portfolio_id, consolidated }) => {
      try {
        return formatResult(await client.listLabels(portfolio_id, { consolidated }));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "get_label",
    {
      description: "Gets a portfolio label by name",
      annotations: READ_ONLY,
      inputSchema: z.object({ portfolio_id: portfolioId, label: labelName, consolidated }),
    },
    async ({ portfolio_id, label, consolidated }) => {
      try {
        return formatResult(await client.getLabel(portfolio_id, label, { consolidated }));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}

export function registerLabelWriteTools(server: McpServer, client: SharesightClient) {
  server.registerTool(
    "create_label",
    {
      description: "Creates a portfolio label and attaches it to holdings. Sharesight picks the colour.",
      annotations: CREATE,
      inputSchema: z.object({ portfolio_id: portfolioId, label: labelName, holding_ids: holdingIds, consolidated }),
    },
    async ({ portfolio_id, label, holding_ids, consolidated }) => {
      try {
        return formatResult(await client.createLabel(portfolio_id, { label, holding_ids }, { consolidated }));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "update_label",
    {
      description:
        "Attaches a label to more holdings, and creates the label if it does not exist. It cannot detach holdings: use delete_holding_label for that.",
      annotations: UPDATE,
      inputSchema: z.object({ portfolio_id: portfolioId, label: labelName, holding_ids: holdingIds, consolidated }),
    },
    async ({ portfolio_id, label, holding_ids, consolidated }) => {
      try {
        return formatResult(await client.updateLabel(portfolio_id, label, { label, holding_ids }, { consolidated }));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_label",
    {
      description: "Deletes a label from a portfolio and from every holding it is attached to",
      annotations: DELETE,
      inputSchema: z.object({ portfolio_id: portfolioId, label: labelName, consolidated }),
    },
    async ({ portfolio_id, label, consolidated }) => {
      try {
        return formatResult(await client.deleteLabel(portfolio_id, label, { consolidated }));
      } catch (error) {
        return formatError(error);
      }
    }
  );

  server.registerTool(
    "delete_holding_label",
    {
      description:
        "Detaches a label from one holding. There is no bulk version. Detaching the last holding removes the label itself.",
      annotations: DELETE,
      inputSchema: z.object({ holding_id: z.number().describe("The holding ID"), label: labelName }),
    },
    async ({ holding_id, label }) => {
      try {
        return formatResult(await client.deleteHoldingLabel(holding_id, label));
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
