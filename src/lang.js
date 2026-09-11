// Port of `lang_from_ext`, `check_shebang` and `counter_config_for_lang`.

import { readFileSync } from "node:fs";

import {
  COMMENT_CONFIG,
  EXT_TO_LANG,
  LANG_DISPLAY_NAME,
  Lang,
  SHEBANG_TO_EXT,
} from "./tables.js";
import { rustExtension, rustFileName } from "./path.js";
import { isValidUtf8 } from "./utf8.js";

export { Lang };
/** @typedef {import("./tables.js").LangName} LangName */

// Maps rather than raw objects so that a file called `constructor.foo` cannot
// resolve to `Object.prototype.constructor`.
const EXT_MAP = new Map(Object.entries(EXT_TO_LANG));
const SHEBANG_MAP = new Map(Object.entries(SHEBANG_TO_EXT));
const DISPLAY_MAP = new Map(Object.entries(LANG_DISPLAY_NAME));

/**
 * @typedef {object} CommentConfig
 * @property {readonly Uint8Array[]} singles
 * @property {readonly { start: Uint8Array, end: Uint8Array }[]} multis
 * @property {readonly string[]} singleStrings
 * @property {readonly (readonly [string, string])[]} multiStrings
 */

/** @type {Map<string, CommentConfig>} */
const CONFIG_MAP = new Map(
  Object.entries(COMMENT_CONFIG).map(([lang, cfg]) => [
    lang,
    {
      singles: cfg.singles.map((s) => Buffer.from(s, "utf8")),
      multis: cfg.multis.map(([start, end]) => ({
        start: Buffer.from(start, "utf8"),
        end: Buffer.from(end, "utf8"),
      })),
      singleStrings: cfg.singles,
      multiStrings: cfg.multis,
    },
  ]),
);

/**
 * `Lang::to_s()`.
 * @param {LangName} lang
 * @returns {string}
 */
export function langDisplayName(lang) {
  const name = DISPLAY_MAP.get(lang);
  if (name === undefined) throw new Error(`unknown Lang: ${String(lang)}`);
  return name;
}

/**
 * `counter_config_for_lang`.
 *
 * BUG-COMPAT: the Rust arm for `Unrecognized` is `unreachable!()`, i.e. a
 * panic. `main` never reaches it because unrecognised files are filtered out
 * before counting; calling it directly is a programming error either way.
 *
 * @param {LangName} lang
 * @returns {CommentConfig}
 */
export function counterConfigForLang(lang) {
  const cfg = CONFIG_MAP.get(lang);
  if (cfg === undefined) {
    throw new Error(`counterConfigForLang: unreachable for Lang::${String(lang)}`);
  }
  return cfg;
}

/**
 * `check_shebang`.
 *
 * Reads the whole file (as Rust does), requires it to be valid UTF-8, takes
 * the first line the way `str::lines()` would (split on `\n`, drop a trailing
 * `\r`) and matches it against a fixed table by EXACT equality.
 *
 * @param {string} filepath
 * @returns {string | null}
 */
export function checkShebang(filepath) {
  /** @type {Buffer} */
  let bytes;
  try {
    bytes = readFileSync(filepath);
  } catch {
    return null;
  }
  if (!isValidUtf8(bytes)) return null;

  // `"".lines()` yields nothing, so an empty file has no first line.
  if (bytes.length === 0) return null;

  const nl = bytes.indexOf(0x0a);
  let end = nl === -1 ? bytes.length : nl;
  if (end > 0 && bytes[end - 1] === 0x0d) end -= 1;
  const firstLine = bytes.toString("utf8", 0, end);

  return SHEBANG_MAP.get(firstLine) ?? null;
}

/**
 * `lang_from_ext`.
 *
 * @param {string} filepath
 * @returns {LangName}
 */
export function langFromExt(filepath) {
  const fileName = rustFileName(filepath);
  if (fileName === null) throw new Error("no filename?");
  const fileNameLower = fileName.toLowerCase();

  /** @type {string} */
  let ext;
  if (fileNameLower.includes("makefile")) {
    ext = "makefile";
  } else if (fileNameLower === "dockerfile") {
    ext = "docker";
  } else if (fileNameLower === "cmakelists.txt") {
    ext = "cmake";
  } else {
    const raw = rustExtension(filepath);
    if (raw !== null) {
      ext = raw.toLowerCase();
    } else {
      ext = checkShebang(filepath) ?? fileNameLower;
    }
  }

  return EXT_MAP.get(ext) ?? Lang.Unrecognized;
}
