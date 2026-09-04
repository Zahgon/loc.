import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { count, countBuffer, mergeCount, newCount } from "../src/counter.js";
import { counterConfigForLang } from "../src/lang.js";
import { Lang } from "../src/tables.js";
import { containsMultibyte, trimStartOffset } from "../src/utf8.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "loc-js-counter-"));

/**
 * @param {string} name
 * @param {string | Buffer} contents
 * @returns {string}
 */
function fixture(name, contents) {
  const full = path.join(tmp, name);
  writeFileSync(full, contents);
  return full;
}

/**
 * @param {string} source
 * @param {import("../src/tables.js").LangName} lang
 */
function countSource(source, lang) {
  return countBuffer(Buffer.from(source, "utf8"), counterConfigForLang(lang));
}

describe("line splitting", () => {
  const cases = /** @type {[string, number][]} */ ([
    ["", 0],
    ["\n", 1],
    ["a", 1],
    ["a\n", 1],
    ["a\n\nb", 3],
    ["a\r\nb\r\n", 2],
    ["\n\n\n", 3],
  ]);
  for (const [source, lines] of cases) {
    it(`${JSON.stringify(source)} has ${lines} line(s)`, () => {
      assert.equal(countSource(source, Lang.C).lines, lines);
    });
  }

  it("keeps a lone \\r inside the line rather than splitting on it", () => {
    assert.equal(countSource("int a;\rint b;\n", Lang.C).lines, 1);
  });
});

describe("blank lines", () => {
  it("counts whitespace-only lines as blank", () => {
    const c = countSource("int a;\n   \n\t\n", Lang.C);
    assert.equal(c.blank, 2);
    assert.equal(c.code, 1);
  });

  it("counts blank lines inside a block comment as blank, not comment", () => {
    const c = countSource("/* open\n\nstill open */\n", Lang.C);
    assert.equal(c.blank, 1);
    assert.equal(c.comment, 2);
  });

  it("treats a lone BOM as code because Rust's trim_start does not strip it", () => {
    // JS `"\uFEFF".trimStart()` is empty; Rust's is not. If this ever reports
    // `blank: 1` then someone swapped in String.prototype.trimStart.
    const c = countSource("\uFEFF\n", Lang.C);
    assert.equal(c.blank, 0);
    assert.equal(c.code, 1);
  });

  it("treats U+00A0 and U+3000 as whitespace, matching Rust", () => {
    const c = countSource("\u00a0\n\u3000\n", Lang.C);
    assert.equal(c.blank, 2);
  });
});

describe("encoding failures", () => {
  it("returns an all-zero count for invalid UTF-8, discarding earlier lines", () => {
    const p = fixture(
      "invalid.c",
      Buffer.concat([
        Buffer.from("int a;\nint b;\n"),
        Buffer.from([0xff, 0xfe, 0x0a]),
      ]),
    );
    assert.deepEqual(count(p), newCount());
  });

  it("accepts multi-byte UTF-8 in comments and code", () => {
    const c = countSource("/* héllo — ☕ */\nint café;\n", Lang.C);
    assert.deepEqual(c, { code: 1, comment: 1, blank: 0, lines: 2 });
  });
});

describe("unreadable inputs", () => {
  it("returns an all-zero count for a missing file", () => {
    assert.deepEqual(count(path.join(tmp, "nope.c")), newCount());
  });

  it("returns an all-zero count for a directory", () => {
    assert.deepEqual(count(tmp + "/x.c"), newCount());
  });
});

describe("comment shapes", () => {
  it("handles nested Haskell block comments", () => {
    const c = countSource("{- a {- b -} c -}\nmain = pure ()\n", Lang.Haskell);
    assert.deepEqual(c, { code: 1, comment: 1, blank: 0, lines: 2 });
  });

  it("keeps multi-line comment state across lines", () => {
    const c = countSource("/*\na\nb\n*/\nint x;\n", Lang.C);
    assert.deepEqual(c, { code: 1, comment: 4, blank: 0, lines: 5 });
  });

  it("counts a language with no comment syntax as all code", () => {
    const c = countSource("a\nb\n\nc\n", Lang.Text);
    assert.deepEqual(c, { code: 3, comment: 0, blank: 1, lines: 4 });
  });

  it("prefers the multi start when a single start is a prefix of it", () => {
    // Lua's `--` is a prefix of `--[[`, which is exactly the case the
    // `break` in the singles loop exists for.
    const c = countSource("--[[ block\nstill ]]\n-- line\nprint(1)\n", Lang.Lua);
    assert.deepEqual(c, { code: 1, comment: 3, blank: 0, lines: 4 });
  });
});

describe("Count helpers", () => {
  it("merges field-wise", () => {
    const a = { code: 1, comment: 2, blank: 3, lines: 4 };
    mergeCount(a, { code: 10, comment: 20, blank: 30, lines: 40 });
    assert.deepEqual(a, { code: 11, comment: 22, blank: 33, lines: 44 });
  });
});

describe("utf8 helpers", () => {
  it("finds the trim offset in bytes", () => {
    assert.equal(trimStartOffset(Buffer.from("  a")), 2);
    assert.equal(trimStartOffset(Buffer.from("\u00a0a")), 2);
    assert.equal(trimStartOffset(Buffer.from("\u3000a")), 3);
    assert.equal(trimStartOffset(Buffer.from("\uFEFFa")), 0);
    assert.equal(trimStartOffset(Buffer.from("   ")), 3);
  });

  it("detects multi-byte content", () => {
    assert.equal(containsMultibyte(Buffer.from("plain ascii")), false);
    assert.equal(containsMultibyte(Buffer.from("é")), true);
    assert.equal(containsMultibyte(Buffer.from("a é b")), true);
  });
});
