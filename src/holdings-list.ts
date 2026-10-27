import { compareHoldings, matchesHolding, type HoldingFilters } from "./holdings-page.js";
import { PagedLister, pagedCursorCheck, type ListSnapshot, type PagedCursorState, type PagedListerOptions } from "./paged-list.js";
import type { Holding, HoldingsResponse } from "./types.js";

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

export type HoldingsListerOptions = PagedListerOptions<Holding, HoldingsEnvelope, HoldingFilters>;

/** Lists holdings a page at a time. See PagedLister for how snapshots, cursors and the cache work. */
export class HoldingsLister {
  private readonly lister: PagedLister<Holding, HoldingsEnvelope, HoldingFilters>;

  constructor(options: HoldingsListerOptions) {
    this.lister = new PagedLister(options, { matches: matchesHolding, compare: compareHoldings, isFilters: isHoldingFilters });
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
