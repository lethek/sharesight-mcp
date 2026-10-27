import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache } from "../src/cache.js";

describe("MemoryCache", () => {
  test("returns what was stored", () => {
    const cache = new MemoryCache<string>(1000);
    cache.set("a", "one");

    assert.equal(cache.get("a"), "one");
    assert.equal(cache.get("missing"), undefined);
  });

  test("an entry expires once its TTL has passed", () => {
    let time = 0;
    const cache = new MemoryCache<string>(1000, 100, () => time);
    cache.set("a", "one");

    time = 999;
    assert.equal(cache.get("a"), "one");

    time = 1000;
    assert.equal(cache.get("a"), undefined);
  });

  test("storing a key again restarts its TTL", () => {
    let time = 0;
    const cache = new MemoryCache<string>(1000, 100, () => time);
    cache.set("a", "one");

    time = 800;
    cache.set("a", "two");

    time = 1500;
    assert.equal(cache.get("a"), "two");
  });

  test("the oldest entry is dropped when the cap is exceeded", () => {
    const cache = new MemoryCache<number>(1000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.get("b"), 2);
    assert.equal(cache.get("c"), 3);
  });

  test("refreshing a key protects it from being the oldest", () => {
    const cache = new MemoryCache<number>(1000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    cache.set("c", 3);

    assert.equal(cache.get("a"), 10);
    assert.equal(cache.get("b"), undefined);
  });

  test("a TTL of 0 turns caching off", () => {
    const cache = new MemoryCache<string>(0);
    cache.set("a", "one");

    assert.equal(cache.get("a"), undefined);
  });
});
