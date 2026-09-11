// Byte-level helpers that mirror the exact semantics `count()` relies on in
// Rust. Everything here is indexed in BYTES, never UTF-16 code units.

import { isUtf8 as nativeIsUtf8 } from "node:buffer";

/**
 * Strict UTF-8 validation, equivalent to `std::str::from_utf8(..).is_ok()`.
 * Rejects overlong encodings, surrogates and scalar values above U+10FFFF.
 *
 * @param {Uint8Array} buf
 * @returns {boolean}
 */
export function utf8Fallback(buf) {
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const b0 = buf[i];
    if (b0 < 0x80) {
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      if (i + 1 >= n || (buf[i + 1] & 0xc0) !== 0x80) return false;
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      if (i + 2 >= n) return false;
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return false;
      if (b0 === 0xe0 && b1 < 0xa0) return false; // overlong
      if (b0 === 0xed && b1 > 0x9f) return false; // surrogate
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      if (i + 3 >= n) return false;
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      const b3 = buf[i + 3];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) {
        return false;
      }
      if (b0 === 0xf0 && b1 < 0x90) return false; // overlong
      if (b0 === 0xf4 && b1 > 0x8f) return false; // > U+10FFFF
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}

/** @type {(buf: Uint8Array) => boolean} */
export const isValidUtf8 =
  typeof nativeIsUtf8 === "function" ? nativeIsUtf8 : utf8Fallback;

/**
 * `str::is_char_boundary`. Assumes `buf` holds valid UTF-8.
 *
 * @param {Uint8Array} buf
 * @param {number} i byte index, relative to the start of `buf`
 * @returns {boolean}
 */
export function isCharBoundary(buf, i) {
  if (i === 0 || i === buf.length) return true;
  if (i > buf.length) return false;
  return (buf[i] & 0xc0) !== 0x80;
}

/**
 * True when any byte index in `[0, len)` is not a char boundary — i.e. the
 * line contains at least one multi-byte character. This is the literal
 * translation of `(0..line_len).any(|i| !line.is_char_boundary(i))`.
 *
 * @param {Uint8Array} buf
 * @returns {boolean}
 */
export function containsMultibyte(buf) {
  for (let i = 1; i < buf.length; i += 1) {
    if ((buf[i] & 0xc0) === 0x80) return true;
  }
  return false;
}

// Unicode `White_Space` code points, as their UTF-8 byte sequences. Rust's
// `str::trim_start` uses exactly this set.
//
// BUG-COMPAT-ADJACENT: JS `String.prototype.trimStart()` additionally strips
// U+FEFF (BOM), which Rust does NOT. That is why this is hand-rolled.
//
//   1 byte : 09 0A 0B 0C 0D 20
//   2 bytes: C2 85 (U+0085), C2 A0 (U+00A0)
//   3 bytes: E1 9A 80 (U+1680)
//            E2 80 80..8A (U+2000..U+200A), E2 80 A8/A9 (U+2028/9),
//            E2 80 AF (U+202F), E2 81 9F (U+205F), E3 80 80 (U+3000)

/**
 * Number of bytes of whitespace at `buf[i..]`, or 0 if `buf[i]` is not the
 * start of a Unicode whitespace character.
 *
 * @param {Uint8Array} buf
 * @param {number} i
 * @returns {number}
 */
function whitespaceRunAt(buf, i) {
  const b0 = buf[i];
  if (b0 === 0x20 || (b0 >= 0x09 && b0 <= 0x0d)) return 1;
  if (b0 < 0x80) return 0;
  const b1 = buf[i + 1];
  if (b0 === 0xc2) return b1 === 0x85 || b1 === 0xa0 ? 2 : 0;
  const b2 = buf[i + 2];
  if (b0 === 0xe1) return b1 === 0x9a && b2 === 0x80 ? 3 : 0;
  if (b0 === 0xe2) {
    if (b1 === 0x80) {
      if (b2 >= 0x80 && b2 <= 0x8a) return 3; // U+2000..U+200A
      if (b2 === 0xa8 || b2 === 0xa9) return 3; // U+2028, U+2029
      if (b2 === 0xaf) return 3; // U+202F
      return 0;
    }
    if (b1 === 0x81) return b2 === 0x9f ? 3 : 0; // U+205F
    return 0;
  }
  if (b0 === 0xe3) return b1 === 0x80 && b2 === 0x80 ? 3 : 0; // U+3000
  return 0;
}

/**
 * Byte offset of the first non-whitespace character — the start of the slice
 * Rust's `line.trim_start()` would return.
 *
 * @param {Uint8Array} buf
 * @returns {number}
 */
export function trimStartOffset(buf) {
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const run = whitespaceRunAt(buf, i);
    if (run === 0) return i;
    i += run;
  }
  return n;
}

/**
 * `char::is_whitespace()` restricted to the single-byte case, matching the
 * Rust expression `line[pos..pos + 1].chars().next().unwrap().is_whitespace()`.
 *
 * BUG-COMPAT: in Rust that slice PANICS when `buf[pos]` is a multi-byte lead
 * byte. The `contains_utf8` guard upstream makes it unreachable, so here we
 * simply report "not whitespace" rather than crash.
 *
 * @param {number} byte
 * @returns {boolean}
 */
export function isAsciiWhitespaceByte(byte) {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}
