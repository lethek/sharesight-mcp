import type { Holding } from "./types.js";

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

function matches(holding: Holding, { search, market_code, portfolio_id, valid_position }: HoldingFilters): boolean {
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

/** Characters one holding takes inside the response, which is printed with 2-space indentation and the array two levels deep. */
export function serializedSize(holding: Holding): number {
  const text = JSON.stringify(holding, null, 2);
  const lines = text.split("\n").length;

  return text.length + lines * 4 + 2;
}

/**
 * Filters holdings and returns the next page of them, filling the page until the character budget is used.
 *
 * Page sizes vary with how big each holding is, so callers continue from `nextOffset` and never work out an offset themselves.
 * A page always holds at least one holding, so one oversized holding cannot stop a walk. The Sharesight API has no filter or
 * paging parameters for holdings, so this runs on the full list, ordered by holding id so that page boundaries stay put.
 */
export function pageHoldings(holdings: Holding[], { filters = {}, offset = 0, limit = Infinity, budgetChars }: HoldingPageOptions): HoldingPage {
  const matched = holdings.filter((holding) => matches(holding, filters)).sort((a, b) => a.id - b.id);
  const page: Holding[] = [];
  let used = 0;

  for (let i = offset; i < matched.length && page.length < limit; i++) {
    const size = serializedSize(matched[i]);

    if (page.length > 0 && used + size > budgetChars) {
      break;
    }

    page.push(matched[i]);
    used += size;
  }

  const end = offset + page.length;

  return { holdings: page, total: matched.length, nextOffset: end < matched.length ? end : null };
}
