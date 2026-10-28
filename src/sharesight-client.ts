/**
 * Sharesight API v3 Client
 *
 * This module provides a TypeScript client for interacting with the Sharesight API v3, and the few v2 endpoints that v3 lacks.
 * It handles authentication, request formatting, and response parsing.
 *
 * @see https://api.sharesight.com/doc/api/v3
 * @module sharesight-client
 */

import {
  CouponCodeResponse,
  CouponRatesResponse,
  CountriesResponse,
  CreateCouponRateRequest,
  CreateCustomInvestmentPriceRequest,
  CreateCustomInvestmentRequest,
  CustomInvestmentPricesResponse,
  CustomInvestmentsResponse,
  HoldingsResponse,
  PassThroughResponse,
  PerformanceIndexChartResponse,
  PerformanceReportResponse,
  PortfoliosResponse,
  PortfolioUserSettingResponse,
  UpdateCouponRateRequest,
  UpdateCustomInvestmentPriceRequest,
  UpdateCustomInvestmentRequest,
  UpdateHoldingRequest,
  UpdatePortfolioUserSettingRequest,
  QueryParams,
  BaseResponse,
} from "./types.js";
import { DEFAULT_BASE_URL, OAuthManager } from "./oauth.js";

/** What a call returns when Sharesight answers 204 with no body */
export interface NoContent {
  status: 204;
}

const REQUEST_TIMEOUT_MS = 30000;
const REPORT_REQUEST_TIMEOUT_MS = 180000; // performance reports can be slow on large portfolios
const UPLOAD_REQUEST_TIMEOUT_MS = 180000; // a trade or payout with an attachment sends a large body

/** Writes that carry an attachment get the longer limit, because the upload itself can take a while on a slow connection. */
function writeTimeout(data: object): number {
  return "attachment" in data && data.attachment ? UPLOAD_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

/**
 * SharesightClient provides methods for interacting with the Sharesight API v3.
 *
 * @example
 * ```typescript
 * const oauth = new OAuthManager({ clientId, clientSecret });
 * const client = new SharesightClient(oauth);
 *
 * const portfolios = await client.listPortfolios();
 * console.log(portfolios.portfolios);
 * ```
 */
export class SharesightClient {
  private oauth: OAuthManager;
  /** Base URL for all Sharesight API v3 endpoints */
  private apiBaseUrl: string;
  /** The host the API versions share, for the endpoints that are only in v2 */
  private origin: string;

  /**
   * Creates a new SharesightClient instance.
   *
   * @param oauth - OAuthManager instance for authentication
   * @param baseUrl - Replaces https://api.sharesight.com, for tests or a proxy
   */
  constructor(oauth: OAuthManager, baseUrl: string = DEFAULT_BASE_URL) {
    this.oauth = oauth;
    this.origin = baseUrl.replace(/\/+$/, "");
    this.apiBaseUrl = `${this.origin}/api/v3`;
  }

  private async getAccessToken(): Promise<string> {
    return this.oauth.getValidAccessToken();
  }

  /**
   * Makes an authenticated HTTP request to the Sharesight API.
   *
   * @typeParam T - The expected response type
   * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
   * @param endpoint - API endpoint path (e.g., '/portfolios')
   * @param body - Optional request body for POST/PUT/PATCH requests
   * @param queryParams - Optional query parameters to append to the URL
   * @param timeoutMs - Optional time limit for the whole call in milliseconds (default: REQUEST_TIMEOUT_MS)
   * @returns Promise resolving to the typed response
   * @throws Error if the API returns a non-2xx status code
   *
   * @internal
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    queryParams?: Record<string, string | number | boolean | undefined>,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    // An endpoint that starts with /api/ names its own version, like /api/v2/my_user.json
    const url = new URL(endpoint.startsWith("/api/") ? `${this.origin}${endpoint}` : `${this.apiBaseUrl}${endpoint}`);

    const rethrowTimeout = (error: unknown): never => {
      if (error instanceof Error && error.name === "TimeoutError") {
        const outcome = method === "GET" ? "" : " The change may still have been applied; check before retrying.";
        throw new Error(
          `Sharesight API request timed out after ${timeoutMs / 1000}s (${method} ${endpoint}).${outcome}`,
          { cause: error }
        );
      }
      throw error;
    };

    // Append query parameters, filtering out undefined values
    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // One deadline for the whole call, including the 401 retry
    const signal = AbortSignal.timeout(timeoutMs);

    const send = async (): Promise<{ response: Response; accessToken: string }> => {
      const accessToken = await this.getAccessToken();

      // Set required headers for Sharesight API
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      };

      const options: RequestInit = {
        method,
        headers,
        signal,
      };

      // Add body for mutation requests
      if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
        options.body = JSON.stringify(body);
      }

      return { response: await fetch(url.toString(), options).catch(rethrowTimeout), accessToken };
    };

    // A token fetched for this call was just issued, so a 401 on it will not be fixed by another one
    const tokenWasCached = this.oauth.hasToken();
    const first = await send();
    let response = first.response;

    // The cached token may have been revoked server-side; get a new one and retry once
    if (response.status === 401 && tokenWasCached) {
      await response.body?.cancel();
      this.oauth.invalidate(first.accessToken);
      response = (await send()).response;
    }

    // Handle error responses
    if (!response.ok) {
      const errorText = await response.text().catch(rethrowTimeout);
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { reason: errorText };
      }
      throw new Error(
        `Sharesight API error (${response.status}): ${errorData.reason || errorData.error || errorText}`
      );
    }

    // Some deletes answer 204 with no body, so callers of those endpoints are typed as NoContent
    if (response.status === 204) {
      return { status: 204 } as T;
    }

    return response.json().catch(rethrowTimeout) as Promise<T>;
  }

  // ==========================================================================
  // Coupon Codes
  // ==========================================================================

  /**
   * Applies a coupon code to the current user's account.
   *
   * @param code - The coupon code to apply
   * @returns Promise with the applied coupon code details
   * @throws Error if the coupon code is invalid or already applied
   *
   * @example
   * ```typescript
   * const result = await client.applyCouponCode('PROMO2024');
   * console.log(`Applied coupon: ${result.code}`);
   * ```
   */
  async applyCouponCode(code: string): Promise<CouponCodeResponse> {
    return this.request<CouponCodeResponse>("POST", "/coupon_code", { code });
  }

  /**
   * Removes the coupon code from the current user's account.
   *
   * @returns Promise with the API transaction details
   */
  async deleteCouponCode(): Promise<BaseResponse> {
    return this.request<BaseResponse>("DELETE", "/coupon_code");
  }

  /**
   * Retrieves the coupon code currently applied to the user's account.
   *
   * @returns Promise with the coupon code details, or empty if none applied
   */
  async showCouponCode(): Promise<CouponCodeResponse> {
    return this.request<CouponCodeResponse>("GET", "/coupon_code");
  }

  // ==========================================================================
  // Custom Investment Coupon Rates
  // ==========================================================================

  /**
   * Lists coupon rates for a fixed interest custom investment.
   *
   * @param instrumentId - The custom investment instrument ID
   * @param options - Optional filtering and pagination parameters
   * @param options.start_date - Filter rates from this date (YYYY-MM-DD)
   * @param options.end_date - Filter rates until this date (YYYY-MM-DD)
   * @param options.page - Pagination cursor from previous response
   * @param options.per_page - Items per page (default: 50, max: 100)
   * @returns Promise with the list of coupon rates
   */
  async listCouponRates(
    instrumentId: number,
    options?: {
      start_date?: string;
      end_date?: string;
      page?: string;
      per_page?: number;
    }
  ): Promise<CouponRatesResponse> {
    return this.request<CouponRatesResponse>(
      "GET",
      `/custom_investments/${instrumentId}/coupon_rates`,
      undefined,
      options
    );
  }

  /**
   * Creates a new coupon rate for a fixed interest custom investment.
   *
   * @param instrumentId - The custom investment instrument ID
   * @param data - The coupon rate data
   * @returns Promise with the created coupon rate
   */
  async createCouponRate(
    instrumentId: number,
    data: CreateCouponRateRequest
  ): Promise<CouponRatesResponse> {
    return this.request<CouponRatesResponse>(
      "POST",
      `/custom_investments/${instrumentId}/coupon_rates`,
      data
    );
  }

  /**
   * Updates an existing coupon rate.
   *
   * @param id - The coupon rate ID to update
   * @param data - The updated coupon rate data
   * @returns Promise with the updated coupon rate
   */
  async updateCouponRate(
    id: number,
    data: UpdateCouponRateRequest
  ): Promise<CouponRatesResponse> {
    return this.request<CouponRatesResponse>(
      "PUT",
      `/coupon_rates/${id}`,
      data
    );
  }

  /**
   * Deletes a coupon rate.
   *
   * @param id - The coupon rate ID to delete
   * @returns Promise with the API transaction details
   */
  async deleteCouponRate(id: number): Promise<BaseResponse> {
    return this.request<BaseResponse>("DELETE", `/coupon_rates/${id}`);
  }

  // ==========================================================================
  // Custom Investment Prices
  // ==========================================================================

  /**
   * Lists price history for a custom investment.
   *
   * @param customInvestmentId - The custom investment ID
   * @param options - Optional filtering and pagination parameters
   * @param options.start_date - Filter prices from this date (YYYY-MM-DD)
   * @param options.end_date - Filter prices until this date (YYYY-MM-DD)
   * @param options.page - Pagination cursor from previous response
   * @param options.per_page - Items per page (default: 50, max: 100)
   * @returns Promise with the list of prices
   */
  async listCustomInvestmentPrices(
    customInvestmentId: number,
    options?: {
      start_date?: string;
      end_date?: string;
      page?: string;
      per_page?: number;
    }
  ): Promise<CustomInvestmentPricesResponse> {
    return this.request<CustomInvestmentPricesResponse>(
      "GET",
      `/custom_investment/${customInvestmentId}/prices.json`,
      undefined,
      options
    );
  }

  /**
   * Creates a new price entry for a custom investment.
   *
   * @param customInvestmentId - The custom investment ID
   * @param data - The price data including price and date
   * @returns Promise with the created price entry
   *
   * @example
   * ```typescript
   * const price = await client.createCustomInvestmentPrice(123, {
   *   last_traded_price: 100.50,
   *   last_traded_on: '2024-01-15'
   * });
   * ```
   */
  async createCustomInvestmentPrice(
    customInvestmentId: number,
    data: CreateCustomInvestmentPriceRequest
  ): Promise<CustomInvestmentPricesResponse> {
    return this.request<CustomInvestmentPricesResponse>(
      "POST",
      `/custom_investment/${customInvestmentId}/prices.json`,
      data
    );
  }

  /**
   * Updates an existing price entry.
   *
   * @param priceId - The price entry ID to update
   * @param data - The updated price data
   * @returns Promise with the updated price entry
   */
  async updateCustomInvestmentPrice(
    priceId: number,
    data: UpdateCustomInvestmentPriceRequest
  ): Promise<CustomInvestmentPricesResponse> {
    return this.request<CustomInvestmentPricesResponse>(
      "PUT",
      `/prices/${priceId}.json`,
      data
    );
  }

  /**
   * Deletes a price entry.
   *
   * @param priceId - The price entry ID to delete
   * @returns Promise with the API transaction details
   */
  async deleteCustomInvestmentPrice(priceId: number): Promise<BaseResponse> {
    return this.request<BaseResponse>("DELETE", `/prices/${priceId}.json`);
  }

  // ==========================================================================
  // Custom Investments
  // ==========================================================================

  /**
   * Lists all custom investments, optionally filtered by portfolio.
   *
   * @param portfolioId - Optional portfolio ID to filter by
   * @returns Promise with the list of custom investments
   */
  async listCustomInvestments(
    portfolioId?: number
  ): Promise<CustomInvestmentsResponse> {
    return this.request<CustomInvestmentsResponse>(
      "GET",
      "/custom_investments",
      undefined,
      portfolioId ? { portfolio_id: portfolioId } : undefined
    );
  }

  /**
   * Retrieves a single custom investment by ID.
   *
   * @param id - The custom investment ID
   * @returns Promise with the custom investment details
   */
  async getCustomInvestment(id: number): Promise<CustomInvestmentsResponse> {
    return this.request<CustomInvestmentsResponse>(
      "GET",
      `/custom_investments/${id}`
    );
  }

  /**
   * Creates a new custom investment.
   *
   * @param data - The custom investment data
   * @returns Promise with the created custom investment
   *
   * @example
   * ```typescript
   * const investment = await client.createCustomInvestment({
   *   code: 'MYFUND',
   *   name: 'My Property Fund',
   *   country_code: 'AU',
   *   investment_type: 'MANAGED_FUND'
   * });
   * ```
   */
  async createCustomInvestment(
    data: CreateCustomInvestmentRequest
  ): Promise<CustomInvestmentsResponse> {
    return this.request<CustomInvestmentsResponse>(
      "POST",
      "/custom_investments",
      data
    );
  }

  /**
   * Updates an existing custom investment.
   *
   * @param id - The custom investment ID to update
   * @param data - The updated custom investment data
   * @returns Promise with the updated custom investment
   */
  async updateCustomInvestment(
    id: number,
    data: UpdateCustomInvestmentRequest
  ): Promise<CustomInvestmentsResponse> {
    return this.request<CustomInvestmentsResponse>(
      "PUT",
      `/custom_investments/${id}`,
      data
    );
  }

  /**
   * Deletes a custom investment.
   *
   * @param id - The custom investment ID to delete
   * @returns Promise with deletion confirmation
   */
  async deleteCustomInvestment(id: number): Promise<CustomInvestmentsResponse> {
    return this.request<CustomInvestmentsResponse>(
      "DELETE",
      `/custom_investments/${id}`
    );
  }

  // ==========================================================================
  // Holdings
  // ==========================================================================

  /**
   * Lists all holdings across all portfolios.
   *
   * @returns Promise with the list of holdings
   */
  async listHoldings(): Promise<HoldingsResponse> {
    return this.request<HoldingsResponse>("GET", "/holdings");
  }

  /**
   * Retrieves details of a specific holding.
   *
   * @param id - The holding ID
   * @param options - Optional parameters for additional data
   * @param options.average_purchase_price - Include average purchase price
   * @param options.cost_base - Include cost base information
   * @param options.values_over_time - Include historical values ('true' for inception, or date string)
   * @returns Promise with the holding details
   *
   * @example
   * ```typescript
   * const holding = await client.getHolding(12345, {
   *   average_purchase_price: true,
   *   cost_base: true,
   *   values_over_time: '2024-01-01'
   * });
   * ```
   */
  async getHolding(
    id: number,
    options?: {
      average_purchase_price?: boolean;
      cost_base?: boolean;
      values_over_time?: string | boolean;
    }
  ): Promise<HoldingsResponse> {
    return this.request<HoldingsResponse>(
      "GET",
      `/holdings/${id}`,
      undefined,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Updates a holding's settings (currently supports DRP configuration).
   *
   * @param id - The holding ID to update
   * @param data - The update data (enable_drp, drp_mode_setting)
   * @param options - Optional parameters for response data
   * @returns Promise with the updated holding
   */
  async updateHolding(
    id: number,
    data: UpdateHoldingRequest,
    options?: {
      average_purchase_price?: boolean;
      cost_base?: boolean;
      values_over_time?: string | boolean;
    }
  ): Promise<HoldingsResponse> {
    return this.request<HoldingsResponse>(
      "PUT",
      `/holdings/${id}`,
      data,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Deletes a holding.
   *
   * @param id - The holding ID to delete
   * @param options - Optional parameters
   * @returns Promise with the API transaction details
   */
  async deleteHolding(
    id: number,
    options?: {
      average_purchase_price?: boolean;
      cost_base?: boolean;
      values_over_time?: string | boolean;
    }
  ): Promise<BaseResponse> {
    return this.request<BaseResponse>(
      "DELETE",
      `/holdings/${id}`,
      undefined,
      options as Record<string, string | number | boolean | undefined>
    );
  }

  // ==========================================================================
  // Metadata / Countries
  // ==========================================================================

  /**
   * Lists Sharesight country definitions.
   *
   * @param supported - Optional filter for supported countries only
   * @returns Promise with the list of countries
   */
  async listCountries(supported?: boolean): Promise<CountriesResponse> {
    return this.request<CountriesResponse>(
      "GET",
      "/countries",
      undefined,
      supported !== undefined ? { supported } : undefined
    );
  }

  // ==========================================================================
  // Portfolios
  // ==========================================================================

  /**
   * Lists all portfolios accessible to the user.
   *
   * @param options - Optional filtering parameters
   * @param options.consolidated - Set to true for consolidated portfolio views
   * @param options.instrument_id - Filter portfolios containing this instrument
   * @returns Promise with the list of portfolios
   *
   * @example
   * ```typescript
   * // List all portfolios
   * const portfolios = await client.listPortfolios();
   *
   * // List consolidated views only
   * const consolidated = await client.listPortfolios({ consolidated: true });
   * ```
   */
  async listPortfolios(options?: {
    consolidated?: boolean;
    instrument_id?: number;
  }): Promise<PortfoliosResponse> {
    return this.request<PortfoliosResponse>(
      "GET",
      "/portfolios",
      undefined,
      options
    );
  }

  /**
   * Retrieves a single portfolio by ID.
   *
   * @param portfolioId - The portfolio ID
   * @param consolidated - Set to true if this is a consolidated portfolio
   * @returns Promise with the portfolio details
   */
  async getPortfolio(
    portfolioId: number,
    consolidated?: boolean
  ): Promise<PortfoliosResponse> {
    return this.request<PortfoliosResponse>(
      "GET",
      `/portfolios/${portfolioId}`,
      undefined,
      consolidated !== undefined ? { consolidated } : undefined
    );
  }

  /**
   * Lists all holdings in a specific portfolio.
   *
   * @param portfolioId - The portfolio ID
   * @param consolidated - Set to true for consolidated view
   * @returns Promise with the list of holdings
   */
  async listPortfolioHoldings(
    portfolioId: number,
    consolidated?: boolean
  ): Promise<HoldingsResponse> {
    return this.request<HoldingsResponse>(
      "GET",
      `/portfolios/${portfolioId}/holdings`,
      undefined,
      consolidated !== undefined ? { consolidated } : undefined
    );
  }

  /**
   * Retrieves user-specific settings for a portfolio.
   *
   * @param portfolioId - The portfolio ID
   * @param consolidated - Set to true for consolidated portfolio
   * @returns Promise with the user settings
   */
  async showPortfolioUserSetting(
    portfolioId: number,
    consolidated?: boolean
  ): Promise<PortfolioUserSettingResponse> {
    return this.request<PortfolioUserSettingResponse>(
      "GET",
      `/portfolios/${portfolioId}/user_setting`,
      undefined,
      consolidated !== undefined ? { consolidated } : undefined
    );
  }

  /**
   * Updates user-specific settings for a portfolio.
   *
   * @param portfolioId - The portfolio ID
   * @param data - The settings to update
   * @param consolidated - Set to true for consolidated portfolio
   * @returns Promise with the updated settings
   */
  async updatePortfolioUserSetting(
    portfolioId: number,
    data: UpdatePortfolioUserSettingRequest,
    consolidated?: boolean
  ): Promise<PortfolioUserSettingResponse> {
    return this.request<PortfolioUserSettingResponse>(
      "PATCH",
      `/portfolios/${portfolioId}/user_setting`,
      data,
      consolidated !== undefined ? { consolidated } : undefined
    );
  }

  // ==========================================================================
  // Reports
  // ==========================================================================

  /**
   * Retrieves performance index chart data for visualizing portfolio performance.
   *
   * The chart data includes normalized values (starting at 10000 points) that can
   * be plotted over time to show portfolio growth.
   *
   * @param portfolioId - The portfolio ID
   * @param options - Optional chart parameters
   * @param options.consolidated - True for consolidated view
   * @param options.start_date - Chart start date (YYYY-MM-DD), defaults to inception
   * @param options.end_date - Chart end date (YYYY-MM-DD), defaults to today
   * @param options.grouping - Grouping for breakdown lines
   * @param options.custom_group_id - Custom group ID (requires grouping='custom_group')
   * @param options.benchmark_code - Benchmark code (e.g., 'SPY.NYSE')
   * @returns Promise with the chart data
   */
  async getPerformanceIndexChart(
    portfolioId: number,
    options?: {
      consolidated?: boolean;
      start_date?: string;
      end_date?: string;
      grouping?: string;
      custom_group_id?: number;
      benchmark_code?: string;
    }
  ): Promise<PerformanceIndexChartResponse> {
    return this.request<PerformanceIndexChartResponse>(
      "GET",
      `/portfolios/${portfolioId}/performance_index_chart`,
      undefined,
      options,
      REPORT_REQUEST_TIMEOUT_MS
    );
  }

  /**
   * Retrieves the performance report for a portfolio.
   *
   * The report includes capital gains, payout gains, currency gains, and total
   * gains broken down by holding and grouping.
   *
   * @param portfolioId - The portfolio ID
   * @param options - Optional report parameters
   * @param options.start_date - Report start date (YYYY-MM-DD), defaults to inception
   * @param options.end_date - Report end date (YYYY-MM-DD), defaults to today
   * @param options.consolidated - True for consolidated view
   * @param options.include_sales - Include sold holdings
   * @param options.report_combined - Combine same instruments across portfolios
   * @param options.labels - Filter by labels
   * @param options.grouping - Grouping for sub-totals
   * @param options.custom_group_id - Custom group ID (requires grouping='custom_group')
   * @param options.include_limited - Include holdings limited by subscription
   * @param options.benchmark_code - Benchmark code (e.g., 'SPY.NYSE')
   * @returns Promise with the performance report
   *
   * @example
   * ```typescript
   * const report = await client.getPerformanceReport(12345, {
   *   start_date: '2024-01-01',
   *   end_date: '2024-12-31',
   *   grouping: 'market',
   *   benchmark_code: 'SPY.NYSE'
   * });
   * console.log(`Total gain: ${report.report.total_gain_percent}%`);
   * ```
   */
  async getPerformanceReport(
    portfolioId: number,
    options?: {
      start_date?: string;
      end_date?: string;
      consolidated?: boolean;
      include_sales?: boolean;
      report_combined?: boolean;
      labels?: string[];
      grouping?: string;
      custom_group_id?: number;
      include_limited?: boolean;
      benchmark_code?: string;
    }
  ): Promise<PerformanceReportResponse> {
    const { labels, ...rest } = options || {};
    const queryParams: Record<string, string | number | boolean | undefined> = rest;

    return this.request<PerformanceReportResponse>(
      "GET",
      `/portfolios/${portfolioId}/performance`,
      undefined,
      queryParams,
      REPORT_REQUEST_TIMEOUT_MS
    );
  }

  /** Lists the reports saved for a portfolio. */
  async listPortfolioReports(portfolioId: number, type: "tax" | "tools"): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/portfolios/${portfolioId}/reports`, undefined, { type });
  }

  /** Compares a portfolio with a benchmark instrument. */
  async getPortfolioBenchmark(portfolioId: number, options: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/portfolios/${portfolioId}/benchmark.json`, undefined, options, REPORT_REQUEST_TIMEOUT_MS);
  }

  /** Retrieves the current value of a portfolio, optionally in another currency. */
  async getPortfolioValue(portfolioId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/portfolios/${portfolioId}/value`, undefined, options);
  }

  /** Retrieves the value series and price difference of a portfolio. */
  async getPortfolioValueData(portfolioId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/portfolios/${portfolioId}/portfolio_value_data.json`, undefined, options);
  }

  /** Lists the trades of a portfolio. */
  async listTrades(portfolioId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/portfolios/${portfolioId}/trades.json`, undefined, options);
  }

  /** Lists the trades of a holding. */
  async listHoldingTrades(holdingId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/holdings/${holdingId}/trades.json`, undefined, options);
  }

  async getTrade(id: number): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/trades/${id}.json`);
  }

  /** Creates a trade. Sharesight wants the fields under a `trade` key; an attachment goes in as base64 with its file name. */
  async createTrade(data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("POST", "/trades.json", { trade: data }, undefined, writeTimeout(data));
  }

  async updateTrade(id: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("PUT", `/trades/${id}.json`, { trade: data }, undefined, writeTimeout(data));
  }

  async deleteTrade(id: number): Promise<BaseResponse> {
    return this.request<BaseResponse>("DELETE", `/trades/${id}.json`);
  }

  /** Lists the payouts (dividends and interest) of a holding. */
  async listPayouts(holdingId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/holdings/${holdingId}/payouts`, undefined, options);
  }

  async getPayout(id: number): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/payouts/${id}`);
  }

  /** Creates a payout. The body is flat; an attachment goes in as base64 with its file name. */
  async createPayout(holdingId: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("POST", `/holdings/${holdingId}/payouts`, { payout: data }, undefined, writeTimeout(data));
  }

  async updatePayout(id: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("PUT", `/payouts/${id}`, { payout: data }, undefined, writeTimeout(data));
  }

  async deletePayout(id: number): Promise<BaseResponse> {
    return this.request<BaseResponse>("DELETE", `/payouts/${id}`);
  }

  /** Lists the adjustments (dividends) of an ordinary custom investment. */
  async listAdjustments(instrumentId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/custom_investments/${instrumentId}/adjustments`, undefined, options);
  }

  async getAdjustment(id: number): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/adjustments/${id}`);
  }

  /** Creates an adjustment. Sharesight wants the fields under an `adjustment` key and otherwise reports a missing currency. */
  async createAdjustment(instrumentId: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("POST", `/custom_investments/${instrumentId}/adjustments`, { adjustment: data });
  }

  async updateAdjustment(id: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("PUT", `/adjustments/${id}`, { adjustment: data });
  }

  async deleteAdjustment(id: number): Promise<BaseResponse> {
    return this.request<BaseResponse>("DELETE", `/adjustments/${id}`);
  }

  /** Lists the labels of a portfolio. */
  async listLabels(portfolioId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/portfolios/${portfolioId}/labels`, undefined, options);
  }

  async getLabel(portfolioId: number, label: string, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/portfolios/${portfolioId}/labels/${encodeURIComponent(label)}`, undefined, options);
  }

  /** Creates a label and attaches it to the holdings. */
  async createLabel(portfolioId: number, data: object, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("POST", `/portfolios/${portfolioId}/labels`, data, options);
  }

  /** Attaches a label to more holdings, creating the label if it does not exist. */
  async updateLabel(portfolioId: number, label: string, data: object, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("PUT", `/portfolios/${portfolioId}/labels/${encodeURIComponent(label)}`, data, options);
  }

  async deleteLabel(portfolioId: number, label: string, options?: QueryParams): Promise<NoContent> {
    return this.request<NoContent>("DELETE", `/portfolios/${portfolioId}/labels/${encodeURIComponent(label)}`, undefined, options);
  }

  /** Detaches a label from one holding. */
  async deleteHoldingLabel(holdingId: number, label: string): Promise<NoContent> {
    return this.request<NoContent>("DELETE", `/holdings/${holdingId}/labels/${encodeURIComponent(label)}`);
  }

  // ==========================================================================
  // v2 endpoints, for what v3 does not offer
  // ==========================================================================

  /** One of the v2 reports: capital_gains, diversity, unrealised_cgt or valuation. */
  async getReportV2(portfolioId: number, report: "capital_gains" | "diversity" | "unrealised_cgt" | "valuation", options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/api/v2/portfolios/${portfolioId}/${report}.json`, undefined, options, REPORT_REQUEST_TIMEOUT_MS);
  }

  async getMyUser(): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", "/api/v2/my_user.json");
  }

  async listUserInstruments(): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", "/api/v2/user_instruments.json");
  }

  /** Lists the payouts of a portfolio, confirmed and unconfirmed. v2 is the only version that shows the unconfirmed ones. */
  async listPortfolioPayoutsV2(portfolioId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/api/v2/portfolios/${portfolioId}/payouts.json`, undefined, options, REPORT_REQUEST_TIMEOUT_MS);
  }

  /** Lists the trades of a portfolio, confirmed and unconfirmed. */
  async listPortfolioTradesV2(portfolioId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/api/v2/portfolios/${portfolioId}/trades.json`, undefined, options, REPORT_REQUEST_TIMEOUT_MS);
  }

  async listRejectedTradesV2(holdingId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/api/v2/holdings/${holdingId}/rejected_trades.json`, undefined, options);
  }

  /** Lists the trades of a holding, confirmed and unconfirmed. */
  async listHoldingTradesV2(holdingId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/api/v2/holdings/${holdingId}/trades.json`, undefined, options, REPORT_REQUEST_TIMEOUT_MS);
  }

  /** Lists the payouts of a holding, confirmed and unconfirmed. */
  async listHoldingPayoutsV2(holdingId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/api/v2/holdings/${holdingId}/payouts.json`, undefined, options);
  }

  /** Updates a payout through v2, the only version that changes its currency. */
  async updatePayoutV2(id: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("PUT", `/api/v2/payouts/${id}.json`, { payout: data }, undefined, writeTimeout(data));
  }

  /** Confirms or rejects an unconfirmed payout, which the v2 API does with a POST of a new state. */
  async setPayoutStateV2(data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("POST", "/api/v2/payouts.json", { payout: data });
  }

  /** Lists the custom groups and the built-in ways of grouping a user can report on. */
  async listGroups(): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", "/api/v2/groups.json");
  }

  /** Lists the cash accounts of one portfolio, or of all of them. */
  async listCashAccounts(portfolioId?: number, options?: QueryParams): Promise<PassThroughResponse> {
    const endpoint = portfolioId === undefined ? "/api/v2/cash_accounts.json" : `/api/v2/portfolios/${portfolioId}/cash_accounts.json`;

    return this.request<PassThroughResponse>("GET", endpoint, undefined, options);
  }

  async getCashAccount(id: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/api/v2/cash_accounts/${id}.json`, undefined, options);
  }

  async createCashAccount(portfolioId: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("POST", `/api/v2/portfolios/${portfolioId}/cash_accounts.json`, { cash_account: data });
  }

  async updateCashAccount(id: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("PUT", `/api/v2/cash_accounts/${id}.json`, data);
  }

  async deleteCashAccount(id: number): Promise<NoContent> {
    return this.request<NoContent>("DELETE", `/api/v2/cash_accounts/${id}.json`);
  }

  async listCashAccountTransactions(cashAccountId: number, options?: QueryParams): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("GET", `/api/v2/cash_accounts/${cashAccountId}/cash_account_transactions.json`, undefined, options);
  }

  async createCashAccountTransaction(cashAccountId: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("POST", `/api/v2/cash_accounts/${cashAccountId}/cash_account_transactions.json`, data);
  }

  async updateCashAccountTransaction(id: number, data: object): Promise<PassThroughResponse> {
    return this.request<PassThroughResponse>("PUT", `/api/v2/cash_account_transactions/${id}.json`, data);
  }

  async deleteCashAccountTransaction(id: number): Promise<NoContent> {
    return this.request<NoContent>("DELETE", `/api/v2/cash_account_transactions/${id}.json`);
  }
}
