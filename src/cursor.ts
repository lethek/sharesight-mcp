import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Thrown for a cursor that is malformed, was signed with another secret, or belongs to a different query. */
export class CursorError extends Error {
  constructor(message: string) {
    super(`${message} Start again without a cursor.`);
    this.name = "CursorError";
  }
}

/**
 * Turns paging state into an opaque string and back. The string is signed, so it cannot be altered or made up, and it holds the
 * whole state, so the server keeps nothing between calls.
 *
 * Cursors only work with the secret that signed them. Without a configured secret each process picks its own at startup, which
 * is fine for one process but means a cursor from one instance, or from before a restart, is rejected by another.
 */
export class CursorCodec<T extends object> {
  constructor(private readonly secret: string | Buffer = randomBytes(32)) {}

  encode(state: T): string {
    const body = Buffer.from(JSON.stringify(state)).toString("base64url");

    return `${body}.${this.sign(body)}`;
  }

  /** `isState` checks the shape of the payload, because a correctly signed cursor can still come from another version. */
  decode(cursor: string, isState: (value: unknown) => value is T): T {
    const [body, signature, ...extra] = cursor.split(".");

    if (!body || !signature || extra.length > 0 || !this.matches(body, signature)) {
      throw new CursorError("The cursor is not valid, or was issued by a different server process.");
    }

    let state: unknown;

    try {
      state = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      throw new CursorError("The cursor is not valid.");
    }

    if (!isState(state)) {
      throw new CursorError("The cursor is not valid for this version of the server.");
    }

    return state;
  }

  private sign(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }

  private matches(body: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(body));
    const actual = Buffer.from(signature);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
