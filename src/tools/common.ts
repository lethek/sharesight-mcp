import { z } from "zod";
import { errorMessage } from "../error-message.js";

export function formatResult(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

/** An error reply for a problem the tool found itself, such as a bad combination of inputs */
export function formatFailure(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function formatError(error: unknown) {
  return formatFailure(errorMessage(error));
}

/** Input fields several tools share */
export const portfolioId = z.number().describe("The portfolio ID");
export const holdingId = z.number().describe("The holding ID");
export const consolidated = z.boolean().optional().describe("True if portfolio_id is a consolidated portfolio view");

/**
 * MCP tool annotations. Clients use them to tell tools apart, for example to ask before running one that changes data. Every tool
 * talks to Sharesight, so none of them sets openWorldHint (it defaults to true).
 */

/** Only reads data */
export const READ_ONLY = { readOnlyHint: true } as const;

/** Adds data. Repeating the call adds it again. */
export const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;

/** Changes data in place. Repeating the call with the same input leaves the same result. */
export const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;

/** Changes data in place, but can discard content that cannot be read back, such as a replaced or removed attachment */
export const OVERWRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true } as const;

/** Removes data */
export const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true } as const;
