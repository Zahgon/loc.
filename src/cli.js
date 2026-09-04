// Port of `fn main()` from `src/main.rs`.

import { parseArgs, parseSort } from "./args.js";
import { mergeCount, newCount } from "./counter.js";
import {
  HEADER_ROW,
  LINESEP,
  fileRow,
  lastNChars,
  summaryRow,
} from "./format.js";
import { Lang, langDisplayName } from "./lang.js";
import { countFiles } from "./pool.js";
import { combineRegexes, compileRustRegex } from "./rust-regex.js";
import { walk } from "./walk.js";

/** @typedef {import("./counter.js").Count} Count */
/** @typedef {import("./pool.js").FileCount} FileCount */
/** @typedef {import("./args.js").Sort} Sort */
/** @typedef {import("./tables.js").LangName} LangName */

/**
 * @typedef {object} CliResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} code
 */

/**
 * Byte-wise string comparison, matching Rust's `str::cmp` (which compares the
 * UTF-8 encodings). `localeCompare` would order `C#`, `C++` and `C/C++ Header`
 * differently.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * @param {Sort} sort
 * @returns {(a: FileCount, b: FileCount) => number}
 */
function fileComparator(sort) {
  switch (sort) {
    case "Code":
      return (a, b) => b.count.code - a.count.code;
    case "Comment":
      return (a, b) => b.count.comment - a.count.comment;
    case "Blank":
      return (a, b) => b.count.blank - a.count.blank;
    case "Lines":
      return (a, b) => b.count.lines - a.count.lines;
    default:
      // `main.rs` panics here; the caller has already rejected this combination.
      throw new Error("Sorting by language or files when using the --files flag");
  }
}

/**
 * Run the CLI and capture everything it would print.
 *
 * @param {readonly string[]} argv arguments after the program name
 * @returns {Promise<CliResult>}
 */
export async function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.kind === "exit") {
    return {
      stdout: parsed.stdout ?? "",
      stderr: parsed.stderr ?? "",
      code: parsed.code,
    };
  }
  const matches = parsed.matches;

  const targets = matches.target.length > 0 ? matches.target : ["."];

  /** @type {Sort} */
  let sort = "Code";
  if (matches.sort !== null) {
    const result = parseSort(matches.sort);
    if (!result.ok) {
      // Note: stdout, and the process still exits 0. That is what Rust does.
      const first =
        result.suggestion !== null
          ? `Error: invalid value for --sort: '${matches.sort}', perhaps you meant '${result.suggestion}'?`
          : `Error: invalid value for --sort: '${matches.sort}'`;
      return {
        stdout:
          `${first}\n` +
          " Hint: legal values are Code, Comment, Blank, Lines, Language, and Files\n",
        stderr: "",
        code: 0,
      };
    }
    sort = result.sort;
  }

  const byFile = matches.files;

  if (byFile && (sort === "Language" || sort === "Files")) {
    return {
      stdout: "Error: cannot sort by Language or Files when --files is present\n",
      stderr: "",
      code: 0,
    };
  }

  const useIgnore = matches.unrestricted === 0;
  const ignoreHidden = matches.unrestricted <= 1;

  /** @type {RegExp | null} */
  let excludeRegex = null;
  if (matches.exclude.length > 0) {
    const compiled = compileRustRegex(combineRegexes(matches.exclude));
    if (!compiled.ok) {
      return {
        stdout: `Error processing exclude regex: ${compiled.message}\n`,
        stderr: "",
        code: 1,
      };
    }
    excludeRegex = compiled.regex;
  }

  /** @type {RegExp | null} */
  let includeRegex = null;
  if (matches.include.length > 0) {
    const compiled = compileRustRegex(combineRegexes(matches.include));
    if (!compiled.ok) {
      return {
        stdout: `Error processing include regex: ${compiled.message}\n`,
        stderr: "",
        code: 1,
      };
    }
    includeRegex = compiled.regex;
  }

  /** @type {string[]} */
  const paths = [];
  for (const target of targets) {
    for (const p of walk(target, { useIgnore, ignoreHidden })) {
      if (includeRegex !== null && !includeRegex.test(p)) continue;
      if (excludeRegex !== null && excludeRegex.test(p)) continue;
      paths.push(p);
    }
  }

  const filecounts = await countFiles(paths);

  /** @type {Map<LangName, FileCount[]>} */
  const byLang = new Map();
  for (const fc of filecounts) {
    const bucket = byLang.get(fc.lang);
    if (bucket === undefined) byLang.set(fc.lang, [fc]);
    else bucket.push(fc);
  }

  // Rust iterates a randomly-seeded HashMap here. We iterate in a stable
  // order so that repeated runs agree; see DIFFERENCES.md.
  const langs = [...byLang.keys()].sort((a, b) =>
    compareUtf8(langDisplayName(a), langDisplayName(b)),
  );

  /** @type {string[]} */
  const out = [];

  if (byFile) {
    out.push(LINESEP, HEADER_ROW, LINESEP);

    const cmp = fileComparator(sort);
    for (const lang of langs) {
      const filecountsForLang = /** @type {FileCount[]} */ (byLang.get(lang));
      const total = newCount();
      for (const fc of filecountsForLang) mergeCount(total, fc.count);

      out.push(LINESEP);
      out.push(
        summaryRow(
          langDisplayName(lang),
          filecountsForLang.length,
          total.lines,
          total.blank,
          total.comment,
          total.code,
        ),
      );

      const sorted = [...filecountsForLang].sort(cmp);

      out.push(LINESEP);
      for (const fc of sorted) {
        out.push(
          fileRow(
            lastNChars(fc.path, 25),
            fc.count.lines,
            fc.count.blank,
            fc.count.comment,
            fc.count.code,
          ),
        );
      }
    }
    // No trailing separator and no grand total in --files mode.
  } else {
    /** @type {{ lang: LangName, files: number, count: Count }[]} */
    const langTotals = langs.map((lang) => {
      const filecountsForLang = /** @type {FileCount[]} */ (byLang.get(lang));
      const total = newCount();
      for (const fc of filecountsForLang) mergeCount(total, fc.count);
      return { lang, files: filecountsForLang.length, count: total };
    });

    switch (sort) {
      case "Language":
        langTotals.sort((a, b) =>
          compareUtf8(langDisplayName(a.lang), langDisplayName(b.lang)),
        );
        break;
      case "Files":
        langTotals.sort((a, b) => b.files - a.files);
        break;
      case "Code":
        langTotals.sort((a, b) => b.count.code - a.count.code);
        break;
      case "Comment":
        langTotals.sort((a, b) => b.count.comment - a.count.comment);
        break;
      case "Blank":
        langTotals.sort((a, b) => b.count.blank - a.count.blank);
        break;
      case "Lines":
        langTotals.sort((a, b) => b.count.lines - a.count.lines);
        break;
    }

    out.push(LINESEP, HEADER_ROW, LINESEP);
    for (const t of langTotals) {
      out.push(
        summaryRow(
          langDisplayName(t.lang),
          t.files,
          t.count.lines,
          t.count.blank,
          t.count.comment,
          t.count.code,
        ),
      );
    }

    const totals = { files: 0, count: newCount() };
    for (const t of langTotals) {
      totals.files += t.files;
      mergeCount(totals.count, t.count);
    }

    out.push(LINESEP);
    out.push(
      summaryRow(
        "Total",
        totals.files,
        totals.count.lines,
        totals.count.blank,
        totals.count.comment,
        totals.count.code,
      ),
    );
    out.push(LINESEP);
  }

  return { stdout: out.map((line) => `${line}\n`).join(""), stderr: "", code: 0 };
}

/**
 * Entry point used by `bin/loc.js`.
 *
 * @param {readonly string[]} argv
 * @returns {Promise<void>}
 */
export async function main(argv) {
  const result = await run(argv);
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

export { Lang };
