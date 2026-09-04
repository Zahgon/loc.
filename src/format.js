// Table rendering. Every string here is byte-compared against the Rust
// binary's stdout by the differential harness, so widths, separators and the
// leading space/pipe characters are all significant.

export const LINESEP = "-".repeat(80);

/**
 * Rust's `Formatter::pad` measures width in CHARS (Unicode scalar values),
 * not UTF-16 code units. For an all-ASCII value this is the same as
 * `String.prototype.length`; for anything else it is not.
 *
 * @param {string} s
 * @returns {number}
 */
function charWidth(s) {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) i += 1;
    n += 1;
  }
  return n;
}

/**
 * `{: <width}` — left aligned. Rust never truncates when the value is wider
 * than the field, and neither do we.
 *
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
export function padRight(s, width) {
  const w = charWidth(s);
  return w >= width ? s : s + " ".repeat(width - w);
}

/**
 * `{: >width}` — right aligned.
 *
 * @param {string | number} value
 * @param {number} width
 * @returns {string}
 */
export function padLeft(value, width) {
  const s = String(value);
  const w = charWidth(s);
  return w >= width ? s : " ".repeat(width - w) + s;
}

/**
 * `" {0: <17} {1: >8} {2: >12} {3: >12} {4: >12} {5: >12}"`
 *
 * @param {string} language
 * @param {string | number} files
 * @param {string | number} lines
 * @param {string | number} blank
 * @param {string | number} comment
 * @param {string | number} code
 * @returns {string}
 */
export function summaryRow(language, files, lines, blank, comment, code) {
  return (
    " " +
    padRight(language, 17) +
    " " +
    padLeft(files, 8) +
    " " +
    padLeft(lines, 12) +
    " " +
    padLeft(blank, 12) +
    " " +
    padLeft(comment, 12) +
    " " +
    padLeft(code, 12)
  );
}

/**
 * `"|{0: <25} {1: >12} {2: >12} {3: >12} {4: >12}"`
 *
 * @param {string} path already passed through {@link lastNChars}
 * @param {string | number} lines
 * @param {string | number} blank
 * @param {string | number} comment
 * @param {string | number} code
 * @returns {string}
 */
export function fileRow(path, lines, blank, comment, code) {
  return (
    "|" +
    padRight(path, 25) +
    " " +
    padLeft(lines, 12) +
    " " +
    padLeft(blank, 12) +
    " " +
    padLeft(comment, 12) +
    " " +
    padLeft(code, 12)
  );
}

export const HEADER_ROW = summaryRow(
  "Language",
  "Files",
  "Lines",
  "Blank",
  "Comment",
  "Code",
);

/**
 * `last_n_chars`.
 *
 * BUG-COMPAT: the Rust original is
 *
 *     if s.len() <= n { return s }
 *     s.chars().skip(s.len() - n).collect()
 *
 * `s.len()` is the BYTE length but `.skip()` skips CHARS. For ASCII paths the
 * two coincide and you get the last `n` characters; for a path containing
 * multi-byte UTF-8 it over-skips and returns fewer than `n` characters,
 * possibly an empty string. Reproduced exactly.
 *
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
export function lastNChars(s, n) {
  const byteLen = Buffer.byteLength(s, "utf8");
  if (byteLen <= n) return s;
  return [...s].slice(byteLen - n).join("");
}
