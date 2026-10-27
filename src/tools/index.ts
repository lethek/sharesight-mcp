import type { McpServer } from "@modelcontextprotocol/server";
import type { HoldingsLister } from "../holdings-list.js";
import type { SharesightClient } from "../sharesight-client.js";
import { registerAccountReadTools, registerAccountWriteTools } from "./account.js";
import { registerCouponRateReadTools, registerCouponRateWriteTools } from "./coupon-rates.js";
import { registerCustomInvestmentPriceReadTools, registerCustomInvestmentPriceWriteTools } from "./custom-investment-prices.js";
import { registerCustomInvestmentReadTools, registerCustomInvestmentWriteTools } from "./custom-investments.js";
import { registerHoldingReadTools, registerHoldingWriteTools } from "./holdings.js";
import { registerPerformanceReadTools } from "./performance.js";
import { registerPortfolioReadTools, registerPortfolioWriteTools } from "./portfolios.js";

export interface ToolOptions {
  holdings: HoldingsLister;
  /** Leaves out every tool that creates, changes or deletes data */
  readOnly: boolean;
}

/**
 * Registers the tools, grouped by feature area. Each area has its read tools and its write tools in separate functions, so read-only
 * mode is a matter of not calling the write ones. Add a new area here, read tools first.
 */
export function registerTools(server: McpServer, client: SharesightClient, { holdings, readOnly }: ToolOptions) {
  registerPortfolioReadTools(server, client);
  registerHoldingReadTools(server, client, holdings);
  registerCustomInvestmentReadTools(server, client);
  registerCustomInvestmentPriceReadTools(server, client);
  registerCouponRateReadTools(server, client);
  registerPerformanceReadTools(server, client);
  registerAccountReadTools(server, client);

  if (readOnly) {
    return;
  }

  registerPortfolioWriteTools(server, client);
  registerHoldingWriteTools(server, client);
  registerCustomInvestmentWriteTools(server, client);
  registerCustomInvestmentPriceWriteTools(server, client);
  registerCouponRateWriteTools(server, client);
  registerAccountWriteTools(server, client);
}
