import { pageItems, serializedSize } from "./paged-list.js";
import type { Holding } from "./types.js";

export { serializedSize };

export interface HoldingFilters {
  /** Case-insensitive text that must appear in the instrument code or name */
  search?: string;
  /** Market code, for example ASX or NASDAQ (case-insensitive) */
  market_code?: string;
  portfolio_id?: number;
  valid_position?: boolean;
}

export interface HoldingPageOptions {
  filters?: HoldingFilters;
  /** How many matching holdings to skip */
  offset?: number;
  /** Most holdings to return, however much room is left */
  limit?: number;
  /** Characters the holdings may take in the serialized response */
  budgetChars: number;
}

export interface HoldingPage {
  holdings: Holding[];
  /** Holdings that matched the filters, before paging */
  total: number;
  /** The offset of the first holding on the next page, or null on the last page */
  nextOffset: number | null;
}

export function matchesHolding(holding: Holding, { search, market_code, portfolio_id, valid_position }: HoldingFilters): boolean {
  const text = search?.trim().toLowerCase();

  if (text && !holding.instrument.code.toLowerCase().includes(text) && !holding.instrument.name.toLowerCase().includes(text)) {
    return false;
  }

  if (market_code && holding.instrument.market_code.toUpperCase() !== market_code.trim().toUpperCase()) {
    return false;
  }

  if (portfolio_id !== undefined && holding.portfolio.id !== portfolio_id) {
    return false;
  }

  return valid_position === undefined || holding.valid_position === valid_position;
}

/** Orders holdings by id, so that page boundaries stay put. */
export const compareHoldings = (a: Holding, b: Holding): number => a.id - b.id;

/**
 * Filters holdings and returns the next page of them, filling the page until the character budget is used.
 *
 * The Sharesight API has no filter or paging parameters for holdings, so this runs on the full list, ordered by holding id.
 */
export function pageHoldings(holdings: Holding[], { filters = {}, offset = 0, limit = Infinity, budgetChars }: HoldingPageOptions): HoldingPage {
  const matched = holdings.filter((holding) => matchesHolding(holding, filters)).sort(compareHoldings);
  const page = pageItems(matched, { offset, limit, budgetChars });

  return { holdings: page.items, total: matched.length, nextOffset: page.nextOffset };
}
