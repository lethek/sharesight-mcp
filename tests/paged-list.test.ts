import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache, type Cache } from "../src/cache.js";
import { CursorCodec } from "../src/cursor.js";
import { PagedLister, pageItems, serializedSize, type ListSnapshot, type PagedCursorState } from "../src/paged-list.js";

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

describe("pageItems", () => {
  test("fills the budget and says where the next page starts", () => {
    const items = rows(10);
    const two = serializedSize(items[0]) + serializedSize(items[1]);
    const page = pageItems(items, { budgetChars: two });

    assert.deepEqual(page.items.map((r) => r.id), [1, 2]);
    assert.equal(page.nextOffset, 2);
  });

  test("a page always holds one item, and limit and offset apply", () => {
    assert.equal(pageItems(rows(3), { budgetChars: 1 }).items.length, 1);
    assert.deepEqual(pageItems(rows(5), { budgetChars: 1e6, limit: 2, offset: 3 }).items.map((r) => r.id), [4, 5]);
    assert.equal(pageItems(rows(5), { budgetChars: 1e6, offset: 5 }).nextOffset, null);
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
    const seen: number[] = [];
    let page = await subject.list("q", fetch, { kind: "b" }, {});

    for (;;) {
      seen.push(...page.items.map((r) => r.id));

      if (!page.pagination.has_more) {
        break;
      }

      page = await subject.list("q", fetch, {}, { cursor: page.pagination.next_cursor });
    }

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
