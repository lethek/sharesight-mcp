import { PagedLister, type PagedListerOptions } from "./paged-list.js";

/** A payout or trade from the v2 lists, which hold confirmed and unconfirmed items together. Only the fields the lists use are named. */
export interface UnconfirmedItem {
  state?: string;
  paid_on?: string;
  transaction_date?: string;
  holding_id?: number;
  company_event_id?: number | null;
  quantity?: number;
  price?: number;
  currency?: string;
  exchange_rate?: number;
}

/** The lists have no filters or reply fields of their own: the query is the portfolio and the date range, which are part of the scope. */
type NoFilters = Record<string, never>;
type NoEnvelope = Record<string, never>;

export type UnconfirmedLister = PagedLister<UnconfirmedItem, NoEnvelope, NoFilters>;

export type UnconfirmedListerOptions = PagedListerOptions<UnconfirmedItem, NoEnvelope, NoFilters>;

const dateOf = (item: UnconfirmedItem): string => item.paid_on ?? item.transaction_date ?? "";

const compareUnconfirmed = (a: UnconfirmedItem, b: UnconfirmedItem): number => {
  const [x, y] = [dateOf(a), dateOf(b)];

  // Dates are YYYY-MM-DD, so plain string order is date order
  return (x < y ? -1 : x > y ? 1 : 0) || (a.holding_id ?? 0) - (b.holding_id ?? 0) || (a.company_event_id ?? 0) - (b.company_event_id ?? 0);
};

/**
 * Sharesight's v2 payout and trade lists have no state filter or paging, and hold the whole history. The lister keeps the
 * unconfirmed items only, oldest first, and caches that, so a walk reads the short list instead of fetching the history again.
 */
export function createUnconfirmedLister(options: UnconfirmedListerOptions): UnconfirmedLister {
  return new PagedLister(options, {
    matches: (item) => item.state === "unconfirmed",
    compare: compareUnconfirmed,
    isFilters: (value): value is NoFilters => typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0,
  });
}
