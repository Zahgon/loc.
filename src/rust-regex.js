// A compatibility shim between the Rust `regex` crate and JS `RegExp`.
//
// The two engines disagree in both directions:
//
//   * Rust REJECTS look-around and backreferences; JS accepts them. Patterns
//     using them must fail here exactly as they do in Rust, otherwise `loc-js`
//     would silently accept input the original rejects.
//   * Rust's `\d` / `\w` / `\s` are Unicode-aware by default; JS's are ASCII.
//     We translate them to the equivalent Unicode property escapes and compile
//     with the `u` flag, falling back to the literal pattern when that fails.
//   * Rust supports inline flags such as `(?i)`; JS has no such syntax, so a
//     leading flag group is lifted onto the `RegExp` flags.
//
// Both engines default to "unanchored search", `.` not matching `\n`, and
// `^`/`$` binding to the whole haystack, so no translation is needed there.

/**
 * @typedef {object} RegexOk
 * @property {true} ok
 * @property {RegExp} regex
 */

/**
 * @typedef {object} RegexErr
 * @property {false} ok
 * @property {string} message the full multi-line `regex parse error: ...` text
 */

/** @typedef {RegexOk | RegexErr} RegexResult */

/**
 * Render a Rust `regex-syntax` style diagnostic.
 *
 * @param {string} pattern
 * @param {number} start caret offset
 * @param {number} len number of carets
 * @param {string} message
 * @returns {RegexErr}
 */
function parseError(pattern, start, len, message) {
  return {
    ok: false,
    message:
      "regex parse error:\n" +
      `    ${pattern}\n` +
      `    ${" ".repeat(start)}${"^".repeat(Math.max(len, 1))}\n` +
      `error: ${message}`,
  };
}

/**
 * Detect the constructs Rust's engine rejects outright, plus the structural
 * errors it reports most often, so that the common failures produce
 * byte-identical diagnostics.
 *
 * @param {string} p
 * @returns {RegexErr | null}
 */
function findRustSyntaxError(p) {
  /** @type {number[]} */
  const openGroups = [];
  let classStart = -1;
  let i = 0;

  while (i < p.length) {
    const ch = p[i];

    if (ch === "\\") {
      const next = p[i + 1];
      if (next === undefined) {
        return parseError(p, i, 1, "incomplete escape sequence");
      }
      if (classStart === -1 && next >= "1" && next <= "9") {
        return parseError(p, i, 2, "backreferences are not supported");
      }
      i += 2;
      continue;
    }

    if (classStart !== -1) {
      if (ch === "]" && i > classStart + 1) classStart = -1;
      i += 1;
      continue;
    }

    if (ch === "[") {
      classStart = i;
      i += 1;
      continue;
    }

    if (ch === "(") {
      if (p.startsWith("(?=", i) || p.startsWith("(?!", i)) {
        return parseError(
          p,
          i + 1,
          2,
          "look-around, including look-ahead and look-behind, is not supported",
        );
      }
      if (p.startsWith("(?<=", i) || p.startsWith("(?<!", i)) {
        return parseError(
          p,
          i + 1,
          3,
          "look-around, including look-ahead and look-behind, is not supported",
        );
      }
      openGroups.push(i);
      i += 1;
      continue;
    }

    if (ch === ")") {
      if (openGroups.length === 0) {
        return parseError(p, i, 1, "unopened group");
      }
      openGroups.pop();
      i += 1;
      continue;
    }

    if (ch === "{") {
      const close = p.indexOf("}", i);
      const body = close === -1 ? null : p.slice(i + 1, close);
      if (body !== null && /^\d+(,\d*)?$/.test(body)) {
        const [minText, maxText] = body.split(",");
        if (maxText !== undefined && maxText !== "") {
          if (Number(minText) > Number(maxText)) {
            return parseError(
              p,
              i,
              close - i + 1,
              "invalid repetition count range, the start must be <= the end",
            );
          }
        }
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  if (classStart !== -1) {
    return parseError(p, classStart, 1, "unclosed character class");
  }
  if (openGroups.length > 0) {
    return parseError(p, openGroups[0], 1, "unclosed group");
  }
  return null;
}

/**
 * Lift a leading Rust inline flag group, e.g. `(?is)foo`, onto RegExp flags.
 *
 * @param {string} p
 * @returns {{ pattern: string, flags: string } | null} null when unsupported
 */
function liftInlineFlags(p) {
  const m = p.match(/^\(\?([imsuxU]+)\)/);
  if (m === null) return { pattern: p, flags: "" };

  let flags = "";
  for (const f of m[1]) {
    if (f === "i") flags += "i";
    else if (f === "s") flags += "s";
    else if (f === "m") flags += "m";
    else if (f === "u") continue; // Unicode is JS's default with the u flag
    else return null; // `x` (verbose) and `U` (swap greedy) are not emulated
  }
  return { pattern: p.slice(m[0].length), flags };
}

const UNICODE_WORD =
  "\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}";

/**
 * Rewrite the ASCII-by-default JS perl classes into Rust's Unicode-aware
 * equivalents. Only valid when compiled with the `u` flag.
 *
 * @param {string} p
 * @returns {string}
 */
function unicodeClasses(p) {
  let out = "";
  let inClass = false;
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "\\") {
      const next = p[i + 1];
      if (next === "d") out += inClass ? "\\p{Nd}" : "[\\p{Nd}]";
      else if (next === "D") out += inClass ? "\\D" : "[^\\p{Nd}]";
      else if (next === "w") out += inClass ? UNICODE_WORD : `[${UNICODE_WORD}]`;
      else if (next === "W") out += inClass ? "\\W" : `[^${UNICODE_WORD}]`;
      else if (next === "s") out += inClass ? "\\p{White_Space}" : "[\\p{White_Space}]";
      else if (next === "S") out += inClass ? "\\S" : "[^\\p{White_Space}]";
      else out += ch + (next ?? "");
      i += 2;
      continue;
    }
    if (!inClass && ch === "[") inClass = true;
    else if (inClass && ch === "]") inClass = false;
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Compile a Rust-flavoured regex into a `RegExp`.
 *
 * @param {string} pattern the already-combined `(a)|(b)` source
 * @returns {RegexResult}
 */
export function compileRustRegex(pattern) {
  const rustError = findRustSyntaxError(pattern);
  if (rustError !== null) return rustError;

  const lifted = liftInlineFlags(pattern);
  if (lifted === null) {
    return parseError(
      pattern,
      0,
      pattern.indexOf(")") + 1,
      "this inline flag is not supported by loc-js",
    );
  }

  // Preferred: Unicode-correct semantics matching the Rust crate.
  try {
    return { ok: true, regex: new RegExp(unicodeClasses(lifted.pattern), lifted.flags + "u") };
  } catch {
    /* fall through */
  }

  // Some valid Rust patterns (redundant escapes, lone surrogates in classes,
  // ...) are rejected by JS in `u` mode. Retry without it.
  try {
    return { ok: true, regex: new RegExp(lifted.pattern, lifted.flags) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `regex parse error:\n    ${pattern}\n    ^\nerror: ${detail}`,
    };
  }
}

/**
 * Combine repeated `--include` / `--exclude` values the way `main.rs` does:
 * each value is wrapped in its own group and the groups are joined with `|`.
 *
 * @param {readonly string[]} values
 * @returns {string}
 */
export function combineRegexes(values) {
  return values.map((r) => `(${r})`).join("|");
}
