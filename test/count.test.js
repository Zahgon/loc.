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

// Titles used for fixtures the Rust suite does not cover.
const PROSE = {
  count: "matches the full count",
  code: "counts code",
  blank: "counts blank",
  comment: "counts comment",
  lines: "counts lines",
};

/**
 * @param {string} fixture
 * @param {{ code: number, blank: number, comment: number, lines: number }} expected
 * @param {string | null} stem name the Rust macro builds its five tests from,
 *   or null when the fixture has no counterpart there
 * @param {Partial<Record<keyof typeof PROSE, string>>} overrides
 */
function testCount(fixture, expected, stem = null, overrides = {}) {
  /** @param {keyof typeof PROSE} metric */
  const title = (metric) =>
    stem === null ? PROSE[metric] : (overrides[metric] ?? `${stem}_${metric}`);

  describe(fixture, () => {
    const actual = () => count(path.join(DATA, fixture));

    it(title("count"), () => {
      assert.deepEqual(actual(), {
        code: expected.code,
        comment: expected.comment,
        blank: expected.blank,
        lines: expected.lines,
      });
    });
    it(title("code"), () => assert.equal(actual().code, expected.code));
    it(title("blank"), () => assert.equal(actual().blank, expected.blank));
    it(title("comment"), () => assert.equal(actual().comment, expected.comment));
    it(title("lines"), () => assert.equal(actual().lines, expected.lines));
  });
}

describe("count", () => {
  testCount("plasma.c", { code: 32032, blank: 8848, comment: 3792, lines: 44672 }, "t_plasma");
  testCount("fe25519.c", { code: 278, blank: 51, comment: 8, lines: 337 }, "test_fe");
  // Upstream names this fixture's blank test `evc_blank` while its other four
  // use `ebc_`; the typo is carried over so the pairing stays one-to-one.
  testCount("ebcdic.c", { code: 165, blank: 18, comment: 101, lines: 284 }, "ebc", { blank: "evc_blank" });
  testCount("dumb.c", { code: 2, blank: 0, comment: 3, lines: 5 }, "dumb");
  testCount("ipl_funcs.c", { code: 25, blank: 6, comment: 43, lines: 74 }, "ipl");
  testCount("lua.lua", { code: 7, blank: 1, comment: 8, lines: 16 }, "lua");
  testCount("test.rb", { code: 2, blank: 0, comment: 2, lines: 4 }, "ruby");
  testCount("ocaml.ml", { code: 3, blank: 4, comment: 6, lines: 13 }, "ocaml");
  testCount("reason.re", { code: 3, blank: 4, comment: 6, lines: 13 }, "reason");
  testCount("ada.ada", { code: 4, blank: 0, comment: 3, lines: 7 }, "ada");
  testCount("gherkin.feature", { code: 8, blank: 2, comment: 2, lines: 12 }, "gherkin");
  testCount("test.groovy", { code: 6, blank: 1, comment: 10, lines: 17 }, "groovy");
  testCount("test.tf", { code: 65, blank: 13, comment: 11, lines: 89 }, "terraform");
  testCount("zig.zig", { code: 5, blank: 2, comment: 2, lines: 9 }, "zig");
  testCount("test.nix", { code: 3, blank: 2, comment: 3, lines: 8 }, "nix");
  testCount("test.ps1", { code: 2, blank: 1, comment: 6, lines: 9 }, "powershell");
  testCount("test.handlebars", { code: 2, blank: 0, comment: 2, lines: 4 }, "handlebars");
  testCount("nested-comments.hs", { code: 2, blank: 4, comment: 8, lines: 14 }, "nested_haskell");
  testCount("test.sol", { code: 10, blank: 3, comment: 3, lines: 16 }, "solidity");

  // Fixtures shipped with the Rust repo but not covered by its own suite.
  // Values recorded from the reference binary.
  testCount("test.ada", { code: 28, blank: 12, comment: 6, lines: 46 });
  testCount("python_no_extension", { code: 2, blank: 2, comment: 2, lines: 6 });
  testCount("lua-big.lua", { code: 169344, blank: 24192, comment: 193536, lines: 387072 });
});
