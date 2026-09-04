// Public API, mirroring the `loc` Rust library crate.

export { Lang, LANG_DISPLAY_NAME, EXT_TO_LANG, COMMENT_CONFIG, SHEBANG_TO_EXT } from "./tables.js";
export { langFromExt, langDisplayName, counterConfigForLang, checkShebang } from "./lang.js";
export { count, countBuffer, newCount, mergeCount } from "./counter.js";
export { rustExtension, rustFileName } from "./path.js";
export { walk } from "./walk.js";
export { run } from "./cli.js";
export {
  LINESEP,
  HEADER_ROW,
  summaryRow,
  fileRow,
  lastNChars,
  padLeft,
  padRight,
} from "./format.js";
export { parseArgs, parseSort, editDistance, HELP_TEXT, VERSION } from "./args.js";
export { compileRustRegex, combineRegexes } from "./rust-regex.js";

/** @typedef {import("./counter.js").Count} Count */
/** @typedef {import("./tables.js").LangName} LangName */
/** @typedef {import("./pool.js").FileCount} FileCount */
