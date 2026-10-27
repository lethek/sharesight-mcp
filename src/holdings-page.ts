import type { Holding } from "./types.js";

export interface HoldingFilters {
  /** Case-insensitive text that must appear in the instrument code or name */
  search?: string;
  /** Market code, for example ASX or NASDAQ (case-insensitive) */
  market_code?: string;
  portfolio_id?: number;
  valid_position?: boolean;
}

export function matchesHolding(holding: Holding, { search, market_code, portfolio_id, valid_position }: HoldingFilters): boolean {
  const text = search?.trim().toLowerCase();

  if (text && !holding.instrument.code.toLowerCase().includes(text) && !holding.instrument.name.toLowerCase().includes(text)) {
    return false;
  }

  if (market_code && holding.instrument.market_code.toUpperCase() !== market_code.trim().toUpperCase()) {
    return false;
  }

  if (portfolio_id !== undefined && holding.portfolio.id !== portfolio_id) {
    return false;
  }

  return valid_position === undefined || holding.valid_position === valid_position;
}

/** Orders holdings by id, so that page boundaries stay put. */
export const compareHoldings = (a: Holding, b: Holding): number => a.id - b.id;
