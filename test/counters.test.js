// Port of `benches/counters.rs`. The two `#[bench]` functions there drive
// `count()` over the two largest fixtures in the corpus, so the only thing they
// establish is that those inputs are processed without panicking. The port
// keeps the same two inputs and the same names, and pins the totals as well, so
// the case fails loudly rather than silently degrading into a smoke test.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { count } from "../src/counter.js";

const DATA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../source_rust/tests/data",
);

describe("counters", () => {
  it("test_count_c", () => {
    assert.deepEqual(count(path.join(DATA, "plasma.c")), {
      code: 32032,
      blank: 8848,
      comment: 3792,
      lines: 44672,
    });
  });

  it("test_count_lua", () => {
    assert.deepEqual(count(path.join(DATA, "lua-big.lua")), {
      code: 169344,
      blank: 24192,
      comment: 193536,
      lines: 387072,
    });
  });
});
