// A port of `ignore::gitignore` (the `ignore` crate 0.4.18) plus the parts of
// `globset` it relies on.
//
// The rules that actually bite:
//   * the LAST matching pattern in a file wins, not the first;
//   * a pattern containing no `/` is implicitly prefixed with `**/`;
//   * a leading `/` anchors, a trailing `/` restricts the match to directories;
//   * `*` and `?` never cross `/` (globset's `literal_separator(true)`);
//   * `**/`, `/**` and `/**/` have their own expansions.

/** @typedef {"none" | "ignore" | "whitelist"} MatchResult */

/**
 * @typedef {object} Glob
 * @property {boolean} isWhitelist
 * @property {boolean} isOnlyDir
 * @property {RegExp} regex
 * @property {string} original
 */

/**
 * Escape a literal character for use in a regular expression.
 * @param {string} ch
 * @returns {string}
 */
function escapeLiteral(ch) {
  return /[.+*?()|[\]{}^$\\]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * Translate a globset glob (with `literal_separator` enabled) into a regex
 * source that must match the whole candidate path.
 *
 * @param {string} glob
 * @returns {string}
 */
export function globToRegexSource(glob) {
  let re = "^";
  let i = 0;
  const n = glob.length;

  while (i < n) {
    const ch = glob[i];

    if (ch === "\\") {
      const next = glob[i + 1];
      if (next === undefined) {
        re += "\\\\";
        i += 1;
      } else {
        re += escapeLiteral(next);
        i += 2;
      }
      continue;
    }

    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` at the very start: zero or more leading directories.
        if (i === 0 && glob[i + 2] === "/") {
          re += "(?:/?|.*/)";
          i += 3;
          continue;
        }
        // `/**` at the very end: everything below this directory.
        if (i > 0 && glob[i - 1] === "/" && i + 2 === n) {
          re = re.slice(0, -1); // the `/` was already emitted
          re += "/.*";
          i += 2;
          continue;
        }
        // `/**/` in the middle: zero or more intervening directories.
        if (i > 0 && glob[i - 1] === "/" && glob[i + 2] === "/") {
          re = re.slice(0, -1);
          re += "(?:/|/.*/)";
          i += 3;
          continue;
        }
        // Anything else collapses to a plain `*`.
        re += "[^/]*";
        i += 2;
        continue;
      }
      re += "[^/]*";
      i += 1;
      continue;
    }

    if (ch === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }

    if (ch === "[") {
      let j = i + 1;
      let negated = false;
      if (glob[j] === "!" || glob[j] === "^") {
        negated = true;
        j += 1;
      }
      let body = "";
      if (glob[j] === "]") {
        body += "\\]";
        j += 1;
      }
      while (j < n && glob[j] !== "]") {
        if (glob[j] === "\\") {
          body += "\\" + (glob[j + 1] ?? "\\");
          j += 2;
          continue;
        }
        if (glob[j] === "[" && glob[j + 1] === ":") {
          // POSIX character class, e.g. `[[:alpha:]]`.
          const close = glob.indexOf(":]", j + 2);
          if (close !== -1) {
            const name = glob.slice(j + 2, close);
            const expansion = /** @type {Record<string, string>} */ ({
              alnum: "a-zA-Z0-9",
              alpha: "a-zA-Z",
              digit: "0-9",
              lower: "a-z",
              upper: "A-Z",
              space: " \\t\\r\\n\\v\\f",
              blank: " \\t",
              punct: "!-/:-@\\[-`{-~",
              xdigit: "0-9a-fA-F",
              cntrl: "\\x00-\\x1f\\x7f",
              print: "\\x20-\\x7e",
              graph: "\\x21-\\x7e",
              word: "a-zA-Z0-9_",
            })[name];
            if (expansion !== undefined) {
              body += expansion;
              j = close + 2;
              continue;
            }
          }
        }
        body += glob[j] === "^" ? "\\^" : glob[j];
        j += 1;
      }
      if (j >= n) {
        // Unterminated class: treat the `[` literally, as globset does not.
        re += "\\[";
        i += 1;
        continue;
      }
      re += `[${negated ? "^" : ""}${body}]`;
      i = j + 1;
      continue;
    }

    re += escapeLiteral(ch);
    i += 1;
  }

  return re + "$";
}

/**
 * Parse one line of a gitignore file. Returns `null` for blanks and comments.
 *
 * @param {string} rawLine
 * @returns {Glob | null}
 */
export function parseGitignoreLine(rawLine) {
  let line = rawLine;
  if (line.startsWith("#")) return null;
  // Trailing whitespace is insignificant unless the line ends with an escaped
  // space (`foo\ `).
  if (!line.endsWith("\\ ")) line = line.replace(/\s+$/, "");
  if (line.length === 0) return null;

  const original = line;
  let isWhitelist = false;
  let isOnlyDir = false;
  let isAbsolute = false;

  if (line.startsWith("\\!") || line.startsWith("\\#")) {
    line = line.slice(1);
    isAbsolute = line.startsWith("/");
  } else {
    if (line.startsWith("!")) {
      isWhitelist = true;
      line = line.slice(1);
    }
    if (line.startsWith("/")) {
      line = line.slice(1);
      isAbsolute = true;
    }
  }

  if (line.endsWith("/")) {
    isOnlyDir = true;
    line = line.slice(0, -1);
  }
  if (line.length === 0) return null;

  let actual = line;
  if (!isAbsolute && !line.includes("/") && !actual.startsWith("**/")) {
    actual = `**/${actual}`;
  }
  // A trailing `/**` should match the contents of a directory but not the
  // directory itself, so force an extra component.
  if (actual.endsWith("/**")) actual = `${actual}/*`;

  return {
    isWhitelist,
    isOnlyDir,
    original,
    regex: new RegExp(globToRegexSource(actual)),
  };
}

/**
 * The compiled contents of a single ignore file, anchored at the directory
 * that contains it.
 */
export class Gitignore {
  /**
   * @param {string} root absolute directory the patterns are relative to
   * @param {readonly Glob[]} globs in file order
   */
  constructor(root, globs) {
    this.root = root.endsWith("/") ? root.slice(0, -1) : root;
    this.globs = globs;
  }

  /**
   * @param {string} absPath absolute, `/`-separated
   * @param {boolean} isDir
   * @returns {MatchResult}
   */
  matched(absPath, isDir) {
    if (this.globs.length === 0) return "none";

    let candidate;
    if (this.root === "" || this.root === "/") {
      candidate = absPath.replace(/^\//, "");
    } else if (absPath === this.root) {
      return "none";
    } else if (absPath.startsWith(this.root + "/")) {
      candidate = absPath.slice(this.root.length + 1);
    } else {
      return "none";
    }
    if (candidate.length === 0) return "none";

    // Last match wins.
    for (let i = this.globs.length - 1; i >= 0; i -= 1) {
      const glob = this.globs[i];
      if (glob.isOnlyDir && !isDir) continue;
      if (glob.regex.test(candidate)) {
        return glob.isWhitelist ? "whitelist" : "ignore";
      }
    }
    return "none";
  }
}

/** An always-`none` matcher, used when an ignore file is absent. */
export const EMPTY_GITIGNORE = new Gitignore("", []);

/**
 * Build a {@link Gitignore} from raw file contents.
 *
 * @param {string} root
 * @param {string} contents
 * @returns {Gitignore}
 */
export function gitignoreFromContents(root, contents) {
  /** @type {Glob[]} */
  const globs = [];
  for (const line of contents.split("\n")) {
    const glob = parseGitignoreLine(line.replace(/\r$/, ""));
    if (glob !== null) globs.push(glob);
  }
  return new Gitignore(root, globs);
}
