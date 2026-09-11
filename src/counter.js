// Direct transliteration of `count()` from the Rust `src/lib.rs`.
//
// This file deliberately reads like the Rust original: same variable names,
// same control flow, same off-by-one quirks. Every index is a BYTE offset.
// Resist the urge to tidy it up — several of the oddities below are load
// bearing for output equivalence.

import { readFileSync } from "node:fs";

import { counterConfigForLang, langFromExt } from "./lang.js";
import {
  containsMultibyte,
  isAsciiWhitespaceByte,
  isCharBoundary,
  isValidUtf8,
  trimStartOffset,
} from "./utf8.js";

/** @typedef {import("./tables.js").LangName} LangName */
/** @typedef {import("./lang.js").CommentConfig} CommentConfig */

/**
 * @typedef {object} Count
 * @property {number} code
 * @property {number} comment
 * @property {number} blank
 * @property {number} lines
 */

/**
 * `Count::default()`.
 * @returns {Count}
 */
export function newCount() {
  return { code: 0, comment: 0, blank: 0, lines: 0 };
}

/**
 * `Count::merge`.
 * @param {Count} self
 * @param {Count} other
 * @returns {Count} `self`, mutated
 */
export function mergeCount(self, other) {
  self.code += other.code;
  self.comment += other.comment;
  self.blank += other.blank;
  self.lines += other.lines;
  return self;
}

/**
 * `line.starts_with(needle)` at an arbitrary byte offset.
 *
 * @param {Uint8Array} line
 * @param {Uint8Array} needle
 * @param {number} pos
 * @returns {boolean}
 */
function eqAt(line, needle, pos) {
  const n = needle.length;
  if (pos + n > line.length) return false;
  for (let i = 0; i < n; i += 1) {
    if (line[pos + i] !== needle[i]) return false;
  }
  return true;
}

/**
 * The body of `count()`, split out so it can be driven from a Buffer directly
 * (tests, benchmarks) without touching the filesystem.
 *
 * @param {Buffer} bytes complete file contents
 * @param {CommentConfig} config
 * @returns {Count}
 */
export function countBuffer(bytes, config) {
  const c = newCount();

  // Rust validates each line individually and bails out with `Count::default()`
  // on the first invalid one, discarding everything counted so far. Because
  // 0x0A can never be a UTF-8 continuation byte, "every line is valid" is
  // exactly equivalent to "the whole buffer is valid" — and the discard makes
  // the partial progress unobservable. So one up-front check suffices.
  if (!isValidUtf8(bytes)) return newCount();

  const singles = config.singles;
  const multis = config.multis;
  const nSingles = singles.length;
  const nMultis = multis.length;

  /** @type {{ start: Uint8Array, end: Uint8Array }[]} */
  const multiStack = [];

  const total = bytes.length;
  let cursor = 0;

  // `ByteLines`: split on '\n', keep any '\r', yield a trailing partial line,
  // and yield nothing for an empty buffer.
  lineLoop: while (cursor < total) {
    const nl = bytes.indexOf(0x0a, cursor);
    const lineStart = cursor;
    /** @type {number} */
    let lineEnd;
    if (nl === -1) {
      lineEnd = total;
      cursor = total;
    } else {
      lineEnd = nl;
      cursor = nl + 1;
    }

    c.lines += 1;

    const rawLine = bytes.subarray(lineStart, lineEnd);
    const trimOffset = trimStartOffset(rawLine);
    const line =
      trimOffset === 0 ? rawLine : rawLine.subarray(trimOffset);
    const lineLen = line.length;

    // Blanks inside a multi-line comment count as blank, not comment.
    if (lineLen === 0) {
      c.blank += 1;
      continue lineLoop;
    }

    if (multiStack.length === 0) {
      for (let si = 0; si < nSingles; si += 1) {
        if (eqAt(line, singles[si], 0)) {
          // If this single_start is a prefix of a multi_start, the line is
          // really the opening of a block comment. Note this `break` abandons
          // the remaining singles and falls through to the scanner below —
          // it is NOT a `continue` to the next line.
          let startsWithMulti = false;
          for (let mi = 0; mi < nMultis; mi += 1) {
            if (eqAt(line, multis[mi].start, 0)) {
              startsWithMulti = true;
              break;
            }
          }
          if (startsWithMulti) break;

          c.comment += 1;
          continue lineLoop;
        }
      }

      if (nMultis === 0) {
        c.code += 1;
        continue lineLoop;
      }
    }

    if (multiStack.length === 0) {
      let touchesMulti = false;
      for (let mi = 0; mi < nMultis; mi += 1) {
        if (
          line.indexOf(multis[mi].start) !== -1 ||
          line.indexOf(multis[mi].end) !== -1
        ) {
          touchesMulti = true;
          break;
        }
      }
      if (!touchesMulti) {
        c.code += 1;
        continue lineLoop;
      }
    }

    let pos = 0;
    let foundCode = 0;
    const containsUtf8 = containsMultibyte(line);

    outer: while (pos < lineLen) {
      for (let mi = 0; mi < nMultis; mi += 1) {
        const multi = multis[mi];
        const startLen = multi.start.length;
        const endLen = multi.end.length;

        // Upstream comment: "this is almost certainly giving us incorrect
        // results". It is. Reproduced verbatim.
        if (containsUtf8) {
          const span = Math.min(
            Math.max(startLen, endLen) + 1,
            lineLen - pos,
          );
          let skipped = false;
          for (let i = pos; i < pos + span; i += 1) {
            if (!isCharBoundary(line, i)) {
              pos += 1;
              skipped = true;
              break;
            }
          }
          if (skipped) continue outer;
        }

        if (pos + startLen <= lineLen && eqAt(line, multi.start, pos)) {
          pos += startLen;
          multiStack.push(multi);
          // Continues the INNER loop: the next multi is tested at the new
          // `pos` without the trailing `pos += 1`.
          continue;
        }

        if (multiStack.length > 0) {
          const end = multiStack[multiStack.length - 1].end;
          if (pos + end.length <= lineLen && eqAt(line, end, pos)) {
            multiStack.pop();
            pos += end.length;
          }
        } else if (pos < lineLen && !isAsciiWhitespaceByte(line[pos])) {
          foundCode += 1;
        }
      }
      pos += 1;
    }

    // `found_code` is bumped once per multi per position, hence `>=` against
    // the number of multis rather than `> 0`.
    if (foundCode >= nMultis) {
      c.code += 1;
    } else {
      c.comment += 1;
    }
  }

  return c;
}

/**
 * `count(filepath)`.
 *
 * Any failure to read the file yields an all-zero `Count`, exactly as Rust
 * does for a failed `File::open`.
 *
 * @param {string} filepath
 * @param {LangName} [lang] pre-computed language, to avoid re-deriving it
 * @returns {Count}
 */
export function count(filepath, lang) {
  const resolved = lang ?? langFromExt(filepath);
  const config = counterConfigForLang(resolved);

  /** @type {Buffer} */
  let bytes;
  try {
    bytes = readFileSync(filepath);
  } catch {
    return newCount();
  }

  return countBuffer(bytes, config);
}
