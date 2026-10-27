/**
 * OAuth 2.0 Manager for Sharesight API
 *
 * Uses the client credentials grant, so the server acts as the single
 * Sharesight account linked to the API consumer application. Access tokens
 * are held in memory and re-requested when they expire.
 *
 * @module oauth
 */

const TOKEN_URL = "https://api.sharesight.com/oauth2/token";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

const DEFAULT_EXPIRES_IN = 1800;
const TOKEN_REQUEST_TIMEOUT_MS = 15000;

const isCredentialStatus = (status: number): boolean => status === 400 || status === 401;

/** Thrown when the token endpoint returns a non-2xx response. */
export class TokenRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "TokenRequestError";
  }

  /** True when the credentials are wrong or the account is not linked to the API application. */
  get isCredentialError(): boolean {
    return isCredentialStatus(this.status);
  }
}

export interface OAuthManagerOpts {
  clientId: string;
  clientSecret: string;
}

export class OAuthManager {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private pending: Promise<string> | null = null;

  constructor({ clientId, clientSecret }: OAuthManagerOpts) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const hint =
        isCredentialStatus(response.status)
          ?". Check the client ID and secret, and that your Sharesight account is linked to the API application."
          : "";
      throw new TokenRequestError(response.status, `Token request failed (${response.status}): ${errorText}${hint}`);
    }

    const data = (await response.json()) as TokenResponse;
    const expiresIn = Number(data.expires_in) || DEFAULT_EXPIRES_IN;
    this.accessToken = data.access_token;
    // Refresh a minute early, or halfway through the lifetime for short-lived tokens
    const bufferMs = Math.min(60000, (expiresIn * 1000) / 2);
    this.expiresAt = Date.now() + expiresIn * 1000 - bufferMs;

    return data.access_token;
  }

  /** True if a non-expired token is cached. */
  hasToken(): boolean {
    return this.accessToken !== null && Date.now() < this.expiresAt;
  }

  /**
   * Discards the cached token so the next call requests a new one.
   * Does nothing if the cache already holds a different (newer) token.
   */
  invalidate(rejectedToken: string): void {
    if (this.accessToken === rejectedToken) {
      this.accessToken = null;
    }
  }

  async getValidAccessToken(): Promise<string> {
    if (this.hasToken()) {
      return this.accessToken!;
    }

    // Share one in-flight request between concurrent callers
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = null;
    });

    return this.pending;
  }
}
