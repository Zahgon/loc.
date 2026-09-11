// A hand-rolled emulation of the clap v2.34 command line built in `main.rs`.
//
// Reproducing clap exactly matters more than it might seem: `--exclude` and
// `--include` are declared `multiple(true)`, which makes them GREEDY. `loc
// --exclude foo .` does not count `.` — the `.` is swallowed as a second
// exclude pattern and the target falls back to the default. Anything less
// faithful than this changes real-world results.

export const BIN_NAME = "loc";
export const VERSION = "0.5.0";
export const AUTHOR = "Curtis Gagliardi <curtis@curtis.io>";
export const ABOUT = "counts things quickly hopefully";

const FULL_USAGE = `${BIN_NAME} [FLAGS] [OPTIONS] [--] [target]...`;

// clap v2 wraps help at the terminal width, falling back to 120 columns when
// it cannot detect one — which is the case for every piped/redirected run, and
// therefore for every differential comparison. Embedded verbatim.
export const HELP_TEXT = `${BIN_NAME} ${VERSION}
${AUTHOR}
${ABOUT}

USAGE:
    ${FULL_USAGE}

FLAGS:
        --files           Show stats for individual files
    -h, --help            Prints help information
    -u, --unrestricted    A single -u won't respect .gitignore (etc.) files. Two -u flags will additionally count hidden
                          files and directories.
    -V, --version         Prints version information

OPTIONS:
        --exclude <REGEX>...    Rust regex of files to exclude
        --include <REGEX>...    Rust regex matching files to include. Anything not matched will be excluded
        --sort <COLUMN>         Column to sort by

ARGS:
    <target>...    File or directory to count (multiple arguments accepted)
`;

export const VERSION_TEXT = `${BIN_NAME} ${VERSION}`;

/**
 * @typedef {object} Matches
 * @property {string[]} exclude
 * @property {string[]} include
 * @property {string | null} sort
 * @property {boolean} files
 * @property {number} unrestricted occurrence count
 * @property {string[]} target
 */

/**
 * @typedef {{ kind: "ok", matches: Matches }
 *         | { kind: "exit", stdout?: string, stderr?: string, code: number }} ParseResult
 */

/** Usage fragments clap prints when an error mentions a specific argument. */
const ARG_USAGE = Object.freeze({
  exclude: "--exclude <REGEX>...",
  include: "--include <REGEX>...",
  sort: "--sort <COLUMN>",
  files: "--files",
  unrestricted: "--unrestricted",
});

/**
 * @param {string} message
 * @param {string} usage
 * @returns {{ kind: "exit", stderr: string, code: number }}
 */
function clapError(message, usage) {
  return {
    kind: "exit",
    stderr: `error: ${message}\n\nUSAGE:\n    ${usage}\n\nFor more information try --help\n`,
    code: 1,
  };
}

/**
 * Parse `argv` (without the node/script entries) the way clap v2 would.
 *
 * @param {readonly string[]} argv
 * @returns {ParseResult}
 */
export function parseArgs(argv) {
  /** @type {Matches} */
  const matches = {
    exclude: [],
    include: [],
    sort: null,
    files: false,
    unrestricted: 0,
    target: [],
  };

  /** Arguments already seen, used to build clap's contextual USAGE line. */
  /** @type {string[]} */
  const seen = [];
  /** @param {keyof typeof ARG_USAGE} name */
  const note = (name) => {
    const usage = ARG_USAGE[name];
    if (!seen.includes(usage)) seen.push(usage);
  };
  const contextUsage = () =>
    seen.length === 0 ? FULL_USAGE : `${BIN_NAME} ${seen.join(" ")}`;

  let sortSeen = false;
  let trailing = false;
  let i = 0;

  /**
   * Consume the greedy value list of a `multiple(true)` option. clap keeps
   * taking values until it hits something that looks like a flag.
   * @param {string[]} sink
   */
  const consumeGreedy = (sink) => {
    while (i < argv.length) {
      const token = argv[i];
      if (token.startsWith("-") && token.length > 1) break;
      sink.push(token);
      i += 1;
    }
  };

  while (i < argv.length) {
    const arg = argv[i];

    if (trailing) {
      matches.target.push(arg);
      i += 1;
      continue;
    }

    if (arg === "--") {
      trailing = true;
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
      i += 1;

      switch (name) {
        case "help":
          return { kind: "exit", stdout: HELP_TEXT, code: 0 };
        case "version":
          return { kind: "exit", stdout: `${VERSION_TEXT}\n`, code: 0 };
        case "files":
          note("files");
          matches.files = true;
          continue;
        case "exclude":
        case "include": {
          note(name);
          const sink = name === "exclude" ? matches.exclude : matches.include;
          if (inlineValue !== null) {
            // `--exclude=x` supplies exactly one value and stops.
            sink.push(inlineValue);
            continue;
          }
          const before = sink.length;
          consumeGreedy(sink);
          if (sink.length === before) {
            return clapError(
              `The argument '${ARG_USAGE[name]}' requires a value but none was supplied`,
              `${BIN_NAME} ${ARG_USAGE[name]}`,
            );
          }
          continue;
        }
        case "sort": {
          note("sort");
          if (sortSeen) {
            return clapError(
              `The argument '${ARG_USAGE.sort}' was provided more than once, but cannot be used multiple times`,
              `${BIN_NAME} ${ARG_USAGE.sort}`,
            );
          }
          if (inlineValue !== null) {
            matches.sort = inlineValue;
            sortSeen = true;
            continue;
          }
          if (i >= argv.length || (argv[i].startsWith("-") && argv[i].length > 1)) {
            return clapError(
              `The argument '${ARG_USAGE.sort}' requires a value but none was supplied`,
              `${BIN_NAME} ${ARG_USAGE.sort}`,
            );
          }
          matches.sort = argv[i];
          sortSeen = true;
          i += 1;
          continue;
        }
        case "unrestricted":
          note("unrestricted");
          matches.unrestricted += 1;
          continue;
        default:
          return clapError(
            `Found argument '${arg}' which wasn't expected, or isn't valid in this context`,
            contextUsage(),
          );
      }
    }

    if (arg.startsWith("-") && arg.length > 1) {
      i += 1;
      // Short flags may be bundled: `-uu` is two occurrences of `-u`.
      for (const ch of arg.slice(1)) {
        if (ch === "u") {
          note("unrestricted");
          matches.unrestricted += 1;
        } else if (ch === "h") {
          return { kind: "exit", stdout: HELP_TEXT, code: 0 };
        } else if (ch === "V") {
          return { kind: "exit", stdout: `${VERSION_TEXT}\n`, code: 0 };
        } else {
          return clapError(
            `Found argument '-${ch}' which wasn't expected, or isn't valid in this context`,
            contextUsage(),
          );
        }
      }
      continue;
    }

    matches.target.push(arg);
    i += 1;
  }

  return { kind: "ok", matches };
}

// ---------------------------------------------------------------------------
// `--sort` value parsing (the `FromStr for Sort` impl).

/** @typedef {"Code" | "Comment" | "Blank" | "Lines" | "Language" | "Files"} Sort */

/**
 * Levenshtein distance over Unicode scalar values, matching the semantics of
 * the `edit-distance` crate.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  const s = [...a];
  const t = [...b];
  let prev = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    const curr = new Array(t.length + 1);
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[t.length];
}

// Order is significant: the first candidate within distance 2 wins, so
// `--sort FILES` suggests `Lines` (distance 2) rather than `Files` (0 after
// lowercasing would have matched the exact arm, but `FILES` does not).
const SUGGESTIONS = /** @type {const} */ ([
  "blank",
  "code",
  "comment",
  "lines",
  "language",
  "files",
]);

/**
 * `Sort::from_str`.
 *
 * @param {string} s
 * @returns {{ ok: true, sort: Sort } | { ok: false, suggestion: string | null }}
 */
export function parseSort(s) {
  switch (s) {
    case "blank":
    case "Blank":
      return { ok: true, sort: "Blank" };
    case "code":
    case "Code":
      return { ok: true, sort: "Code" };
    case "comment":
    case "Comment":
      return { ok: true, sort: "Comment" };
    case "lines":
    case "Lines":
      return { ok: true, sort: "Lines" };
    case "language":
    case "Language":
      return { ok: true, sort: "Language" };
    case "files":
    case "Files":
      return { ok: true, sort: "Files" };
    default:
      break;
  }

  const lowered = s.toLowerCase();
  for (const candidate of SUGGESTIONS) {
    if (editDistance(lowered, candidate) <= 2) {
      return {
        ok: false,
        suggestion: candidate[0].toUpperCase() + candidate.slice(1),
      };
    }
  }
  return { ok: false, suggestion: null };
}
