import type { Cache } from "./cache.js";
import type { CursorCodec } from "./cursor.js";
import { PagedLister, type ListSnapshot, type PagedCursorState } from "./paged-list.js";

/** A payout or trade from the v2 lists, which hold confirmed and unconfirmed items together. Only the fields the lists use are named. */
export interface UnconfirmedItem {
  state?: string;
  paid_on?: string;
  transaction_date?: string;
  holding_id?: number;
  company_event_id?: number | null;
  quantity?: number;
  price?: number;
}

/** The lists have no filters of their own: the query is the portfolio and the date range, which are part of the scope. */
export type NoFilters = Record<string, never>;

export type UnconfirmedEnvelope = Record<string, never>;

export type UnconfirmedSnapshot = ListSnapshot<UnconfirmedItem, UnconfirmedEnvelope>;

export type UnconfirmedLister = PagedLister<UnconfirmedItem, UnconfirmedEnvelope, NoFilters>;

export interface UnconfirmedListerOptions {
  cache: Cache<UnconfirmedSnapshot>;
  cursors: CursorCodec<PagedCursorState<NoFilters>>;
  maxResponseChars: number;
}

const isNoFilters = (value: unknown): value is NoFilters => typeof value === "object" && value !== null;

const dateOf = (item: UnconfirmedItem): string => item.paid_on ?? item.transaction_date ?? "";

/**
 * Sharesight's v2 payout and trade lists have no state filter or paging, and hold the whole history. The lister keeps the
 * unconfirmed items only, oldest first, and caches that, so a walk reads the short list instead of fetching the history again.
 */
export function createUnconfirmedLister(options: UnconfirmedListerOptions): UnconfirmedLister {
  return new PagedLister(options, {
    matches: (item) => item.state === "unconfirmed",
    compare: (a, b) => dateOf(a).localeCompare(dateOf(b)) || (a.holding_id ?? 0) - (b.holding_id ?? 0) || (a.company_event_id ?? 0) - (b.company_event_id ?? 0),
    isFilters: isNoFilters,
  });
}
