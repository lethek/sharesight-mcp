import type { McpServer } from "@modelcontextprotocol/server";
import type { HoldingsLister } from "../holdings-list.js";
import type { SharesightClient } from "../sharesight-client.js";
import type { UnconfirmedLister } from "../unconfirmed-list.js";
import type { AttachmentSettings } from "./attachments.js";
import { registerAccountReadTools, registerAccountWriteTools } from "./account.js";
import { registerAdjustmentReadTools, registerAdjustmentWriteTools } from "./adjustments.js";
import { registerConfirmationReadTools, registerConfirmationWriteTools } from "./confirmations.js";
import { registerCouponRateReadTools, registerCouponRateWriteTools } from "./coupon-rates.js";
import { registerCustomInvestmentPriceReadTools, registerCustomInvestmentPriceWriteTools } from "./custom-investment-prices.js";
import { registerCustomInvestmentReadTools, registerCustomInvestmentWriteTools } from "./custom-investments.js";
import { registerHoldingReadTools, registerHoldingWriteTools } from "./holdings.js";
import { registerLabelReadTools, registerLabelWriteTools } from "./labels.js";
import { registerPayoutReadTools, registerPayoutWriteTools } from "./payouts.js";
import { registerPerformanceReadTools } from "./performance.js";
import { registerReportReadTools } from "./reports.js";
import { registerTradeReadTools, registerTradeWriteTools } from "./trades.js";
import { registerPortfolioReadTools, registerPortfolioWriteTools } from "./portfolios.js";

export interface ToolOptions {
  holdings: HoldingsLister;
  /** Pages the unconfirmed payouts and trades */
  unconfirmed: UnconfirmedLister;
  /** Leaves out every tool that creates, changes or deletes data */
  readOnly: boolean;
  /** Where the attachment tools may read files from, and how large an attachment may be */
  paths: AttachmentSettings;
}

/**
 * Registers the tools, grouped by feature area. Each area has its read tools and its write tools in separate functions, so read-only
 * mode is a matter of not calling the write ones. Add a new area here, read tools first.
 */
export function registerTools(server: McpServer, client: SharesightClient, { holdings, unconfirmed, readOnly, paths }: ToolOptions) {
  registerPortfolioReadTools(server, client);
  registerHoldingReadTools(server, client, holdings);
  registerTradeReadTools(server, client);
  registerPayoutReadTools(server, client);
  registerCustomInvestmentReadTools(server, client);
  registerCustomInvestmentPriceReadTools(server, client);
  registerCouponRateReadTools(server, client);
  registerAdjustmentReadTools(server, client);
  registerLabelReadTools(server, client);
  registerConfirmationReadTools(server, client, unconfirmed);
  registerPerformanceReadTools(server, client);
  registerReportReadTools(server, client);
  registerAccountReadTools(server, client);

  if (readOnly) {
    return;
  }

  registerPortfolioWriteTools(server, client);
  registerHoldingWriteTools(server, client);
  registerTradeWriteTools(server, client, paths);
  registerPayoutWriteTools(server, client, paths);
  registerCustomInvestmentWriteTools(server, client);
  registerCustomInvestmentPriceWriteTools(server, client);
  registerCouponRateWriteTools(server, client);
  registerAdjustmentWriteTools(server, client);
  registerLabelWriteTools(server, client);
  registerConfirmationWriteTools(server, client);
  registerAccountWriteTools(server, client);
}
