import { PagedLister, type PageArgs, type PagedListerOptions, type PagedResult } from "./paged-list.js";

/** What Sharesight's reply holds besides the list, such as its links */
export type WholeEnvelope = Record<string, unknown>;

/** What Sharesight is asked for decides which items come back, so it is part of the scope and there is nothing left to filter. */
type NoFilters = Record<string, never>;

export type WholeLister = PagedLister<object, WholeEnvelope, NoFilters>;

export type WholeListerOptions = PagedListerOptions<object, WholeEnvelope, NoFilters>;

/**
 * Pages lists that Sharesight returns whole, such as trades, payouts or a cash account's transactions. Items keep the order they
 * were fetched in, so a fetch that wants another order sorts first. Each tool gives its own scope, so a cursor only fits its tool.
 */
export function createWholeLister(options: WholeListerOptions): WholeLister {
  return new PagedLister(options, {
    matches: () => true,
    isFilters: (value): value is NoFilters => typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0,
  });
}

/**
 * Fetches a reply once, takes its list from the field `key`, and returns one page of it in that same field, with the rest of the
 * reply and a pagination block beside it.
 */
export async function listWhole(
  lister: WholeLister,
  scope: string,
  key: string,
  fetch: () => Promise<object>,
  page: PageArgs,
  order?: (items: object[]) => object[]
): Promise<WholeEnvelope & { pagination: PagedResult<object, WholeEnvelope>["pagination"] }> {
  const { items, envelope, pagination } = await lister.list(
    scope,
    async () => {
      const { [key]: list, ...rest } = (await fetch()) as WholeEnvelope;
      const found = Array.isArray(list) ? (list as object[]) : [];

      return { items: order ? order(found) : found, envelope: rest };
    },
    {},
    page
  );

  return { ...envelope, [key]: items, pagination };
}
