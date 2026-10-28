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
 * Orders by a date field, then by id, so page boundaries stay put when the list is fetched again. Dates are ISO 8601, so plain
 * string order is date order.
 */
export const byDate =
  (field: string, direction: "asc" | "desc") =>
  (items: object[]): object[] => {
    const sign = direction === "asc" ? 1 : -1;
    const read = (item: object, name: string) => (item as Record<string, unknown>)[name];

    return items.sort(
      (a, b) => sign * (String(read(a, field) ?? "").localeCompare(String(read(b, field) ?? "")) || Number(read(a, "id") ?? 0) - Number(read(b, "id") ?? 0))
    );
  };

export interface WholeListQuery {
  /** The tool's name, which with `inputs` is the scope, so a cursor only continues the query it came from */
  tool: string;
  /** Every input that decides what Sharesight returns */
  inputs: object;
  /** The field of Sharesight's reply that holds the list */
  key: string;
  fetch: () => Promise<object>;
  /** Puts the fetched list in a fixed order, so page boundaries stay put */
  order: (items: object[]) => object[];
}

/**
 * Fetches a reply once, takes its list from the field `key`, and returns one page of it in that same field, with the rest of the
 * reply and a pagination block beside it. A reply without the list is an error, not an empty list.
 */
export async function listWhole(
  lister: WholeLister,
  { tool, inputs, key, fetch, order }: WholeListQuery,
  page: PageArgs
): Promise<WholeEnvelope & { pagination: PagedResult<object, WholeEnvelope>["pagination"] }> {
  const { items, envelope, pagination } = await lister.list(
    `${tool}:${JSON.stringify(inputs)}`,
    async () => {
      const { [key]: list, ...rest } = (await fetch()) as WholeEnvelope;

      if (!Array.isArray(list)) {
        throw new Error(`Sharesight's reply to ${tool} has no "${key}" list, so it cannot be paged.`);
      }

      return { items: order(list as object[]), envelope: rest };
    },
    {},
    page
  );
  // Sharesight's own pagination, if the reply has one, stays visible beside ours
  const { pagination: theirs, ...rest } = envelope;

  return { ...rest, ...(theirs !== undefined && { sharesight_pagination: theirs }), [key]: items, pagination };
}
