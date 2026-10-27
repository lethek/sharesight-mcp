import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache, type Cache } from "../src/cache.js";
import { CursorCodec } from "../src/cursor.js";
import { walkPages } from "./pages.js";
import { PagedLister, pageItems, serializedSize, type ItemPage, type ListSnapshot, type PagedCursorState } from "../src/paged-list.js";

interface Row {
  id: number;
  kind: "a" | "b";
}

interface Filters {
  kind?: "a" | "b";
}

type Snapshot = ListSnapshot<Row, { marker: number }>;

const rows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: i + 1, kind: i % 2 === 0 ? "a" : "b" }));
const fetchOf = (items: Row[], marker = 0) => async () => ({ items, envelope: { marker } });

const isFilters = (value: unknown): value is Filters => typeof value === "object" && value !== null;

/** Counts what the matches predicate is asked, so a test can see it runs on the fetched list and not on every page. */
function lister(cache: Cache<Snapshot>, maxResponseChars = 5_000, matched: number[] = []) {
  return new PagedLister<Row, { marker: number }, Filters>(
    { cache, cursors: new CursorCodec<PagedCursorState<Filters>>("secret"), maxResponseChars },
    {
      matches: (row, filters) => {
        matched.push(row.id);

        return filters.kind === undefined || row.kind === filters.kind;
      },
      compare: (a, b) => b.id - a.id,
      isFilters,
    }
  );
}

class SpyCache implements Cache<Snapshot> {
  readonly stored: Snapshot[] = [];

  constructor(private readonly inner: Cache<Snapshot>) {}

  get(key: string) {
    return this.inner.get(key);
  }

  set(key: string, value: Snapshot) {
    this.stored.push(value);
    this.inner.set(key, value);
  }
}

const BIG = 1_000_000;
const ids = (page: { items: Row[] }) => page.items.map((r) => r.id);

describe("pageItems", () => {
  const items = rows(5);
  const size = serializedSize(items[0]);

  test("a page holds as many items as fit in the budget", () => {
    const page = pageItems(items, { budgetChars: size * 3 });

    assert.deepEqual(ids(page), [1, 2, 3]);
    assert.equal(page.nextOffset, 3);
  });

  test("one character less leaves the last one for the next page", () => {
    assert.deepEqual(ids(pageItems(items, { budgetChars: size * 3 - 1 })), [1, 2]);
  });

  test("bigger items mean fewer per page", () => {
    const wide = items.map((r) => ({ ...r, text: "x".repeat(2000) }));

    assert.ok(pageItems(wide, { budgetChars: 5000 }).items.length < pageItems(items, { budgetChars: 5000 }).items.length);
  });

  test("a page always holds at least one item, even if it is over budget", () => {
    const page = pageItems(items, { budgetChars: 1 });

    assert.deepEqual(ids(page), [1]);
    assert.equal(page.nextOffset, 1);
  });

  test("limit caps the count even when there is room", () => {
    const page = pageItems(items, { budgetChars: BIG, limit: 2 });

    assert.deepEqual(ids(page), [1, 2]);
    assert.equal(page.nextOffset, 2);
  });

  test("the size is what an item adds to the printed response", () => {
    const printed = (list: Row[]) => JSON.stringify({ rows: list }, null, 2).length;

    assert.equal(printed([items[0], items[1]]) - printed([items[0]]), serializedSize(items[1]));
  });

  test("walking nextOffset visits every item once", () => {
    const seen: number[] = [];

    for (let offset: number | null = 0; offset !== null; ) {
      const page: ItemPage<Row> = pageItems(items, { budgetChars: size * 2, offset });
      seen.push(...ids(page));
      offset = page.nextOffset;
    }

    assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  });

  test("a page that ends exactly at the total has no next page", () => {
    assert.equal(pageItems(items, { budgetChars: BIG, limit: 5 }).nextOffset, null);
    assert.equal(pageItems(items, { budgetChars: BIG, limit: 4 }).nextOffset, 4);
  });

  test("the last page and an offset past the end have no next page", () => {
    assert.deepEqual(ids(pageItems(items, { budgetChars: BIG, offset: 4 })), [5]);
    assert.deepEqual(pageItems(items, { budgetChars: BIG, offset: 99 }), { items: [], nextOffset: null });
  });
});

describe("PagedLister", () => {
  test("the predicate runs on the fetched list once, and only the matching items are cached", async () => {
    const cache = new SpyCache(new MemoryCache(60_000, 20));
    const matched: number[] = [];
    const subject = lister(cache, 800, matched);
    const first = await subject.list("q", fetchOf(rows(40)), { kind: "a" }, {});

    assert.equal(first.pagination.total, 20);
    assert.equal(first.pagination.has_more, true);
    assert.equal(matched.length, 40, "each fetched item is tested once");
    assert.equal(cache.stored.length, 1);
    assert.equal(cache.stored[0].items.length, 20, "the cache holds the matching items, not the whole list");
    assert.ok(cache.stored[0].items.every((r) => r.kind === "a"));

    await subject.list("q", fetchOf(rows(40)), { kind: "a" }, { cursor: first.pagination.next_cursor });

    assert.equal(matched.length, 40, "a later page does not test them again");
  });

  test("items are ordered by the definition, whatever order they were fetched in", async () => {
    const result = await lister(new MemoryCache(60_000, 20)).list("q", fetchOf(rows(5)), {}, {});

    assert.deepEqual(result.items.map((r) => r.id), [5, 4, 3, 2, 1]);
  });

  test("a walk covers every matching item exactly once from one fetch", async () => {
    let fetches = 0;
    const fetch = async () => ({ items: rows(60), envelope: { marker: ++fetches } });
    const subject = lister(new MemoryCache(60_000, 20), 800);
    const pages = await walkPages(await subject.list("q", fetch, { kind: "b" }, {}), (cursor) => subject.list("q", fetch, {}, { cursor }));
    const seen = pages.flatMap((page) => page.items.map((r) => r.id));

    assert.equal(fetches, 1);
    assert.equal(seen.length, 30);
    assert.equal(new Set(seen).size, 30);
    assert.ok(seen.every((id) => id % 2 === 0));
  });

  test("when the cache has lost the list the walk fetches and filters again with the filters the cursor carries", async () => {
    let fetches = 0;
    const fetch = async () => ({ items: rows(60), envelope: { marker: ++fetches } });
    const subject = lister(new MemoryCache(0), 800);
    const first = await subject.list("q", fetch, { kind: "b" }, {});
    const second = await subject.list("q", fetch, {}, { cursor: first.pagination.next_cursor });

    assert.equal(fetches, 2);
    assert.ok(second.items.every((r) => r.kind === "b"));
    assert.equal(second.items[0].id, first.items.at(-1)!.id - 2, "continues from the offset, in the same order");
  });

  test("a cursor belongs to its scope and its filters", async () => {
    const subject = lister(new MemoryCache(60_000, 20), 800);
    const first = await subject.list("q", fetchOf(rows(60)), { kind: "a" }, {});
    const cursor = first.pagination.next_cursor;

    await assert.rejects(subject.list("other", fetchOf(rows(60)), {}, { cursor }), /different query/);
    await assert.rejects(subject.list("q", fetchOf(rows(60)), { kind: "b" }, { cursor }), /different filters \(kind differs\)/);
  });

  test("the envelope comes back with the page and counts against the size budget", async () => {
    const result = await lister(new MemoryCache(60_000, 20)).list("q", fetchOf(rows(3), 7), {}, {});

    assert.deepEqual(result.envelope, { marker: 7 });
  });
});
