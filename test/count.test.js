// Port of `tests/count.rs`. The `test_count!` macro there generates five
// assertions per fixture (the whole struct plus each field individually) so a
// failure reports which column drifted; the same shape is kept here.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { count } from "../src/counter.js";

// The fixtures are read straight out of the vendored Rust checkout rather than
// copied here, so the port is always measured against the original bytes and
// the two corpora cannot drift apart.
const DATA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../source_rust/tests/data",
);

/**
 * @param {string} fixture
 * @param {{ code: number, blank: number, comment: number, lines: number }} expected
 */
function testCount(fixture, expected) {
  describe(fixture, () => {
    const actual = () => count(path.join(DATA, fixture));

    it("matches the full count", () => {
      assert.deepEqual(actual(), {
        code: expected.code,
        comment: expected.comment,
        blank: expected.blank,
        lines: expected.lines,
      });
    });
    it("counts code", () => assert.equal(actual().code, expected.code));
    it("counts blank", () => assert.equal(actual().blank, expected.blank));
    it("counts comment", () => assert.equal(actual().comment, expected.comment));
    it("counts lines", () => assert.equal(actual().lines, expected.lines));
  });
}

describe("count", () => {
  testCount("plasma.c", { code: 32032, blank: 8848, comment: 3792, lines: 44672 });
  testCount("fe25519.c", { code: 278, blank: 51, comment: 8, lines: 337 });
  testCount("ebcdic.c", { code: 165, blank: 18, comment: 101, lines: 284 });
  testCount("dumb.c", { code: 2, blank: 0, comment: 3, lines: 5 });
  testCount("ipl_funcs.c", { code: 25, blank: 6, comment: 43, lines: 74 });
  testCount("lua.lua", { code: 7, blank: 1, comment: 8, lines: 16 });
  testCount("test.rb", { code: 2, blank: 0, comment: 2, lines: 4 });
  testCount("ocaml.ml", { code: 3, blank: 4, comment: 6, lines: 13 });
  testCount("reason.re", { code: 3, blank: 4, comment: 6, lines: 13 });
  testCount("ada.ada", { code: 4, blank: 0, comment: 3, lines: 7 });
  testCount("gherkin.feature", { code: 8, blank: 2, comment: 2, lines: 12 });
  testCount("test.groovy", { code: 6, blank: 1, comment: 10, lines: 17 });
  testCount("test.tf", { code: 65, blank: 13, comment: 11, lines: 89 });
  testCount("zig.zig", { code: 5, blank: 2, comment: 2, lines: 9 });
  testCount("test.nix", { code: 3, blank: 2, comment: 3, lines: 8 });
  testCount("test.ps1", { code: 2, blank: 1, comment: 6, lines: 9 });
  testCount("test.handlebars", { code: 2, blank: 0, comment: 2, lines: 4 });
  testCount("nested-comments.hs", { code: 2, blank: 4, comment: 8, lines: 14 });
  testCount("test.sol", { code: 10, blank: 3, comment: 3, lines: 16 });

  // Fixtures shipped with the Rust repo but not covered by its own suite.
  // Values recorded from the reference binary.
  testCount("test.ada", { code: 28, blank: 12, comment: 6, lines: 46 });
  testCount("python_no_extension", { code: 2, blank: 2, comment: 2, lines: 6 });
  testCount("lua-big.lua", { code: 169344, blank: 24192, comment: 193536, lines: 387072 });
});
