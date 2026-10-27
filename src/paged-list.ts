import { randomBytes } from "node:crypto";
import type { Cache } from "./cache.js";
import { CursorCodec, CursorError } from "./cursor.js";

/** Room kept in a response for the pagination block, which holds the cursor. Filters are copied into every cursor, so keep them short. */
export const PAGINATION_RESERVE_CHARS = 700;

/** Characters one item takes inside the response, which is printed with 2-space indentation and the array two levels deep. */
export function serializedSize(item: unknown): number {
  const text = JSON.stringify(item, null, 2);
  let lines = 1;

  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) {
    lines++;
  }

  return text.length + lines * 4 + 2;
}

export interface ItemPage<T> {
  items: T[];
  /** The offset of the first item on the next page, or null on the last page */
  nextOffset: number | null;
}

/**
 * Returns the next page of an already filtered and ordered list, filling the page until the character budget is used.
 *
 * Page sizes vary with how big each item is, so callers continue from `nextOffset` and never work out an offset themselves.
 * A page always holds at least one item, so one oversized item cannot stop a walk.
 */
export function pageItems<T>(items: T[], { offset = 0, limit = Infinity, budgetChars }: { offset?: number; limit?: number; budgetChars: number }): ItemPage<T> {
  const page: T[] = [];
  let used = 0;

  for (let i = offset; i < items.length && page.length < limit; i++) {
    const size = serializedSize(items[i]);

    if (page.length > 0 && used + size > budgetChars) {
      break;
    }

    page.push(items[i]);
    used += size;
  }

  const end = offset + page.length;

  return { items: page, nextOffset: end < items.length ? end : null };
}

export interface PagedCursorState<F extends object> {
  /** The query the cursor belongs to, so one tool's cursor cannot be used on another query */
  scope: string;
  /** Names the list this walk started from, so other first pages cannot change the data under it */
  snapshot: string;
  offset: number;
  filters: F;
  limit?: number;
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** Builds the check for a decoded cursor. A signed cursor from another version may have a different shape, so the filters are checked too. */
export function pagedCursorCheck<F extends object>(isFilters: (value: unknown) => value is F): (value: unknown) => value is PagedCursorState<F> {
  return (value: unknown): value is PagedCursorState<F> => {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const { scope, snapshot, offset, filters, limit } = value as Record<string, unknown>;

    return (
      typeof scope === "string" &&
      typeof snapshot === "string" &&
      isCount(offset) &&
      isFilters(filters) &&
      (limit === undefined || (isCount(limit) && limit > 0))
    );
  };
}

/** What the cache holds for a walk: the items that matched, in page order, and the rest of the Sharesight reply. A fetch returns the same shape, with every item. */
export interface ListSnapshot<T, E extends object> {
  items: T[];
  envelope: E;
}

/** What differs between lists: which items match the filters, and how they are ordered. */
export interface ListDefinition<T, F extends object> {
  /** Whether an item belongs in the list. It runs on the fetched list, before anything is cached or paged. */
  matches(item: T, filters: F): boolean;
  /** Orders the matching items, so page boundaries stay put. Without it they keep the order Sharesight gave. */
  compare?(a: T, b: T): number;
  isFilters(value: unknown): value is F;
}

/**
 * Drops filters that were not given, so the rest can be compared with the ones in a cursor. A blank string counts as not given,
 * because callers often fill unused text inputs with "" and it filters nothing. Filters are compared with !==, so they must be
 * strings, numbers or booleans.
 */
function givenFilters<F extends object>(requested: F): F {
  const isGiven = (value: unknown) => value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");

  return Object.fromEntries(Object.entries(requested).filter(([, value]) => isGiven(value))) as F;
}

export interface PagedListerOptions<T, E extends object, F extends object> {
  /** Holds the matching items by snapshot id so later pages come from one snapshot. It may forget entries at any time. */
  cache: Cache<ListSnapshot<T, E>>;
  cursors: CursorCodec<PagedCursorState<F>>;
  /** Most characters one response may take, whatever the client's own limit is */
  maxResponseChars: number;
}

export interface PagedResult<T, E extends object> {
  items: T[];
  envelope: E;
  pagination: {
    total: number;
    returned: number;
    has_more: boolean;
    next_cursor: string | null;
  };
}

export interface PageArgs {
  limit?: number;
  /** null counts as no cursor, because a caller may send back the next_cursor of a last page as it was given */
  cursor?: string | null;
}

/**
 * Lists a page at a time from a list that Sharesight returns whole. The first call fetches, keeps the items that match, and names
 * what it kept a snapshot id. The cursor it returns carries that id and the whole query, so later calls take the same items from
 * the cache while they are still there, and fetch and filter again when they are not. Walks that overlap each have their own
 * snapshot and cannot disturb each other. Only matching items are cached, so a list that is mostly filtered out costs little to keep.
 */
export class PagedLister<T, E extends object, F extends object> {
  private readonly isCursor: (value: unknown) => value is PagedCursorState<F>;

  constructor(
    private readonly options: PagedListerOptions<T, E, F>,
    private readonly definition: ListDefinition<T, F>
  ) {
    this.isCursor = pagedCursorCheck(definition.isFilters);
  }

  async list(scope: string, fetch: () => Promise<ListSnapshot<T, E>>, requested: F, { cursor, limit }: PageArgs): Promise<PagedResult<T, E>> {
    const { cache, cursors, maxResponseChars } = this.options;
    const { matches, compare } = this.definition;
    const filters = givenFilters(requested);
    let state: PagedCursorState<F> = { scope, snapshot: randomBytes(16).toString("base64url"), offset: 0, filters, limit };

    if (cursor) {
      const previous = cursors.decode(cursor, this.isCursor);

      if (previous.scope !== scope) {
        throw new CursorError("This cursor belongs to a different query.");
      }

      for (const [name, value] of Object.entries(filters)) {
        if ((previous.filters as Record<string, unknown>)[name] !== value) {
          throw new CursorError(`The cursor was issued for different filters (${name} differs); the cursor already carries them.`);
        }
      }

      state = { ...previous, limit: limit ?? previous.limit };
    }

    // A first page is always fresh. Later pages reuse the list their walk started from, and fetch a new one if the cache lost it.
    let snapshot = cursor ? cache.get(state.snapshot) : undefined;
    const fetched = snapshot === undefined;

    if (!snapshot) {
      const { items, envelope } = await fetch();
      const kept = items.filter((item) => matches(item, state.filters));

      snapshot = { items: compare ? kept.sort(compare) : kept, envelope };
    }

    const { items, envelope } = snapshot;
    const budgetChars = Math.max(0, maxResponseChars - JSON.stringify(envelope, null, 2).length - PAGINATION_RESERVE_CHARS);
    const page = pageItems(items, { offset: state.offset, limit: state.limit, budgetChars });

    // Only a walk with more pages ever looks the list up again
    if (fetched && page.nextOffset !== null) {
      cache.set(state.snapshot, snapshot);
    }

    return {
      items: page.items,
      envelope,
      pagination: {
        total: items.length,
        returned: page.items.length,
        has_more: page.nextOffset !== null,
        next_cursor: page.nextOffset === null ? null : cursors.encode({ ...state, offset: page.nextOffset }),
      },
    };
  }
}
