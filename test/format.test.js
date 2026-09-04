import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HEADER_ROW,
  LINESEP,
  fileRow,
  lastNChars,
  padLeft,
  padRight,
  summaryRow,
} from "../src/format.js";

describe("padding", () => {
  it("pads to the requested width", () => {
    assert.equal(padRight("ab", 5), "ab   ");
    assert.equal(padLeft("ab", 5), "   ab");
    assert.equal(padLeft(42, 5), "   42");
  });

  it("never truncates, matching Rust's Formatter::pad without a precision", () => {
    assert.equal(padRight("abcdefgh", 3), "abcdefgh");
    assert.equal(padLeft("abcdefgh", 3), "abcdefgh");
    assert.equal(padLeft(12345678901234567890n.toString(), 12), "12345678901234567890");
  });

  it("measures width in chars, not UTF-16 code units", () => {
    // "é" is one char; a musical symbol is one char but two code units.
    assert.equal(padRight("é", 3), "é  ");
    assert.equal(padRight("\u{1D11E}", 3), "\u{1D11E}  ");
  });
});

describe("rows", () => {
  it("renders the header exactly", () => {
    assert.equal(
      HEADER_ROW,
      " Language             Files        Lines        Blank      Comment         Code",
    );
  });

  it("renders a separator of 80 dashes", () => {
    assert.equal(LINESEP.length, 80);
    assert.match(LINESEP, /^-{80}$/);
  });

  it("renders a summary row", () => {
    assert.equal(
      summaryRow("C", 1, 44672, 8848, 3792, 32032),
      " C                        1        44672         8848         3792        32032",
    );
  });

  it("renders a file row with the leading pipe", () => {
    assert.equal(
      fileRow("./tests/data/plasma.c", 44672, 8848, 3792, 32032),
      "|./tests/data/plasma.c            44672         8848         3792        32032",
    );
  });
});

describe("lastNChars", () => {
  it("returns the string unchanged when it fits", () => {
    assert.equal(lastNChars("short.c", 25), "short.c");
    assert.equal(lastNChars("x".repeat(25), 25), "x".repeat(25));
  });

  it("keeps the last n characters of an ASCII path", () => {
    assert.equal(lastNChars("./a/very/long/path/to/some/file.c", 25), "/long/path/to/some/file.c");
    assert.equal(lastNChars("x".repeat(30), 25), "x".repeat(25));
  });

  it("over-skips on multi-byte paths, reproducing the Rust bug", () => {
    // 26 chars but 52 bytes, so Rust skips 52-25=27 chars and yields "".
    const wide = "é".repeat(26);
    assert.equal(lastNChars(wide, 25), "");

    // 30 bytes / 28 chars -> skip 5 chars, keep 23.
    const mixed = "é".repeat(2) + "a".repeat(26);
    assert.equal(Buffer.byteLength(mixed), 30);
    assert.equal(lastNChars(mixed, 25), "a".repeat(23));
  });

  it("iterates by scalar value, so a surrogate pair counts as one char", () => {
    // 1 emoji (4 bytes, 1 char) + 24 ASCII = 28 bytes, 25 chars.
    const s = "\u{1F600}" + "a".repeat(24);
    assert.equal(Buffer.byteLength(s), 28);
    assert.equal(lastNChars(s, 25), "a".repeat(22));
  });
});
