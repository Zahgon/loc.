#!/usr/bin/env node
// Mechanically extract the three big lookup tables from the Rust source so the
// JS port cannot drift from `src/lib.rs` through transcription errors.
//
//   node tools/gen-tables.mjs <path-to-rust-loc-repo> [--check]
//
// Without --check the generated file is written to src/tables.js.
// With --check the generated content is diffed against the committed file and
// the process exits 1 on any difference.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_RUST_REPO = path.resolve(__dirname, "../source_rust");

/**
 * Strip Rust `//` line comments while respecting string literals.
 * @param {string} src
 * @returns {string}
 */
function stripLineComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      out += ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Unescape a Rust string literal body (the text between the quotes).
 * @param {string} body
 * @returns {string}
 */
function unescapeRust(body) {
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    i += 1;
    const e = body[i];
    if (e === "n") out += "\n";
    else if (e === "t") out += "\t";
    else if (e === "r") out += "\r";
    else if (e === "0") out += "\0";
    else if (e === "\\") out += "\\";
    else if (e === '"') out += '"';
    else if (e === "'") out += "'";
    else if (e === "x") {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === "u") {
      const close = body.indexOf("}", i);
      out += String.fromCodePoint(parseInt(body.slice(i + 2, close), 16));
      i = close;
    } else {
      throw new Error(`unhandled escape \\${e} in ${JSON.stringify(body)}`);
    }
  }
  return out;
}

/**
 * Read a string literal starting at `src[i] === '"'`.
 * @param {string} src
 * @param {number} i
 * @returns {{ value: string, next: number }}
 */
function readString(src, i) {
  if (src[i] !== '"') throw new Error(`expected '"' at ${i}`);
  let j = i + 1;
  let body = "";
  while (j < src.length) {
    if (src[j] === "\\") {
      body += src[j] + src[j + 1];
      j += 2;
      continue;
    }
    if (src[j] === '"') return { value: unescapeRust(body), next: j + 1 };
    body += src[j];
    j += 1;
  }
  throw new Error("unterminated string literal");
}

/**
 * Split `src` on `sep` characters that sit at bracket depth 0, skipping strings.
 * @param {string} src
 * @param {string} sep
 * @returns {string[]}
 */
function splitTopLevel(src, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      i = readString(src, i).next;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (depth === 0 && src.startsWith(sep, i)) {
      parts.push(src.slice(start, i));
      i += sep.length;
      start = i;
      continue;
    }
    i += 1;
  }
  parts.push(src.slice(start));
  return parts;
}

/**
 * Extract the balanced body of a block that starts at the first `{` at or after `from`.
 * @param {string} src
 * @param {number} from
 * @returns {{ body: string, end: number }}
 */
function balancedBlock(src, from) {
  const open = src.indexOf("{", from);
  if (open === -1) throw new Error("no block found");
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      i = readString(src, i).next;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
    }
    i += 1;
  }
  throw new Error("unbalanced block");
}

/**
 * Split a Rust `match` body into `{ patterns, value }` arms.
 * @param {string} body
 * @returns {{ patterns: string[], value: string }[]}
 */
function parseMatchArms(body) {
  /** @type {{ patterns: string[], value: string }[]} */
  const arms = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i += 1;
    if (i >= body.length) break;

    // Pattern runs until the `=>` at depth 0.
    const patStart = i;
    let depth = 0;
    while (i < body.length) {
      const ch = body[i];
      if (ch === '"') {
        i = readString(body, i).next;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      else if (depth === 0 && body.startsWith("=>", i)) break;
      i += 1;
    }
    if (i >= body.length) break;
    const patterns = splitTopLevel(body.slice(patStart, i), "|").map((s) =>
      s.trim(),
    );
    i += 2;

    // Value runs until a `,` at depth 0, or the end of a `{ ... }` block arm.
    while (i < body.length && /\s/.test(body[i])) i += 1;
    const valStart = i;
    if (body[i] === "{") {
      const blk = balancedBlock(body, i);
      i = blk.end;
      arms.push({ patterns, value: body.slice(valStart, i).trim() });
      while (i < body.length && /[\s,]/.test(body[i])) i += 1;
      continue;
    }
    depth = 0;
    while (i < body.length) {
      const ch = body[i];
      if (ch === '"') {
        i = readString(body, i).next;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      else if (depth === 0 && ch === ",") break;
      i += 1;
    }
    arms.push({ patterns, value: body.slice(valStart, i).trim() });
    i += 1;
  }
  return arms;
}

/**
 * Parse `smallvec![...]` into its top-level element source strings.
 * @param {string} expr
 * @returns {string[]}
 */
function smallvecItems(expr) {
  const trimmed = expr.trim();
  const marker = "smallvec!";
  if (!trimmed.startsWith(marker)) {
    throw new Error(`expected smallvec!, got ${JSON.stringify(trimmed)}`);
  }
  const open = trimmed.indexOf("[", marker.length);
  const close = trimmed.lastIndexOf("]");
  const inner = trimmed.slice(open + 1, close);
  return splitTopLevel(inner, ",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** @param {string} lit */
function parseStringLiteral(lit) {
  const { value, next } = readString(lit.trim(), 0);
  if (next !== lit.trim().length) {
    throw new Error(`trailing junk in string literal ${JSON.stringify(lit)}`);
  }
  return value;
}

/** @param {string} lit */
function parseStringPair(lit) {
  const trimmed = lit.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    throw new Error(`expected tuple, got ${JSON.stringify(lit)}`);
  }
  const parts = splitTopLevel(trimmed.slice(1, -1), ",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length !== 2) {
    throw new Error(`expected 2-tuple, got ${JSON.stringify(lit)}`);
  }
  return [parseStringLiteral(parts[0]), parseStringLiteral(parts[1])];
}

// ---------------------------------------------------------------------------

const rustRepo = process.argv[2]?.startsWith("--")
  ? DEFAULT_RUST_REPO
  : (process.argv[2] ?? DEFAULT_RUST_REPO);
const check = process.argv.includes("--check");

const raw = readFileSync(path.join(rustRepo, "src/lib.rs"), "utf8");
const src = stripLineComments(raw);

// --- 1. Lang variants -------------------------------------------------------
const enumStart = src.indexOf("pub enum Lang");
const enumBody = balancedBlock(src, enumStart).body;
const variants = enumBody
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// --- 2. Display names -------------------------------------------------------
const toSStart = src.indexOf("pub fn to_s(&self) -> &str");
const toSMatch = src.indexOf("match *self", toSStart);
const toSBody = balancedBlock(src, toSMatch).body;
/** @type {Map<string, string>} */
const displayNames = new Map();
for (const arm of parseMatchArms(toSBody)) {
  for (const p of arm.patterns) displayNames.set(p, parseStringLiteral(arm.value));
}

// --- 3. Extension table -----------------------------------------------------
const extMatch = src.indexOf("match &*ext");
const extBody = balancedBlock(src, extMatch).body;
/** @type {[string, string][]} */
const extEntries = [];
for (const arm of parseMatchArms(extBody)) {
  if (arm.patterns.length === 1 && arm.patterns[0] === "_") continue;
  for (const p of arm.patterns) extEntries.push([parseStringLiteral(p), arm.value]);
}

// --- 4. Comment configs -----------------------------------------------------
const cfgStart = src.indexOf("pub fn counter_config_for_lang");
const cfgFnBody = balancedBlock(src, cfgStart).body;

/** @type {Map<string, string>} */
const aliases = new Map();
for (const line of cfgFnBody.split("\n")) {
  const m = line.match(/^\s*let\s+(\w+)\s*=\s*(\(.*\));\s*$/);
  if (m) aliases.set(m[1], m[2]);
}

const cfgMatch = cfgFnBody.indexOf("match lang");
const cfgBody = balancedBlock(cfgFnBody, cfgMatch).body;

/**
 * @param {string} expr
 * @returns {{ singles: string[], multis: [string, string][] }}
 */
function parseConfigValue(expr) {
  let e = expr.trim();
  if (e.startsWith("{") && e.endsWith("}")) e = e.slice(1, -1).trim();
  if (e.endsWith(",")) e = e.slice(0, -1).trim();
  if (aliases.has(e)) e = aliases.get(e) ?? e;
  if (!e.startsWith("(")) throw new Error(`unknown config value ${JSON.stringify(expr)}`);
  const parts = splitTopLevel(e.slice(1, -1), ",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length !== 2) throw new Error(`expected (singles, multis): ${e}`);
  return {
    singles: smallvecItems(parts[0]).map(parseStringLiteral),
    multis: /** @type {[string, string][]} */ (
      smallvecItems(parts[1]).map(parseStringPair)
    ),
  };
}

/** @type {Map<string, { singles: string[], multis: [string, string][] }>} */
const configs = new Map();
for (const arm of parseMatchArms(cfgBody)) {
  if (arm.value.includes("unreachable!")) continue;
  const parsed = parseConfigValue(arm.value);
  for (const p of arm.patterns) configs.set(p, parsed);
}

// --- 5. Shebangs ------------------------------------------------------------
const shebangStart = src.indexOf("fn check_shebang");
const shebangFn = balancedBlock(src, shebangStart).body;
const shebangMatch = shebangFn.indexOf("match first_line");
const shebangBody = balancedBlock(shebangFn, shebangMatch).body;
/** @type {[string, string][]} */
const shebangEntries = [];
for (const arm of parseMatchArms(shebangBody)) {
  if (arm.patterns.length === 1 && arm.patterns[0] === "_") continue;
  for (const p of arm.patterns) {
    shebangEntries.push([parseStringLiteral(p), parseStringLiteral(arm.value)]);
  }
}

// --- 6. Validate ------------------------------------------------------------
const problems = [];
for (const v of variants) {
  if (!displayNames.has(v)) problems.push(`Lang::${v} has no to_s() arm`);
  if (v !== "Unrecognized" && !configs.has(v)) {
    problems.push(`Lang::${v} has no counter_config_for_lang arm`);
  }
}
for (const k of displayNames.keys()) {
  if (!variants.includes(k)) problems.push(`to_s() mentions unknown Lang::${k}`);
}
for (const k of configs.keys()) {
  if (!variants.includes(k)) problems.push(`config mentions unknown Lang::${k}`);
}
for (const [ext, lang] of extEntries) {
  if (!variants.includes(lang)) problems.push(`ext "${ext}" -> unknown Lang::${lang}`);
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

// --- 7. Emit ----------------------------------------------------------------
/** @param {unknown} v */
const j = (v) => JSON.stringify(v);

const lines = [];
lines.push("// @generated by tools/gen-tables.mjs from the Rust source `src/lib.rs`.");
lines.push("// Do not edit by hand. Run `npm run gen:tables` to regenerate and");
lines.push("// `npm run check:tables` to verify this file is still in sync.");
lines.push("");
lines.push("/**");
lines.push(" * Every `Lang` variant, in Rust declaration order. Values are the Rust");
lines.push(" * identifiers so JS/Rust cross-references stay greppable.");
lines.push(" */");
lines.push("export const Lang = Object.freeze({");
for (const v of variants) lines.push(`  ${v}: ${j(v)},`);
lines.push("});");
lines.push("");
lines.push("/** @typedef {(typeof Lang)[keyof typeof Lang]} LangName */");
lines.push("");
lines.push("/** Rust `Lang::to_s()`. @type {Readonly<Record<string, string>>} */");
lines.push("export const LANG_DISPLAY_NAME = Object.freeze({");
for (const v of variants) lines.push(`  ${v}: ${j(displayNames.get(v))},`);
lines.push("});");
lines.push("");
lines.push("/** Rust `lang_from_ext` match table. @type {Readonly<Record<string, LangName>>} */");
lines.push("export const EXT_TO_LANG = Object.freeze({");
for (const [ext, lang] of extEntries) lines.push(`  ${j(ext)}: ${j(lang)},`);
lines.push("});");
lines.push("");
lines.push("/**");
lines.push(" * Rust `counter_config_for_lang`. `Unrecognized` is deliberately absent:");
lines.push(" * the Rust arm is `unreachable!()`.");
lines.push(" * @type {Readonly<Record<string, { singles: readonly string[], multis: readonly (readonly [string, string])[] }>>}");
lines.push(" */");
lines.push("export const COMMENT_CONFIG = Object.freeze({");
for (const v of variants) {
  const cfg = configs.get(v);
  if (!cfg) continue;
  const singles = `[${cfg.singles.map(j).join(", ")}]`;
  const multis = `[${cfg.multis.map(([a, b]) => `[${j(a)}, ${j(b)}]`).join(", ")}]`;
  lines.push(`  ${v}: { singles: ${singles}, multis: ${multis} },`);
}
lines.push("});");
lines.push("");
lines.push("/** Rust `check_shebang` match table. @type {Readonly<Record<string, string>>} */");
lines.push("export const SHEBANG_TO_EXT = Object.freeze({");
for (const [line, ext] of shebangEntries) lines.push(`  ${j(line)}: ${j(ext)},`);
lines.push("});");
lines.push("");

const generated = lines.join("\n");
const outPath = path.resolve(__dirname, "../src/tables.js");

if (check) {
  let existing = "";
  try {
    existing = readFileSync(outPath, "utf8");
  } catch {
    console.error(`missing ${outPath}`);
    process.exit(1);
  }
  if (existing !== generated) {
    console.error("src/tables.js is out of sync with the Rust source.");
    console.error("Run `npm run gen:tables`.");
    process.exit(1);
  }
  console.log(
    `tables in sync: ${variants.length} langs, ${extEntries.length} extensions, ` +
      `${configs.size} comment configs, ${shebangEntries.length} shebangs`,
  );
} else {
  writeFileSync(outPath, generated);
  console.log(
    `wrote ${outPath}: ${variants.length} langs, ${extEntries.length} extensions, ` +
      `${configs.size} comment configs, ${shebangEntries.length} shebangs`,
  );
}
