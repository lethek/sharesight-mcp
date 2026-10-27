import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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

/** The last request that carried a body, which is the last write */
export const lastBody = (mock: MockSharesight) => mock.requests.filter((r) => r.body !== undefined).at(-1)!;

/** The last request of any kind */
export const lastRequest = (mock: MockSharesight) => mock.requests.at(-1)!;

/** The method and path of the last request, for comparing without the body */
export const lastCall = (mock: MockSharesight) => ({ method: lastRequest(mock).method, path: lastRequest(mock).path });

/** Ids the v2 routes treat specially, so tests can reach each case */
export const HOLDING_WITH_PENDING_REINVESTMENT = 5; // an unconfirmed trade for company event 77
export const HOLDING_WITH_NOTHING_PENDING = 7;
export const HOLDING_WITH_PENDING_INTEREST = 8; // an unconfirmed interest payout on 2025-12-20
export const PORTFOLIO_WITH_LONG_LISTS = 99; // 60 unconfirmed payouts among confirmed ones, enough to need several pages

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
  }

  return body;
}

/** What a route handler gets to look at and answer with */
interface Call {
  method: string;
  path: string;
  search: string;
  /** The request body as JSON, or undefined if it had none */
  body: any;
  /** The log entry for this request, which a write route fills in with its body */
  entry: MockSharesight["requests"][number];
  send(status: number, body?: object): void;
}

interface Route {
  methods: string[];
  path: RegExp;
  handle(call: Call): void;
}

const WRITES = ["POST", "PUT", "PATCH", "DELETE"];

/** Accepts any write and keeps its body, so a test can see what the server sent */
const acceptWrite = ({ entry, body, send }: Call) => {
  entry.body = body;
  send(200, { api_transaction: { id: 1 } });
};

/** Answers a read with the query string it was given, so a test can see what the server sent */
const echoQuery = ({ search, send }: Call) => send(200, { api_transaction: { id: 1 }, query: search });

const holdingId = (path: string) => Number(/\/holdings\/(\d+)\//.exec(path)?.[1]);

/** Confirmed and unconfirmed payouts, newest first, in numbers that need several pages */
const longPayoutList = () =>
  Array.from({ length: 120 }, (_, i) =>
    i % 2 === 0
      ? { id: i, state: "confirmed", paid_on: "2024-01-01", comments: "c".repeat(150) }
      : { id: null, state: "unconfirmed", holding_id: 1, company_event_id: 1000 + i, paid_on: `2025-01-${String(120 - i).padStart(3, "0")}`, comments: "u".repeat(150) }
  );

/** The routes after the token and bearer checks. The first one that matches answers. */
function routes(mock: MockSharesight, holdings: object[]): Route[] {
  return [
    // Any portfolio id gets the same list, like a consolidated view whose holdings belong to other portfolios
    {
      methods: ["GET"],
      path: /^\/api\/v3\/(holdings|portfolios\/\d+\/holdings)$/,
      handle: ({ send }) => send(200, { holdings, api_transaction: { id: ++mock.holdingsRequests } }),
    },

    // Detaching a label from a holding answers 204 with no body, like Sharesight
    {
      methods: ["DELETE"],
      path: /^\/api\/v3\/holdings\/\d+\/labels\/[^/]+$/,
      handle: ({ send }) => send(204),
    },

    // Trades, payouts, adjustments, labels and portfolio settings
    {
      methods: WRITES,
      path: /^\/api\/v3\/(trades\.json|trades\/\d+\.json|holdings\/\d+\/payouts|payouts\/\d+|portfolios\/\d+\/user_setting|custom_investments\/\d+\/adjustments|adjustments\/\d+|portfolios\/\d+\/labels(\/[^/]+)?)$/,
      handle: acceptWrite,
    },
    {
      methods: ["GET"],
      path: /^\/api\/v3\/(portfolios\/\d+\/(trades\.json|reports|benchmark\.json|value|portfolio_value_data\.json)|holdings\/\d+\/(trades\.json|payouts)|trades\/\d+\.json|payouts\/\d+|custom_investments\/\d+\/adjustments|adjustments\/\d+|portfolios\/\d+\/labels(\/[^/]+)?)$/,
      handle: echoQuery,
    },

    // v2: confirming or rejecting a payout is a POST of a new state
    {
      methods: ["POST"],
      path: /^\/api\/v2\/payouts\.json$/,
      handle: (call) => {
        // Like Sharesight, which answers a rejection by paid_on with a 500 although it rejects the payout
        if (call.body?.payout?.state === "rejected" && call.body.payout.paid_on) {
          call.entry.body = call.body;
          call.send(500, { error: 2000, reason: "Internal Server Error" });
          return;
        }

        acceptWrite(call);
      },
    },

    // v2: the holding and portfolio lists mix confirmed and unconfirmed items
    {
      methods: ["GET"],
      path: /^\/api\/v2\/holdings\/\d+\/trades\.json$/,
      handle: ({ path, send }) => {
        const pending = holdingId(path) === HOLDING_WITH_PENDING_REINVESTMENT ? [{ state: "unconfirmed", company_event_id: 77, quantity: 3, price: 4 }] : [];

        send(200, { trades: [...pending, { state: "confirmed", company_event_id: null }] });
      },
    },
    {
      methods: ["GET"],
      path: /^\/api\/v2\/holdings\/\d+\/payouts\.json$/,
      handle: ({ path, send }) => send(200, { payouts: holdingId(path) === HOLDING_WITH_PENDING_INTEREST ? [{ state: "unconfirmed", paid_on: "2025-12-20" }] : [] }),
    },
    {
      methods: ["GET"],
      path: /^\/api\/v2\/portfolios\/\d+\/payouts\.json$/,
      handle: ({ path, send }) => {
        if (path.includes(`/portfolios/${PORTFOLIO_WITH_LONG_LISTS}/`)) {
          send(200, { payouts: longPayoutList(), links: { self: "mock" } });
          return;
        }

        send(200, { payouts: [{ id: 1, state: "confirmed" }, { id: null, state: "unconfirmed", company_event_id: 77 }] });
      },
    },
    {
      methods: ["GET"],
      path: /^\/api\/v2\/portfolios\/\d+\/trades\.json$/,
      handle: ({ send }) => send(200, { trades: [{ id: 2, state: "confirmed" }, { id: null, state: "unconfirmed", company_event_id: 88 }, { id: null, state: "unconfirmed", company_event_id: 89 }] }),
    },
    {
      methods: ["GET"],
      path: /^\/api\/v2\/(portfolios\/\d+\/(capital_gains|diversity|unrealised_cgt|valuation)\.json|my_user\.json|user_instruments\.json|holdings\/\d+\/rejected_trades\.json)$/,
      handle: ({ search, send }) => send(200, { query: search }),
    },
  ];
}

/**
 * A stand-in for the parts of the Sharesight API the tests use: the OAuth token endpoint and the routes below.
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

  const table = routes(mock, holdings);

  const send = (res: ServerResponse, status: number, body?: object) => {
    if (body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }

    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server: Server = createServer(async (req, res) => {
    const { pathname: path, search } = new URL(req.url ?? "/", "http://localhost");
    const text = await readBody(req);
    const method = req.method ?? "";
    const entry: MockSharesight["requests"][number] = { method, path };
    mock.requests.push(entry);

    if (method === "POST" && path === "/oauth2/token") {
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

    const route = table.find((r) => r.methods.includes(method) && r.path.test(path));

    if (!route) {
      send(res, 404, { error: `no mock for ${method} ${path}` });
      return;
    }

    route.handle({ method, path, search, body: text ? JSON.parse(text) : undefined, entry, send: (status, body) => send(res, status, body) });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return mock;
}
