import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { compareHoldings, matchesHolding, type HoldingFilters } from "../src/holdings-page.js";
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

/** The ids of the holdings that match, in page order */
const matching = (filters: HoldingFilters) => holdings.filter((h) => matchesHolding(h, filters)).sort(compareHoldings).map((h) => h.id);

describe("matchesHolding", () => {
  test("no filters keep everything, and holdings are ordered by id", () => {
    assert.deepEqual(matching({}), [10, 20, 30, 40, 50]);
  });

  test("search matches the code or the name, ignoring case", () => {
    assert.deepEqual(matching({ search: "bhp" }), [10]);
    assert.deepEqual(matching({ search: "COMMONWEALTH" }), [20]);
    assert.deepEqual(matching({ search: "corp" }), [30, 50]);
  });

  test("a blank search is ignored", () => {
    assert.equal(matching({ search: "   " }).length, 5);
  });

  test("market_code matches the whole code, ignoring case", () => {
    assert.deepEqual(matching({ market_code: "asx" }), [10, 20, 40]);
    assert.deepEqual(matching({ market_code: "AS" }), []);
  });

  test("portfolio_id keeps one portfolio", () => {
    assert.deepEqual(matching({ portfolio_id: 2 }), [20, 40, 50]);
  });

  test("valid_position can keep either kind", () => {
    assert.deepEqual(matching({ valid_position: true }), [10, 20, 30, 50]);
    assert.deepEqual(matching({ valid_position: false }), [40]);
  });

  test("filters combine", () => {
    assert.deepEqual(matching({ market_code: "ASX", portfolio_id: 2, valid_position: true }), [20]);
  });
});
