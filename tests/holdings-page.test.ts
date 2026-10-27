import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pageHoldings, serializedSize } from "../src/holdings-page.js";
import type { Holding } from "../src/types.js";

function holding(id: number, code: string, name: string, market: string, portfolioId: number, validPosition = true): Holding {
  return {
    id,
    symbol: code,
    valid_position: validPosition,
    instrument: { code, name, market_code: market },
    portfolio: { id: portfolioId, name: `Portfolio ${portfolioId}` },
  } as unknown as Holding;
}

// Deliberately out of id order
const holdings = [
  holding(30, "NVDA", "NVIDIA Corp", "NASDAQ", 1),
  holding(10, "BHP", "Bhp Group Limited", "ASX", 1),
  holding(20, "CBA", "Commonwealth Bank.", "ASX", 2),
  holding(40, "OLD", "Sold Out Ltd", "ASX", 2, false),
  holding(50, "MSFT", "Microsoft Corporation", "NASDAQ", 2),
];

const BIG = 1_000_000;
const ids = (page: { holdings: Holding[] }) => page.holdings.map((h) => h.id);

describe("pageHoldings filters", () => {
  test("returns everything, ordered by id, when no options are given", () => {
    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG })), [10, 20, 30, 40, 50]);
  });

  test("search matches the code or the name, ignoring case", () => {
    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG, filters: { search: "bhp" } })), [10]);
    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG, filters: { search: "COMMONWEALTH" } })), [20]);
    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG, filters: { search: "corp" } })), [30, 50]);
  });

  test("a blank search is ignored", () => {
    assert.equal(pageHoldings(holdings, { budgetChars: BIG, filters: { search: "   " } }).total, 5);
  });

  test("market_code matches the whole code, ignoring case", () => {
    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG, filters: { market_code: "asx" } })), [10, 20, 40]);
    assert.equal(pageHoldings(holdings, { budgetChars: BIG, filters: { market_code: "AS" } }).total, 0);
  });

  test("portfolio_id keeps one portfolio", () => {
    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG, filters: { portfolio_id: 2 } })), [20, 40, 50]);
  });

  test("valid_position can keep either kind", () => {
    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG, filters: { valid_position: true } })), [10, 20, 30, 50]);
    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG, filters: { valid_position: false } })), [40]);
  });

  test("filters combine", () => {
    const filters = { market_code: "ASX", portfolio_id: 2, valid_position: true };

    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: BIG, filters })), [20]);
  });
});

describe("pageHoldings budget", () => {
  test("a page holds as many holdings as fit in the budget", () => {
    // Room for exactly three of these similarly sized holdings
    const budget = [10, 20, 30].reduce((sum, id) => sum + serializedSize(holdings.find((h) => h.id === id)!), 0);
    const page = pageHoldings(holdings, { budgetChars: budget });

    assert.deepEqual(ids(page), [10, 20, 30]);
    assert.equal(page.nextOffset, 3);
  });

  test("one character less than that leaves the last one for the next page", () => {
    const budget = [10, 20, 30].reduce((sum, id) => sum + serializedSize(holdings.find((h) => h.id === id)!), 0) - 1;

    assert.deepEqual(ids(pageHoldings(holdings, { budgetChars: budget })), [10, 20]);
  });

  test("bigger holdings mean fewer per page", () => {
    const wide = Array.from({ length: 6 }, (_, i) => ({ ...holding(i + 1, `W${i}`, "x".repeat(2000), "ASX", 1) }) as Holding);
    const small = Array.from({ length: 6 }, (_, i) => holding(i + 1, `S${i}`, "x", "ASX", 1));

    assert.ok(pageHoldings(wide, { budgetChars: 5000 }).holdings.length < pageHoldings(small, { budgetChars: 5000 }).holdings.length);
  });

  test("a page always holds at least one holding, even if it is over budget", () => {
    const page = pageHoldings(holdings, { budgetChars: 1 });

    assert.deepEqual(ids(page), [10]);
    assert.equal(page.nextOffset, 1);
  });

  test("limit caps the count even when there is room", () => {
    const page = pageHoldings(holdings, { budgetChars: BIG, limit: 2 });

    assert.deepEqual(ids(page), [10, 20]);
    assert.equal(page.nextOffset, 2);
  });

  test("the size is what a holding adds to the printed response", () => {
    const printed = (list: Holding[]) => JSON.stringify({ holdings: list }, null, 2).length;

    assert.equal(printed([holdings[0], holdings[1]]) - printed([holdings[0]]), serializedSize(holdings[1]));
  });
});

describe("pageHoldings paging", () => {
  const oneSize = Math.max(...holdings.map(serializedSize));
  const twoPerPage = oneSize * 2 + 1;

  test("reports the total before paging and where the next page starts", () => {
    const page = pageHoldings(holdings, { budgetChars: twoPerPage });

    assert.deepEqual(ids(page), [10, 20]);
    assert.equal(page.total, 5);
    assert.equal(page.nextOffset, 2);
  });

  test("walking nextOffset visits every holding once", () => {
    const seen: number[] = [];

    for (let offset: number | null = 0; offset !== null; ) {
      const page = pageHoldings(holdings, { budgetChars: twoPerPage, offset });
      seen.push(...ids(page));
      offset = page.nextOffset;
    }

    assert.deepEqual(seen, [10, 20, 30, 40, 50]);
  });

  test("the last page has no nextOffset", () => {
    const page = pageHoldings(holdings, { budgetChars: twoPerPage, offset: 4 });

    assert.deepEqual(ids(page), [50]);
    assert.equal(page.nextOffset, null);
  });

  test("a page that ends exactly at the total has no next page", () => {
    assert.equal(pageHoldings(holdings, { budgetChars: BIG, limit: 5 }).nextOffset, null);
    assert.equal(pageHoldings(holdings, { budgetChars: BIG, limit: 4 }).nextOffset, 4);
  });

  test("an offset past the end gives an empty page", () => {
    const page = pageHoldings(holdings, { budgetChars: BIG, offset: 99 });

    assert.deepEqual(page.holdings, []);
    assert.equal(page.total, 5);
    assert.equal(page.nextOffset, null);
  });

  test("paging applies after filtering", () => {
    const page = pageHoldings(holdings, { budgetChars: twoPerPage, filters: { market_code: "ASX" }, offset: 2 });

    assert.deepEqual(ids(page), [40]);
    assert.equal(page.total, 3);
  });

  test("does not change the list it was given", () => {
    const before = holdings.map((h) => h.id);
    pageHoldings(holdings, { budgetChars: BIG, filters: { market_code: "ASX" } });

    assert.deepEqual(holdings.map((h) => h.id), before);
  });
});
