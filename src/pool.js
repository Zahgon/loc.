// The JS stand-in for `main.rs`'s `deque` work-stealing pool.
//
// The Rust version spawns `num_cpus::get()` OS threads that steal individual
// files off a shared deque. Here the threads pull batches instead: a
// `postMessage` round trip is orders of magnitude more expensive than a
// `Stealer::steal`, so per-file messaging would be slower than not threading
// at all.
//
// Results are reassembled in batch order, which makes the output identical
// whether or not threading is used — asserted by the test suite.

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { count } from "./counter.js";
import { Lang, langFromExt } from "./lang.js";

/** @typedef {import("./counter.js").Count} Count */
/** @typedef {import("./tables.js").LangName} LangName */

/**
 * @typedef {object} FileCount
 * @property {string} path
 * @property {LangName} lang
 * @property {Count} count
 */

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js");

/** Below this many files, spawning workers costs more than it saves. */
const MIN_FILES_FOR_THREADS = 512;

/**
 * `num_cpus::get()`, honouring the `LOC_JS_THREADS` escape hatch used by the
 * test suite to force deterministic single-threaded execution.
 *
 * @returns {number}
 */
export function threadCount() {
  const override = process.env.LOC_JS_THREADS;
  if (override !== undefined && override !== "") {
    const n = Number.parseInt(override, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const available =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length;
  return Math.max(1, available);
}

/**
 * @param {readonly string[]} paths
 * @returns {FileCount[]}
 */
export function countFilesSync(paths) {
  /** @type {FileCount[]} */
  const out = [];
  for (const p of paths) {
    const lang = langFromExt(p);
    if (lang === Lang.Unrecognized) continue;
    out.push({ path: p, lang, count: count(p, lang) });
  }
  return out;
}

/**
 * @param {readonly string[]} paths
 * @returns {Promise<FileCount[]>}
 */
export async function countFiles(paths) {
  const threads = threadCount();
  if (threads === 1 || paths.length < MIN_FILES_FOR_THREADS) {
    return countFilesSync(paths);
  }

  const batchSize = Math.max(
    16,
    Math.ceil(paths.length / (threads * 8)),
  );
  /** @type {string[][]} */
  const batches = [];
  for (let i = 0; i < paths.length; i += batchSize) {
    batches.push([...paths.slice(i, i + batchSize)]);
  }

  /** @type {FileCount[][]} */
  const results = new Array(batches.length);
  let nextBatch = 0;

  const workerCount = Math.min(threads, batches.length);
  /** @type {Worker[]} */
  const workers = [];

  try {
    await new Promise((resolve, reject) => {
      let pending = workerCount;

      /** @param {Worker} worker */
      const dispatch = (worker) => {
        if (nextBatch >= batches.length) {
          worker.postMessage({ type: "quit" });
          pending -= 1;
          if (pending === 0) resolve(undefined);
          return;
        }
        const id = nextBatch;
        nextBatch += 1;
        worker.postMessage({ type: "batch", id, paths: batches[id] });
      };

      for (let i = 0; i < workerCount; i += 1) {
        const worker = new Worker(WORKER_PATH);
        workers.push(worker);
        worker.on("message", (msg) => {
          if (msg.type === "ready") {
            dispatch(worker);
            return;
          }
          if (msg.type === "result") {
            /** @type {FileCount[]} */
            const batch = [];
            for (let k = 0; k < msg.paths.length; k += 1) {
              batch.push({
                path: msg.paths[k],
                lang: msg.langs[k],
                count: {
                  code: msg.counts[k * 4],
                  comment: msg.counts[k * 4 + 1],
                  blank: msg.counts[k * 4 + 2],
                  lines: msg.counts[k * 4 + 3],
                },
              });
            }
            results[msg.id] = batch;
            dispatch(worker);
          }
        });
        worker.on("error", reject);
      }
    });
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }

  /** @type {FileCount[]} */
  const flat = [];
  for (const batch of results) {
    if (batch !== undefined) flat.push(...batch);
  }
  return flat;
}
