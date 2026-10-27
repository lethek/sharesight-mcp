import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const MOCK_CLIENT_ID = "id";
export const MOCK_CLIENT_SECRET = "secret";
export const MOCK_ACCESS_TOKEN = "mock-access-token";

export interface MockSharesight {
  /** Base URL to give the server as SHARESIGHT_BASE_URL */
  url: string;
  /** Requests the token endpoint has received */
  tokenRequests: number;
  /** Requests the holdings endpoints have received. Each reply carries this count as its api_transaction id. */
  holdingsRequests: number;
  /** Every request received, in order */
  requests: Array<{ method: string; path: string; body?: any }>;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
  }

  return body;
}

/**
 * A stand-in for the parts of the Sharesight API the tests use: the OAuth token endpoint and the two holdings lists.
 * It checks what a real Sharesight would, namely the client credentials grant and a bearer token on API calls.
 */
export async function startMockSharesight(holdings: object[]): Promise<MockSharesight> {
  const mock: MockSharesight = {
    url: "",
    tokenRequests: 0,
    holdingsRequests: 0,
    requests: [],
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };

  const send = (res: import("node:http").ServerResponse, status: number, body: object) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server: Server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const text = await readBody(req);
    const entry: MockSharesight["requests"][number] = { method: req.method ?? "", path };
    mock.requests.push(entry);

    if (req.method === "POST" && path === "/oauth2/token") {
      mock.tokenRequests++;
      const form = new URLSearchParams(text);

      if (form.get("grant_type") !== "client_credentials" || form.get("client_id") !== MOCK_CLIENT_ID || form.get("client_secret") !== MOCK_CLIENT_SECRET) {
        send(res, 401, { error: "invalid_client" });
        return;
      }

      send(res, 200, { access_token: MOCK_ACCESS_TOKEN, token_type: "Bearer", expires_in: 1800 });
      return;
    }

    if (req.headers.authorization !== `Bearer ${MOCK_ACCESS_TOKEN}`) {
      send(res, 401, { error: "invalid_token" });
      return;
    }

    // Any portfolio id gets the same list, like a consolidated view whose holdings belong to other portfolios
    if (req.method === "GET" && (path === "/api/v3/holdings" || /^\/api\/v3\/portfolios\/\d+\/holdings$/.test(path))) {
      send(res, 200, { holdings, api_transaction: { id: ++mock.holdingsRequests } });
      return;
    }

    // Detaching a label from a holding answers 204 with no body, like Sharesight
    if (req.method === "DELETE" && /^\/api\/v3\/holdings\/\d+\/labels\/[^/]+$/.test(path)) {
      res.writeHead(204);
      res.end();
      return;
    }

    // Trades, payouts, adjustments, labels and portfolio settings: any write is accepted, and the body is kept so a test can see what the server sent
    if (/^\/api\/v3\/(trades\.json|trades\/\d+\.json|holdings\/\d+\/payouts|payouts\/\d+|portfolios\/\d+\/user_setting|custom_investments\/\d+\/adjustments|adjustments\/\d+|portfolios\/\d+\/labels(\/[^/]+)?)$/.test(path) && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "")) {
      entry.body = text ? JSON.parse(text) : undefined;
      send(res, 200, { api_transaction: { id: 1 } });
      return;
    }

    if (req.method === "GET" && /^\/api\/v3\/(portfolios\/\d+\/(trades\.json|reports|benchmark\.json|value|portfolio_value_data\.json)|holdings\/\d+\/(trades\.json|payouts)|trades\/\d+\.json|payouts\/\d+|custom_investments\/\d+\/adjustments|adjustments\/\d+|portfolios\/\d+\/labels(\/[^/]+)?)$/.test(path)) {
      send(res, 200, { api_transaction: { id: 1 }, query: new URL(req.url ?? "/", "http://localhost").search });
      return;
    }

    // v2: confirming or rejecting a payout is a POST of a new state, and the portfolio lists mix confirmed and unconfirmed items
    if (req.method === "POST" && path === "/api/v2/payouts.json") {
      entry.body = text ? JSON.parse(text) : undefined;
      send(res, 200, { api_transaction: { id: 1 } });
      return;
    }

    if (req.method === "GET" && /^\/api\/v2\/portfolios\/\d+\/payouts\.json$/.test(path)) {
      send(res, 200, { payouts: [{ id: 1, state: "confirmed" }, { id: null, state: "unconfirmed", company_event_id: 77 }], query: new URL(req.url ?? "/", "http://localhost").search });
      return;
    }

    if (req.method === "GET" && /^\/api\/v2\/portfolios\/\d+\/trades\.json$/.test(path)) {
      send(res, 200, { trades: [{ id: 2, state: "confirmed" }, { id: null, state: "unconfirmed", company_event_id: 88 }, { id: null, state: "unconfirmed", company_event_id: 89 }] });
      return;
    }

    if (req.method === "GET" && /^\/api\/v2\/(portfolios\/\d+\/(capital_gains|diversity|unrealised_cgt|valuation)\.json|my_user\.json|user_instruments\.json|holdings\/\d+\/rejected_trades\.json)$/.test(path)) {
      send(res, 200, { query: new URL(req.url ?? "/", "http://localhost").search });
      return;
    }

    send(res, 404, { error: `no mock for ${req.method} ${path}` });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return mock;
}
