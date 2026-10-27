import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CursorCodec, CursorError } from "../src/cursor.js";

interface State {
  scope: string;
  offset: number;
}

const state: State = { scope: "list_holdings", offset: 25 };

const isState = (value: unknown): value is State =>
  typeof value === "object" && value !== null && typeof (value as State).scope === "string" && typeof (value as State).offset === "number";

describe("CursorCodec", () => {
  test("decodes what it encoded", () => {
    const codec = new CursorCodec<State>("secret");

    assert.deepEqual(codec.decode(codec.encode(state), isState), state);
  });

  test("a cursor is a single url-safe token", () => {
    const cursor = new CursorCodec<State>("secret").encode(state);

    assert.match(cursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  test("a changed body is rejected", () => {
    const codec = new CursorCodec<State>("secret");
    const [, signature] = codec.encode(state).split(".");
    const forged = Buffer.from(JSON.stringify({ ...state, offset: 0 })).toString("base64url");

    assert.throws(() => codec.decode(`${forged}.${signature}`, isState), CursorError);
  });

  test("a changed signature is rejected", () => {
    const codec = new CursorCodec<State>("secret");
    const [body, signature] = codec.encode(state).split(".");
    const changed = (signature[0] === "A" ? "B" : "A") + signature.slice(1);

    assert.throws(() => codec.decode(`${body}.${changed}`, isState), CursorError);
  });

  test("a cursor signed with another secret is rejected", () => {
    const cursor = new CursorCodec<State>("secret-a").encode(state);

    assert.throws(() => new CursorCodec<State>("secret-b").decode(cursor, isState), CursorError);
  });

  test("each process-generated secret is different, so cursors do not cross processes by accident", () => {
    const cursor = new CursorCodec<State>().encode(state);

    assert.throws(() => new CursorCodec<State>().decode(cursor, isState), CursorError);
  });

  test("malformed input is rejected", () => {
    const codec = new CursorCodec<State>("secret");

    for (const cursor of ["", "abc", "a.b.c", ".", "a.", ".b"]) {
      assert.throws(() => codec.decode(cursor, isState), CursorError, JSON.stringify(cursor));
    }
  });

  test("a correctly signed cursor with the wrong shape is rejected", () => {
    const codec = new CursorCodec<object>("secret");

    for (const other of [{ scope: 1, offset: 2 }, { offset: 2 }, null, "text", 5]) {
      assert.throws(() => codec.decode(codec.encode(other as object), isState as never), /not valid for this version/, JSON.stringify(other));
    }
  });

  test("the error tells the caller how to recover", () => {
    assert.throws(() => new CursorCodec<State>("secret").decode("nope", isState), /Start again without a cursor/);
  });
});
