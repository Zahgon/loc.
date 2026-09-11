import assert from "node:assert/strict";
import { isUtf8 as nativeIsUtf8 } from "node:buffer";
import { describe, it } from "node:test";

import {
  containsMultibyte,
  isAsciiWhitespaceByte,
  isCharBoundary,
  isValidUtf8,
  utf8Fallback,
} from "../src/utf8.js";

/**
 * Every case is asserted against Node's native validator as well, so the
 * portable path cannot silently drift from the one actually used at runtime.
 *
 * @param {number[]} bytes
 * @param {boolean} expected
 */
function bothAgree(bytes, expected) {
  const buf = Uint8Array.from(bytes);
  assert.equal(utf8Fallback(buf), expected);
  assert.equal(nativeIsUtf8(buf), expected);
  assert.equal(isValidUtf8(buf), expected);
}

describe("utf8Fallback", () => {
  it("accepts ASCII and the empty string", () => {
    bothAgree([], true);
    bothAgree([0x00], true);
    bothAgree([...Buffer.from("hello, world")], true);
    bothAgree([0x7f], true);
  });

  it("accepts well-formed multi-byte sequences", () => {
    bothAgree([...Buffer.from("é")], true); // 2-byte, U+00E9
    bothAgree([...Buffer.from("日本語")], true); // 3-byte
    bothAgree([...Buffer.from("😀")], true); // 4-byte, U+1F600
    bothAgree([0xf4, 0x8f, 0xbf, 0xbf], true); // U+10FFFF, the last scalar
  });

  it("rejects continuation bytes that stand alone", () => {
    bothAgree([0x80], false);
    bothAgree([0xbf], false);
    bothAgree([0x41, 0x80, 0x42], false);
  });

  it("rejects truncated sequences", () => {
    bothAgree([0xc3], false);
    bothAgree([0xe6, 0x97], false);
    bothAgree([0xf0, 0x9f, 0x98], false);
  });

  it("rejects overlong encodings", () => {
    bothAgree([0xc0, 0x80], false); // overlong NUL
    bothAgree([0xc1, 0xbf], false); // overlong U+007F
    bothAgree([0xe0, 0x9f, 0xbf], false); // overlong 3-byte
    bothAgree([0xf0, 0x8f, 0xbf, 0xbf], false); // overlong 4-byte
  });

  it("rejects UTF-16 surrogates", () => {
    bothAgree([0xed, 0xa0, 0x80], false); // U+D800
    bothAgree([0xed, 0xbf, 0xbf], false); // U+DFFF
    bothAgree([0xed, 0x9f, 0xbf], true); // U+D7FF, just below the range
  });

  it("rejects scalar values above U+10FFFF", () => {
    bothAgree([0xf4, 0x90, 0x80, 0x80], false); // U+110000
    bothAgree([0xf5, 0x80, 0x80, 0x80], false);
    bothAgree([0xff], false);
  });
});

describe("isCharBoundary", () => {
  const buf = Buffer.from("aé日😀");

  it("treats the ends as boundaries", () => {
    assert.equal(isCharBoundary(buf, 0), true);
    assert.equal(isCharBoundary(buf, buf.length), true);
  });

  it("finds the start of every scalar", () => {
    assert.equal(isCharBoundary(buf, 1), true); // é
    assert.equal(isCharBoundary(buf, 3), true); // 日
    assert.equal(isCharBoundary(buf, 6), true); // 😀
  });

  it("rejects offsets inside a scalar", () => {
    assert.equal(isCharBoundary(buf, 2), false);
    assert.equal(isCharBoundary(buf, 4), false);
    assert.equal(isCharBoundary(buf, 7), false);
  });
});

describe("containsMultibyte", () => {
  it("is false for pure ASCII", () => {
    assert.equal(containsMultibyte(Buffer.from("plain ascii")), false);
    assert.equal(containsMultibyte(Buffer.from("")), false);
  });

  it("is true once any byte has the high bit set", () => {
    assert.equal(containsMultibyte(Buffer.from("é")), true);
    assert.equal(containsMultibyte(Buffer.from("ascii then 日")), true);
  });
});

describe("isAsciiWhitespaceByte", () => {
  it("matches the bytes Rust's str::trim_start treats as whitespace", () => {
    for (const b of [0x20, 0x09, 0x0a, 0x0c, 0x0d]) {
      assert.equal(isAsciiWhitespaceByte(b), true);
    }
  });

  it("rejects everything else", () => {
    for (const b of [0x00, 0x41, 0x2f, 0x7f, 0xc3]) {
      assert.equal(isAsciiWhitespaceByte(b), false);
    }
  });
});
