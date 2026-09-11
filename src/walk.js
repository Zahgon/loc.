// A port of `ignore::WalkBuilder` as configured in `main.rs`:
//
//     WalkBuilder::new(target)
//         .ignore(use_ignore)        // .ignore files
//         .git_ignore(use_ignore)    // .gitignore files
//         .git_exclude(use_ignore)   // .git/info/exclude
//         .hidden(ignore_hidden)     // skip dotfiles
//         .build()
//
// Everything else keeps the crate defaults, and two of those defaults are
// surprising enough to be worth stating loudly:
//
//   * `git_global(true)` is NEVER disabled, so the user's global gitignore
//     applies even under `-u` and `-uu`.
//   * `require_git(true)`, so `.gitignore` files are only honoured inside a
//     git repository. `.ignore` files are honoured everywhere.

import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EMPTY_GITIGNORE,
  Gitignore,
  gitignoreFromContents,
} from "./gitignore.js";

const SEP = path.sep;

/**
 * `PathBuf::push` semantics, which differ from `path.join`: Rust preserves a
 * `./` prefix, so `loc .` reports `./src/lib.rs` and `loc src` reports
 * `src/lib.rs`. Those strings are printed by `--files` and fed to the
 * include/exclude regexes, so the difference is observable.
 *
 * @param {string} parent
 * @param {string} name
 * @returns {string}
 */
export function joinDisplayPath(parent, name) {
  if (parent === "") return name;
  if (parent.endsWith("/") || (SEP === "\\" && parent.endsWith("\\"))) {
    return parent + name;
  }
  return parent + SEP + name;
}

/** @param {string} p @returns {string} */
function toPosix(p) {
  return SEP === "\\" ? p.replace(/\\/g, "/") : p;
}

/**
 * @param {string} dir absolute
 * @param {string} fileName
 * @returns {Gitignore}
 */
function loadIgnoreFile(dir, fileName) {
  const full = path.join(dir, fileName);
  try {
    return gitignoreFromContents(toPosix(dir), readFileSync(full, "utf8"));
  } catch {
    return EMPTY_GITIGNORE;
  }
}

/**
 * Resolve `<dir>/.git/info/exclude`, handling the `.git`-as-a-file form used
 * by worktrees and submodules.
 *
 * @param {string} dir absolute
 * @returns {Gitignore}
 */
function loadGitExclude(dir) {
  const dotGit = path.join(dir, ".git");
  /** @type {string} */
  let gitDir;
  try {
    const st = lstatSync(dotGit);
    if (st.isDirectory()) {
      gitDir = dotGit;
    } else if (st.isFile()) {
      const text = readFileSync(dotGit, "utf8");
      const m = text.match(/^gitdir:\s*(.+)$/m);
      if (m === null) return EMPTY_GITIGNORE;
      gitDir = path.resolve(dir, m[1].trim());
    } else {
      return EMPTY_GITIGNORE;
    }
  } catch {
    return EMPTY_GITIGNORE;
  }

  try {
    const contents = readFileSync(path.join(gitDir, "info", "exclude"), "utf8");
    return gitignoreFromContents(toPosix(dir), contents);
  } catch {
    return EMPTY_GITIGNORE;
  }
}

/**
 * The user's global gitignore, resolved the way git does:
 * `core.excludesFile` if set, otherwise `$XDG_CONFIG_HOME/git/ignore`.
 *
 * @returns {Gitignore}
 */
function loadGlobalGitignore() {
  const home = os.homedir();
  /** @type {string | null} */
  let excludesFile = null;

  const configPaths = [
    process.env.GIT_CONFIG_GLOBAL,
    process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "git", "config")
      : path.join(home, ".config", "git", "config"),
    path.join(home, ".gitconfig"),
  ].filter(/** @returns {v is string} */ (v) => typeof v === "string");

  for (const cfg of configPaths) {
    try {
      const text = readFileSync(cfg, "utf8");
      const m = text.match(/^\s*excludes[Ff]ile\s*=\s*(.+)$/m);
      if (m !== null) {
        excludesFile = m[1].trim().replace(/^"(.*)"$/, "$1");
        break;
      }
    } catch {
      /* keep looking */
    }
  }

  if (excludesFile === null) {
    excludesFile = process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "git", "ignore")
      : path.join(home, ".config", "git", "ignore");
  } else if (excludesFile.startsWith("~/")) {
    excludesFile = path.join(home, excludesFile.slice(2));
  }

  try {
    // Global patterns are matched against absolute paths, so anchor at root.
    return gitignoreFromContents("/", readFileSync(excludesFile, "utf8"));
  } catch {
    return EMPTY_GITIGNORE;
  }
}

/** @type {Gitignore | null} */
let cachedGlobalGitignore = null;

/**
 * @typedef {object} WalkOptions
 * @property {boolean} useIgnore honour `.ignore`, `.gitignore`, `.git/info/exclude`
 * @property {boolean} ignoreHidden skip dot-prefixed entries
 */

/**
 * @typedef {object} IgnoreNode
 * @property {string} absDir
 * @property {boolean} hasGit
 * @property {Gitignore} ignoreMatcher
 * @property {Gitignore} gitIgnoreMatcher
 * @property {Gitignore} gitExcludeMatcher
 * @property {boolean} isAbsoluteParent
 */

/**
 * @param {string} absDir
 * @param {boolean} isAbsoluteParent
 * @param {WalkOptions} opts
 * @returns {IgnoreNode}
 */
function makeNode(absDir, isAbsoluteParent, opts) {
  const hasGit = existsSync(path.join(absDir, ".git"));
  return {
    absDir,
    hasGit,
    isAbsoluteParent,
    ignoreMatcher: opts.useIgnore ? loadIgnoreFile(absDir, ".ignore") : EMPTY_GITIGNORE,
    gitIgnoreMatcher: opts.useIgnore
      ? loadIgnoreFile(absDir, ".gitignore")
      : EMPTY_GITIGNORE,
    gitExcludeMatcher:
      opts.useIgnore && hasGit ? loadGitExclude(absDir) : EMPTY_GITIGNORE,
  };
}

/**
 * Build the chain of ignore contexts for the ancestors of `absDir`, shallowest
 * first. `WalkBuilder` keeps `parents(true)` on by default.
 *
 * @param {string} absDir
 * @param {WalkOptions} opts
 * @returns {IgnoreNode[]}
 */
function absoluteParents(absDir, opts) {
  /** @type {string[]} */
  const dirs = [];
  let current = path.dirname(absDir);
  let previous = absDir;
  while (current !== previous) {
    dirs.push(current);
    previous = current;
    current = path.dirname(current);
  }
  dirs.reverse();
  return dirs.map((d) => makeNode(d, true, opts));
}

/**
 * `Ignore::matched_ignore`.
 *
 * Walks the chain from the deepest directory outwards. The first source to
 * produce a verdict wins, in the order: `.ignore` > `.gitignore` >
 * `.git/info/exclude` > global. Git-based sources stop being consulted once
 * the repository root has been passed.
 *
 * @param {readonly IgnoreNode[]} chain shallowest first
 * @param {string} absPath
 * @param {boolean} isDir
 * @param {Gitignore} globalMatcher
 * @returns {import("./gitignore.js").MatchResult}
 */
function matchedIgnore(chain, absPath, isDir, globalMatcher) {
  const posixPath = toPosix(absPath);
  const anyGit = chain.some((n) => n.hasGit);

  /** @type {import("./gitignore.js").MatchResult} */
  let mIgnore = "none";
  /** @type {import("./gitignore.js").MatchResult} */
  let mGitIgnore = "none";
  /** @type {import("./gitignore.js").MatchResult} */
  let mGitExclude = "none";
  let sawGit = false;

  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const node = chain[i];
    if (mIgnore === "none") {
      mIgnore = node.ignoreMatcher.matched(posixPath, isDir);
    }
    if (anyGit && !sawGit) {
      if (mGitIgnore === "none") {
        mGitIgnore = node.gitIgnoreMatcher.matched(posixPath, isDir);
      }
      if (mGitExclude === "none") {
        mGitExclude = node.gitExcludeMatcher.matched(posixPath, isDir);
      }
    }
    sawGit = sawGit || node.hasGit;
  }

  const mGlobal = anyGit ? globalMatcher.matched(posixPath, isDir) : "none";

  if (mIgnore !== "none") return mIgnore;
  if (mGitIgnore !== "none") return mGitIgnore;
  if (mGitExclude !== "none") return mGitExclude;
  return mGlobal;
}

/**
 * Walk `target`, yielding the paths of regular files exactly as the Rust
 * binary would report them.
 *
 * Symlinks are not followed and are not counted (`follow_links` defaults to
 * false, so their `file_type()` is neither file nor dir). Every I/O error is
 * swallowed, mirroring `filter_map(Result::ok)` in `main.rs` — a missing
 * target produces no output and does NOT change the exit code.
 *
 * Entries are visited in sorted order. The Rust walker uses raw `readdir`
 * order; see DIFFERENCES.md for why determinism was chosen here.
 *
 * @param {string} target
 * @param {WalkOptions} opts
 * @returns {Generator<string, void, void>}
 */
export function* walk(target, opts) {
  cachedGlobalGitignore ??= loadGlobalGitignore();
  const globalMatcher = cachedGlobalGitignore;

  /** @type {import("node:fs").Stats} */
  let rootStat;
  try {
    rootStat = lstatSync(target);
  } catch {
    return; // Walker yields Err, `filter_map(Result::ok)` drops it.
  }

  // Depth 0 is always yielded, bypassing hidden and ignore filtering.
  if (rootStat.isFile()) {
    yield target;
    return;
  }
  if (!rootStat.isDirectory()) return; // symlink, fifo, socket, ...

  const absRoot = path.resolve(target);
  const baseChain = [
    ...absoluteParents(absRoot, opts),
    makeNode(absRoot, false, opts),
  ];

  /** @type {{ display: string, abs: string, chain: IgnoreNode[] }[]} */
  const stack = [{ display: target, abs: absRoot, chain: baseChain }];

  while (stack.length > 0) {
    const dir = /** @type {{ display: string, abs: string, chain: IgnoreNode[] }} */ (
      stack.pop()
    );

    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = readdirSync(dir.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    /** @type {{ display: string, abs: string }[]} */
    const subdirs = [];

    for (const entry of entries) {
      const isDir = entry.isDirectory();
      const isFile = entry.isFile();
      if (!isDir && !isFile) continue; // symlinks and friends

      const absPath = path.join(dir.abs, entry.name);
      const displayPath = joinDisplayPath(dir.display, entry.name);

      // `Ignore::matched_dir_entry`: the hidden filter is a FALLBACK, applied
      // only when no ignore rule had an opinion. A whitelist rule therefore
      // un-hides a dotfile — ripgrep's own `.ignore` relies on this with
      // `!/.github/`, and getting the order wrong silently drops files.
      const verdict = matchedIgnore(dir.chain, absPath, isDir, globalMatcher);
      if (verdict === "ignore") continue;
      if (verdict === "none" && opts.ignoreHidden && entry.name.startsWith(".")) {
        continue;
      }

      if (isDir) {
        subdirs.push({ display: displayPath, abs: absPath });
      } else {
        yield displayPath;
      }
    }

    // Push in reverse so the sorted order is preserved by the LIFO stack.
    for (let i = subdirs.length - 1; i >= 0; i -= 1) {
      const sub = subdirs[i];
      stack.push({
        display: sub.display,
        abs: sub.abs,
        chain: [...dir.chain, makeNode(sub.abs, false, opts)],
      });
    }
  }
}

/** Test hook: forget the memoised global gitignore. */
export function resetGlobalGitignoreCache() {
  cachedGlobalGitignore = null;
}
