// Worker-thread entry point for the counting pool. Pull-based: the worker asks
// for a batch, counts it, ships the results back and asks again.

import { parentPort } from "node:worker_threads";

import { count } from "./counter.js";
import { Lang, langFromExt } from "./lang.js";

if (parentPort === null) throw new Error("worker.js must be run as a worker");
const port = parentPort;

/**
 * @param {readonly string[]} paths
 * @returns {{ paths: string[], langs: string[], counts: Int32Array }}
 */
function countBatch(paths) {
  /** @type {string[]} */
  const keptPaths = [];
  /** @type {string[]} */
  const langs = [];
  const counts = new Int32Array(paths.length * 4);

  let n = 0;
  for (const p of paths) {
    // Unrecognised files are skipped BEFORE the file is opened, exactly as in
    // `Worker::run`.
    const lang = langFromExt(p);
    if (lang === Lang.Unrecognized) continue;
    const c = count(p, lang);
    keptPaths.push(p);
    langs.push(lang);
    counts[n * 4] = c.code;
    counts[n * 4 + 1] = c.comment;
    counts[n * 4 + 2] = c.blank;
    counts[n * 4 + 3] = c.lines;
    n += 1;
  }

  return { paths: keptPaths, langs, counts: counts.slice(0, n * 4) };
}

port.on("message", (msg) => {
  if (msg.type === "quit") {
    port.close();
    return;
  }
  if (msg.type === "batch") {
    const result = countBatch(msg.paths);
    port.postMessage({ type: "result", id: msg.id, ...result }, [
      /** @type {ArrayBuffer} */ (result.counts.buffer),
    ]);
    return;
  }
});

port.postMessage({ type: "ready" });
