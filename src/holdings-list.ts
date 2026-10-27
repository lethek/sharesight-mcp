import type { Cache } from "./cache.js";
import type { CursorCodec } from "./cursor.js";
import { compareHoldings, matchesHolding, type HoldingFilters } from "./holdings-page.js";
import { PAGINATION_RESERVE_CHARS, PagedLister, pagedCursorCheck, type ListSnapshot, type PagedCursorState } from "./paged-list.js";
import type { Holding, HoldingsResponse } from "./types.js";

export { PAGINATION_RESERVE_CHARS };

/** Longest search text accepted. It is copied into every cursor, so an unbounded one could push a page over its size limit. */
export const MAX_SEARCH_LENGTH = 100;

export type CursorState = PagedCursorState<HoldingFilters>;

/** The rest of a holdings reply, once the holdings themselves are taken out */
type HoldingsEnvelope = Omit<HoldingsResponse, "holdings">;

export type HoldingsSnapshot = ListSnapshot<Holding, HoldingsEnvelope>;

function isHoldingFilters(value: unknown): value is HoldingFilters {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const f = value as Record<string, unknown>;

  return (
    (f.search === undefined || typeof f.search === "string") &&
    (f.market_code === undefined || typeof f.market_code === "string") &&
    (f.portfolio_id === undefined || typeof f.portfolio_id === "number") &&
    (f.valid_position === undefined || typeof f.valid_position === "boolean")
  );
}

/** True for a decoded cursor that has the shape this version writes. A signed cursor from another version may not. */
export const isCursorState = pagedCursorCheck(isHoldingFilters);

export interface HoldingsListArgs extends HoldingFilters {
  limit?: number;
  /** null counts as no cursor, because a caller may send back the next_cursor of a last page as it was given */
  cursor?: string | null;
}

export interface HoldingsListerOptions {
  /** Holds the matching holdings by snapshot id so later pages come from one snapshot. It may forget entries at any time. */
  cache: Cache<HoldingsSnapshot>;
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

/** Lists holdings a page at a time. See PagedLister for how snapshots, cursors and the cache work. */
export class HoldingsLister {
  private readonly lister: PagedLister<Holding, HoldingsEnvelope, HoldingFilters>;

  constructor(options: HoldingsListerOptions) {
    this.lister = new PagedLister(options, { matches: matchesHolding, compare: compareHoldings, isFilters: isHoldingFilters, given: givenFilters });
  }

  async list(scope: string, fetch: () => Promise<HoldingsResponse>, args: HoldingsListArgs): Promise<object> {
    const { cursor, limit, ...requested } = args;
    const { items, envelope, pagination } = await this.lister.list(
      scope,
      async () => {
        const { holdings, ...rest } = await fetch();

        return { items: holdings ?? [], envelope: rest };
      },
      requested,
      { cursor, limit }
    );

    return { ...envelope, holdings: items, pagination };
  }
}
