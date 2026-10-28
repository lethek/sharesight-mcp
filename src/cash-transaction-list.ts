import { PagedLister, type PagedListerOptions } from "./paged-list.js";

/** A cash account transaction. Only the fields the list orders on are named; the rest pass through. */
export interface CashTransaction {
  id?: number;
  date_time?: string;
}

/** What Sharesight's reply holds besides the transactions, such as its links */
export type CashTransactionEnvelope = Record<string, unknown>;

/** The date range and search text decide what Sharesight returns, so they are part of the scope and there is nothing left to filter. */
type NoFilters = Record<string, never>;

export type CashTransactionLister = PagedLister<CashTransaction, CashTransactionEnvelope, NoFilters>;

export type CashTransactionListerOptions = PagedListerOptions<CashTransaction, CashTransactionEnvelope, NoFilters>;

/**
 * Sharesight returns every transaction of a cash account in one reply, with no paging. The lister fetches that once, orders it newest
 * first, and serves the pages from the cache, so a long history does not arrive in one response.
 */
export function createCashTransactionLister(options: CashTransactionListerOptions): CashTransactionLister {
  return new PagedLister(options, {
    matches: () => true,
    // Dates are ISO 8601, so plain string order is date order. The id keeps transactions at the same moment in a fixed order.
    compare: (a, b) => (b.date_time ?? "").localeCompare(a.date_time ?? "") || (b.id ?? 0) - (a.id ?? 0),
    isFilters: (value): value is NoFilters => typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0,
  });
}
