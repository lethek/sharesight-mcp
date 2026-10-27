import { randomBytes } from "node:crypto";
import type { Cache } from "./cache.js";
import { CursorCodec, CursorError } from "./cursor.js";
import { pageHoldings, type HoldingFilters } from "./holdings-page.js";
import type { HoldingsResponse } from "./types.js";

/** Room kept in a response for the pagination block, which holds the cursor. See MAX_SEARCH_LENGTH for what keeps a cursor inside it. */
export const PAGINATION_RESERVE_CHARS = 700;

/** Longest search text accepted. It is copied into every cursor, so an unbounded one could push a page over its size limit. */
export const MAX_SEARCH_LENGTH = 100;

export interface CursorState {
  /** The query the cursor belongs to, so one tool's cursor cannot be used on another query */
  scope: string;
  /** Names the list this walk started from, so other first pages cannot change the data under it */
  snapshot: string;
  offset: number;
  filters: HoldingFilters;
  limit?: number;
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** True for a decoded cursor that has the shape this version writes. A signed cursor from another version may not. */
export function isCursorState(value: unknown): value is CursorState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const { scope, snapshot, offset, filters, limit } = value as Record<string, unknown>;
  const f = filters as Record<string, unknown> | null;

  return (
    typeof scope === "string" &&
    typeof snapshot === "string" &&
    isCount(offset) &&
    typeof f === "object" &&
    f !== null &&
    (f.search === undefined || typeof f.search === "string") &&
    (f.market_code === undefined || typeof f.market_code === "string") &&
    (f.portfolio_id === undefined || typeof f.portfolio_id === "number") &&
    (f.valid_position === undefined || typeof f.valid_position === "boolean") &&
    (limit === undefined || (isCount(limit) && limit > 0))
  );
}

export interface HoldingsListArgs extends HoldingFilters {
  limit?: number;
  /** null counts as no cursor, because a caller may send back the next_cursor of a last page as it was given */
  cursor?: string | null;
}

export interface HoldingsListerOptions {
  /** Holds full Sharesight lists by snapshot id so later pages come from one snapshot. It may forget entries at any time. */
  cache: Cache<HoldingsResponse>;
  cursors: CursorCodec<CursorState>;
  /** Most characters one response may take, whatever the client's own limit is */
  maxResponseChars: number;
}

/**
 * Drops filters that were not given, so the rest can be compared with the ones in a cursor. A blank string counts as not given,
 * because callers often fill unused text inputs with "" and it filters nothing.
 */
function givenFilters({ search, market_code, portfolio_id, valid_position }: HoldingFilters): HoldingFilters {
  const isGiven = (value: unknown) => value !== undefined && !(typeof value === "string" && value.trim() === "");

  return Object.fromEntries(Object.entries({ search, market_code, portfolio_id, valid_position }).filter(([, value]) => isGiven(value)));
}

/**
 * Lists holdings a page at a time. The first call fetches from Sharesight and names the list it got a snapshot id. The cursor it
 * returns carries that id and the whole query, so later calls take the same list from the cache while it is still there, and fetch
 * again when it is not. Walks that overlap each have their own snapshot and cannot disturb each other.
 */
export class HoldingsLister {
  constructor(private readonly options: HoldingsListerOptions) {}

  async list(scope: string, fetch: () => Promise<HoldingsResponse>, args: HoldingsListArgs): Promise<object> {
    const { cache, cursors, maxResponseChars } = this.options;
    const { cursor, limit, ...requested } = args;
    const filters = givenFilters(requested);
    let state: CursorState = { scope, snapshot: randomBytes(16).toString("base64url"), offset: 0, filters, limit };

    if (cursor) {
      const previous = cursors.decode(cursor, isCursorState);

      if (previous.scope !== scope) {
        throw new CursorError("This cursor belongs to a different query.");
      }

      for (const [name, value] of Object.entries(filters)) {
        if (previous.filters[name as keyof HoldingFilters] !== value) {
          throw new CursorError(`The cursor was issued for different filters (${name} differs); the cursor already carries them.`);
        }
      }

      state = { ...previous, limit: limit ?? previous.limit };
    }

    // A first page is always fresh. Later pages reuse the list their walk started from, and fetch a new one if the cache lost it.
    let response = cursor ? cache.get(state.snapshot) : undefined;
    const fetched = response === undefined;

    if (!response) {
      response = await fetch();
    }

    const { holdings, ...envelope } = response;
    const budgetChars = Math.max(0, maxResponseChars - JSON.stringify(envelope, null, 2).length - PAGINATION_RESERVE_CHARS);
    const page = pageHoldings(holdings ?? [], { filters: state.filters, offset: state.offset, limit: state.limit, budgetChars });

    // Only a walk with more pages ever looks the list up again
    if (fetched && page.nextOffset !== null) {
      cache.set(state.snapshot, response);
    }

    return {
      ...envelope,
      holdings: page.holdings,
      pagination: {
        total: page.total,
        returned: page.holdings.length,
        has_more: page.nextOffset !== null,
        next_cursor: page.nextOffset === null ? null : cursors.encode({ ...state, offset: page.nextOffset }),
      },
    };
  }
}
