#!/usr/bin/env node
// Differential harness: the real acceptance gate for this port.
//
// Builds the original Rust binary, then runs both implementations over a
// corpus of repositories with a matrix of argument combinations and compares
// stdout, stderr and exit codes.
//
// Usage:
//   node test/differential/run.mjs
//
// Environment:
//   LOC_RUST_REPO   path to the Rust `loc` checkout (default: ./source_rust)
//   LOC_RUST_BIN    path to a prebuilt binary, skipping `cargo build`
//   LOC_DIFF_CORPUS `:`-separated list of directories to run against
//   LOC_DIFF_QUICK  set to 1 to use a reduced argv matrix

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "../..");
const JS_BIN = path.join(PKG_ROOT, "bin/loc.js");

const RUST_REPO =
  process.env.LOC_RUST_REPO ?? path.resolve(PKG_ROOT, "source_rust");

/** @returns {string | null} */
function resolveRustBinary() {
  if (process.env.LOC_RUST_BIN) return process.env.LOC_RUST_BIN;
  const built = path.join(RUST_REPO, "target/release/loc");
  if (existsSync(built)) return built;
  if (!existsSync(path.join(RUST_REPO, "Cargo.toml"))) return null;
  if (spawnSync("cargo", ["--version"], { stdio: "ignore" }).status !== 0) {
    return null;
  }
  process.stderr.write(`building the Rust reference binary in ${RUST_REPO}\n`);
  const build = spawnSync("cargo", ["build", "--release"], {
    cwd: RUST_REPO,
    stdio: "inherit",
  });
  return build.status === 0 && existsSync(built) ? built : null;
}

const RUST_BIN = resolveRustBinary();

// The oracle is the original Rust binary. Without a Rust toolchain or a
// prebuilt binary there is nothing to compare against, so report that and
// exit cleanly rather than failing: a missing toolchain is not a defect in
// the port. `npm run test:diff` on a machine with cargo still gates fully.
if (RUST_BIN === null) {
  process.stderr.write(
    "SKIP differential: no Rust oracle available " +
      `(no prebuilt ${path.join(RUST_REPO, "target/release/loc")}, ` +
      "no cargo on PATH, and LOC_RUST_BIN is unset).\n" +
      "Install a Rust toolchain or set LOC_RUST_BIN to run this suite.\n",
  );
  process.exit(0);
}

/** @returns {string[]} */
function resolveCorpus() {
  if (process.env.LOC_DIFF_CORPUS) {
    return process.env.LOC_DIFF_CORPUS.split(":").filter((s) => s.length > 0);
  }
  /** @type {string[]} */
  const corpus = [RUST_REPO, PKG_ROOT];
  const extra = "/tmp/loccorpus";
  if (existsSync(extra)) {
    for (const name of readdirSync(extra)) {
      const full = path.join(extra, name);
      try {
        if (statSync(full).isDirectory()) corpus.push(full);
      } catch {
        /* ignore */
      }
    }
  }
  return corpus;
}

const QUICK = process.env.LOC_DIFF_QUICK === "1";

/** @type {string[][]} */
const ARGV_MATRIX = QUICK
  ? [[], ["--files"], ["-uu"], ["--sort", "Lines"]]
  : [
      [],
      ["--files"],
      ["--sort", "Lines"],
      ["--sort", "Comment"],
      ["--sort", "Blank"],
      ["--sort", "Language"],
      ["--sort", "Files"],
      ["--files", "--sort", "Lines"],
      ["--files", "--sort", "Language"],
      ["-u"],
      ["-uu"],
      ["-u", "-u"],
      ["--exclude", "\\.rs$"],
      ["--include", "\\.c$"],
      ["--include", "\\.c$", "--exclude", "test"],
      ["--sort", "cdoe"],
      ["--sort", "xyzzy"],
      ["--sort", "FILES"],
      ["--exclude", "("],
      ["--version"],
      ["--help"],
      ["--bogus"],
      ["-x"],
      ["does-not-exist"],
      ["--files", "-uu"],
    ];

/**
 * @param {string} bin
 * @param {readonly string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 */
function runOne(bin, args, cwd, env) {
  const isNode = bin.endsWith(".js");
  const res = spawnSync(
    isNode ? process.execPath : bin,
    isNode ? [bin, ...args] : [...args],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env, ...env },
    },
  );
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: res.status ?? -1,
  };
}

/**
 * @param {string} text
 * @returns {Map<string, number>}
 */
function lineMultiset(text) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const line of text.split("\n")) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/**
 * Rust's `HashMap` iteration order is randomised per process, so rows sharing a
 * sort key may legitimately come back in a different order. Anything else — a
 * different row, a different number, a missing file — changes the multiset of
 * output lines and is reported as a failure.
 *
 * @param {string} a
 * @param {string} b
 * @returns {{ equal: boolean, detail?: string }}
 */
function compareOutputs(a, b) {
  if (a === b) return { equal: true };

  const ma = lineMultiset(a);
  const mb = lineMultiset(b);
  /** @type {string[]} */
  const onlyA = [];
  /** @type {string[]} */
  const onlyB = [];

  for (const [line, n] of ma) {
    const m = mb.get(line) ?? 0;
    for (let i = 0; i < n - m; i += 1) onlyA.push(line);
  }
  for (const [line, n] of mb) {
    const m = ma.get(line) ?? 0;
    for (let i = 0; i < n - m; i += 1) onlyB.push(line);
  }

  if (onlyA.length === 0 && onlyB.length === 0) {
    return { equal: true }; // identical rows, tie order only
  }

  const show = (/** @type {string[]} */ lines) =>
    lines
      .slice(0, 12)
      .map((l) => `      ${JSON.stringify(l)}`)
      .join("\n") + (lines.length > 12 ? `\n      ... +${lines.length - 12} more` : "");

  return {
    equal: false,
    detail:
      `    only in rust (${onlyA.length}):\n${show(onlyA)}\n` +
      `    only in js   (${onlyB.length}):\n${show(onlyB)}`,
  };
}

/**
 * Sanity check on the JS side: within each block, the requested sort key must
 * be non-increasing. Combined with multiset equality this proves that any
 * reordering really is confined to ties.
 *
 * @param {string} stdout
 * @param {readonly string[]} args
 * @returns {string | null} an error description, or null when fine
 */
function checkSorted(stdout, args) {
  const sortIndex = args.indexOf("--sort");
  const sortKey = sortIndex === -1 ? "Code" : args[sortIndex + 1];
  /** @type {Record<string, number>} */
  const column = { Lines: 2, Blank: 3, Comment: 4, Code: 5, Files: 1 };
  if (!(sortKey in column)) return null;
  const col = column[sortKey];

  const lines = stdout.split("\n");
  let previous = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.startsWith(" ") || line.startsWith(" Language") || line.startsWith(" Total")) {
      previous = Number.POSITIVE_INFINITY;
      continue;
    }
    if (line.startsWith("-")) {
      previous = Number.POSITIVE_INFINITY;
      continue;
    }
    const fields = line.trim().split(/\s{2,}|\s(?=\d)/).filter(Boolean);
    const value = Number(fields[fields.length - (6 - col)]);
    if (!Number.isFinite(value)) continue;
    if (value > previous) {
      return `rows are not sorted by ${sortKey}: ${value} after ${previous}`;
    }
    previous = value;
  }
  return null;
}

// ---------------------------------------------------------------------------

const corpus = resolveCorpus();
let passed = 0;
let failed = 0;
/** @type {string[]} */
const failures = [];

process.stderr.write(
  `rust: ${RUST_BIN}\njs:   ${JS_BIN}\ncorpus (${corpus.length}):\n` +
    corpus.map((c) => `  ${c}`).join("\n") +
    `\nargv matrix: ${ARGV_MATRIX.length}\n\n`,
);

for (const dir of corpus) {
  for (const args of ARGV_MATRIX) {
    const label = `${path.basename(dir)} :: loc ${args.join(" ") || "(no args)"}`;

    const rust = runOne(RUST_BIN, args, dir);
    const js = runOne(JS_BIN, args, dir);

    /** @type {string[]} */
    const problems = [];

    if (rust.code !== js.code) {
      problems.push(`    exit code: rust=${rust.code} js=${js.code}`);
    }
    if (rust.stderr !== js.stderr) {
      problems.push(
        `    stderr differs:\n      rust=${JSON.stringify(rust.stderr)}\n      js  =${JSON.stringify(js.stderr)}`,
      );
    }
    const cmp = compareOutputs(rust.stdout, js.stdout);
    if (!cmp.equal) problems.push(cmp.detail ?? "    stdout differs");

    const sortProblem = checkSorted(js.stdout, args);
    if (sortProblem !== null) problems.push(`    ${sortProblem}`);

    if (problems.length === 0) {
      passed += 1;
      process.stderr.write(`ok   ${label}\n`);
    } else {
      failed += 1;
      failures.push(`FAIL ${label}\n${problems.join("\n")}`);
      process.stderr.write(`FAIL ${label}\n${problems.join("\n")}\n`);
    }
  }

  // Single- vs multi-threaded output must be byte identical.
  const multi = runOne(JS_BIN, ["--files", "-uu"], dir);
  const single = runOne(JS_BIN, ["--files", "-uu"], dir, { LOC_JS_THREADS: "1" });
  if (multi.stdout !== single.stdout) {
    failed += 1;
    failures.push(`FAIL ${path.basename(dir)} :: threaded output differs from single-threaded`);
    process.stderr.write(
      `FAIL ${path.basename(dir)} :: threaded output differs from single-threaded\n`,
    );
  } else {
    passed += 1;
    process.stderr.write(`ok   ${path.basename(dir)} :: thread determinism\n`);
  }
}

process.stderr.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stderr.write(`\n${failures.join("\n\n")}\n`);
  process.exit(1);
}
