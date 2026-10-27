import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache, type Cache } from "../src/cache.js";
import { CursorCodec } from "../src/cursor.js";
import { HoldingsLister, MAX_SEARCH_LENGTH, PAGINATION_RESERVE_CHARS, isCursorState, type CursorState } from "../src/holdings-list.js";
import type { Holding, HoldingsResponse } from "../src/types.js";

function holding(id: number): Holding {
  return {
    id,
    symbol: `C${id}`,
    valid_position: true,
    instrument: { code: `C${id}`, name: `Company ${id}`, market_code: "ASX" },
    portfolio: { id: 1, name: "Portfolio" },
  } as unknown as Holding;
}

const response = (ids: number[], marker = 0): HoldingsResponse => ({ holdings: ids.map(holding), api_transaction: { id: marker } }) as unknown as HoldingsResponse;

// About 400 characters each, so a 6000 character limit gives pages of roughly a dozen
const IDS = Array.from({ length: 100 }, (_, i) => i + 1);
const MAX_CHARS = 6_000;

/** Wraps a cache so a test can see what was stored and looked up. */
class SpyCache implements Cache<HoldingsResponse> {
  readonly sets: string[] = [];
  readonly gets: string[] = [];

  constructor(private readonly inner: Cache<HoldingsResponse>) {}

  get(key: string) {
    this.gets.push(key);

    return this.inner.get(key);
  }

  set(key: string, value: HoldingsResponse) {
    this.sets.push(key);
    this.inner.set(key, value);
  }
}

function lister(cache: Cache<HoldingsResponse> = new MemoryCache(60_000, 20)) {
  return new HoldingsLister({ cache, cursors: new CursorCodec<CursorState>("secret"), maxResponseChars: MAX_CHARS });
}

const next = (page: any): string => page.pagination.next_cursor;

describe("HoldingsLister snapshots", () => {
  test("a result that fits one page is not cached, because nothing would look it up", async () => {
    const cache = new SpyCache(new MemoryCache(60_000, 20));
    const page: any = await lister(cache).list("q", async () => response([1, 2, 3]), {});

    assert.equal(page.pagination.has_more, false);
    assert.deepEqual(cache.sets, []);
  });

  test("a result with more pages is cached once, under a snapshot id carried in the cursor", async () => {
    const cache = new SpyCache(new MemoryCache(60_000, 20));
    const page: any = await lister(cache).list("q", async () => response(IDS), {});

    assert.equal(page.pagination.has_more, true);
    assert.equal(cache.sets.length, 1);
    assert.match(cache.sets[0], /^[A-Za-z0-9_-]{22}$/);
  });

  test("later pages read the list their walk started from, and do not fetch again", async () => {
    let fetches = 0;
    const fetch = async () => response(IDS, ++fetches);
    const subject = lister();

    const first: any = await subject.list("q", fetch, {});
    const second: any = await subject.list("q", fetch, { cursor: next(first) });

    assert.equal(fetches, 1);
    assert.equal(second.api_transaction.id, 1);
  });

  test("two walks over the same query keep separate lists", async () => {
    let fetches = 0;
    const fetch = async () => response(IDS, ++fetches);
    const subject = lister();

    const walkA: any = await subject.list("q", fetch, {});
    const walkB: any = await subject.list("q", fetch, {});
    const nextA: any = await subject.list("q", fetch, { cursor: next(walkA) });
    const nextB: any = await subject.list("q", fetch, { cursor: next(walkB) });

    assert.deepEqual([walkA, walkB, nextA, nextB].map((p) => p.api_transaction.id), [1, 2, 1, 2]);
    assert.equal(fetches, 2);
  });

  test("when the cache has lost the list the walk fetches again and carries on from its offset", async () => {
    let fetches = 0;
    const fetch = async () => response(IDS, ++fetches);
    const subject = lister(new MemoryCache(0));

    const first: any = await subject.list("q", fetch, {});
    const second: any = await subject.list("q", fetch, { cursor: next(first) });

    assert.equal(fetches, 2);
    assert.equal(second.holdings[0].id, first.holdings.length + 1);
  });

  test("a walk that continues after a cache miss stores the list it fetched for the pages after it", async () => {
    const cache = new SpyCache(new MemoryCache(60_000, 20));
    const subject = lister(cache);
    const fetch = async () => response(IDS);

    const first: any = await subject.list("q", fetch, {});
    const cursor = next(first);
    const snapshot = cache.sets[0];
    (cache as any).inner = new MemoryCache(60_000, 20); // the cache forgets everything

    await subject.list("q", fetch, { cursor });

    assert.deepEqual(cache.sets, [snapshot, snapshot], "stored again under the same id");
  });
});

describe("HoldingsLister filters next to a cursor", () => {
  const fetch = async () => response(IDS);

  test("blank text filters count as not given", async () => {
    const subject = lister();
    const first: any = await subject.list("q", fetch, { search: "", market_code: "  " });
    const second: any = await subject.list("q", fetch, { cursor: next(first), search: "", market_code: "   " });

    assert.equal(first.pagination.total, 100, "a blank filter filters nothing");
    assert.equal(second.holdings[0].id, first.holdings.length + 1);
  });

  test("a blank filter next to a cursor from a first page without that filter is accepted", async () => {
    const subject = lister();
    const first: any = await subject.list("q", fetch, {});

    await assert.doesNotReject(subject.list("q", fetch, { cursor: next(first), search: "" }));
  });

  test("a filter with a value that differs from the cursor's is still refused", async () => {
    const subject = lister();
    const first: any = await subject.list("q", fetch, { market_code: "ASX" });

    await assert.rejects(subject.list("q", fetch, { cursor: next(first), market_code: "NASDAQ" }), /different filters/);
    await assert.rejects(subject.list("q", fetch, { cursor: next(first), search: "x" }), /different filters/);
  });
});

describe("HoldingsLister cursors", () => {
  test("a cursor is kept inside the room reserved for it, even with the longest search and every filter", async () => {
    const subject = lister();
    const search = "x".repeat(MAX_SEARCH_LENGTH);
    const filters = { search, market_code: "ASX", portfolio_id: 1, valid_position: true, limit: 5 };
    // Names that contain the longest search, so the filters match and there is a next page to write a cursor for
    const named = { holdings: IDS.map((id) => ({ ...holding(id), instrument: { code: `C${id}`, name: `${search}${id}`, market_code: "ASX" } })) } as unknown as HoldingsResponse;
    const page: any = await subject.list("list_portfolio_holdings:123456789:false", async () => named, filters);

    assert.equal(page.pagination.has_more, true);
    assert.ok(next(page).length < PAGINATION_RESERVE_CHARS, `${next(page).length} characters`);
  });
});

describe("isCursorState", () => {
  const valid: CursorState = { scope: "q", snapshot: "abc", offset: 0, filters: {}, limit: undefined };

  test("accepts a complete state", () => {
    assert.equal(isCursorState(valid), true);
    assert.equal(isCursorState({ ...valid, offset: 12, limit: 5, filters: { search: "a", market_code: "ASX", portfolio_id: 1, valid_position: false } }), true);
  });

  test("rejects states with missing or wrongly typed fields", () => {
    const bad: unknown[] = [
      null,
      "text",
      {},
      { ...valid, scope: undefined },
      { ...valid, snapshot: 1 },
      { ...valid, offset: -1 },
      { ...valid, offset: 1.5 },
      { ...valid, filters: undefined },
      { ...valid, filters: null },
      { ...valid, filters: { search: 1 } },
      { ...valid, filters: { valid_position: "yes" } },
      { ...valid, limit: 0 },
    ];

    for (const state of bad) {
      assert.equal(isCursorState(state), false, JSON.stringify(state));
    }
  });
});
