#!/usr/bin/env node
// Port of `benches/counters.rs`, plus a whole-repository end-to-end timing
// against the Rust binary when it is available.
//
//   node test/bench.mjs [iterations]

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { countBuffer } from "../src/counter.js";
import { counterConfigForLang, langFromExt } from "../src/lang.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..");
const DATA = path.resolve(HERE, "../source_rust/tests/data");
const ITERATIONS = Number(process.argv[2] ?? 20);

/**
 * @param {string} label
 * @param {() => void} fn
 * @param {number} iterations
 */
function bench(label, fn, iterations) {
  fn(); // warm up the JIT
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const best = samples[0];
  process.stdout.write(
    `${label.padEnd(28)} median ${median.toFixed(2).padStart(9)} ms   best ${best.toFixed(2).padStart(9)} ms\n`,
  );
}

process.stdout.write(`micro benchmarks (${ITERATIONS} iterations)\n`);
for (const fixture of ["plasma.c", "lua-big.lua"]) {
  const file = path.join(DATA, fixture);
  const bytes = readFileSync(file);
  const config = counterConfigForLang(langFromExt(file));
  const mb = bytes.length / (1024 * 1024);
  bench(`count ${fixture} (${mb.toFixed(1)} MiB)`, () => countBuffer(bytes, config), ITERATIONS);
}

// --- end to end -------------------------------------------------------------

const RUST_REPO = process.env.LOC_RUST_REPO ?? path.resolve(PKG_ROOT, "source_rust");
const RUST_BIN = process.env.LOC_RUST_BIN ?? path.join(RUST_REPO, "target/release/loc");
const CORPUS = process.env.LOC_BENCH_TARGET ?? "/tmp/loccorpus";

if (!existsSync(CORPUS)) {
  process.stdout.write(`\nskipping end-to-end benchmark: ${CORPUS} does not exist\n`);
  process.exit(0);
}

process.stdout.write(`\nend to end over ${CORPUS}\n`);

/**
 * @param {string} label
 * @param {() => void} fn
 */
function timeIt(label, fn) {
  const samples = [];
  for (let i = 0; i < 3; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  process.stdout.write(`${label.padEnd(28)} best ${samples[0].toFixed(0).padStart(6)} ms\n`);
  return samples[0];
}

const jsTime = timeIt("loc-js", () => {
  spawnSync(process.execPath, [path.join(PKG_ROOT, "bin/loc.js"), CORPUS], {
    stdio: "ignore",
    maxBuffer: 1 << 28,
  });
});

if (existsSync(RUST_BIN)) {
  const rustTime = timeIt("loc (rust)", () => {
    execFileSync(RUST_BIN, [CORPUS], { stdio: "ignore", maxBuffer: 1 << 28 });
  });
  process.stdout.write(`\nloc-js is ${(jsTime / rustTime).toFixed(1)}x the Rust runtime\n`);
} else {
  process.stdout.write(`\nRust binary not found at ${RUST_BIN}; skipping comparison\n`);
}
