# Differences from the Rust `loc`

`loc-js` is a behaviour-for-behaviour port of [`cgag/loc`](https://github.com/cgag/loc)
v0.5.0. The differential harness (`npm run test:diff`) asserts equality of
stdout, stderr and exit codes across a corpus of repositories and a 25-entry
argument matrix.

Everything below is a place where the two implementations *cannot* be identical,
together with what `loc-js` does instead and why. Anything not listed here is a
bug — please report it.

Bugs in the original that are faithfully reproduced are marked `// BUG-COMPAT:`
in the source and are **not** listed here; they are not differences.

---

## 1. Ordering is deterministic

**Rust:** groups results into a `HashMap<Lang, Vec<FileCount>>` and iterates it.
Rust randomises `HashMap` iteration order per process, and the work-stealing
thread pool delivers results in a nondeterministic order on top of that. Two
consecutive runs over the same tree can therefore print:

* language rows with equal sort keys in a different order;
* in `--files` mode, the *language blocks themselves* in a completely different
  order, since that loop has no sort at all;
* file rows with equal sort keys in a different order.

**loc-js:** walks directories in sorted order, iterates languages in ascending
display-name order, and relies on `Array.prototype.sort` being stable. Output is
byte-identical across runs, across thread counts, and between the threaded and
single-threaded paths.

**Why:** reproducible output is strictly more useful, and the alternative is
emulating SipHash with a random seed. The differential harness compensates by
comparing the *multiset* of output lines and separately asserting that the
`loc-js` rows are correctly sorted; a genuine counting difference still fails.

## 2. Counter overflow

**Rust:** `Count` fields are `u32`. Overflow panics in a debug build and wraps
in a release build.

**loc-js:** plain `number`. Values above 2^53 would lose precision instead.

**Why:** unreachable in practice — it needs a single file of four billion lines.
`BigInt` would cost far more than it buys.

## 3. Panics become recoverable behaviour

The Rust original panics in three places that `loc-js` handles instead:

| Situation | Rust | loc-js |
|---|---|---|
| `count()` reaches a multi-byte lead byte in the whitespace check `&line[pos..pos+1]` | panic: byte index is not a char boundary | treats the byte as non-whitespace |
| `count()` called on a path that opens but fails to read (a directory on Unix) | panic via `.expect("nani?!")` | returns an all-zero `Count` |
| `counter_config_for_lang(Unrecognized)` | `unreachable!()` panic | throws an `Error` |

The first is unreachable behind the `contains_utf8` guard; the second and third
are unreachable through the CLI, which filters directories and unrecognised
files beforehand. All three are only observable when using the library API
directly.

## 4. Regular expression syntax

`--include` and `--exclude` take *Rust* regexes. The engines differ in both
directions, so `src/rust-regex.js` translates and validates:

**Handled — behaves like Rust:**

* look-around (`(?=`, `(?!`, `(?<=`, `(?<!`) and backreferences (`\1`) are
  rejected with the same message and exit code, even though JS supports them;
* `\d`, `\w`, `\s` are rewritten to Unicode property escapes, because Rust's are
  Unicode-aware by default while JS's are ASCII;
* a leading inline flag group such as `(?i)` is lifted onto the `RegExp` flags;
* unclosed groups, unclosed character classes, unopened groups and inverted
  repetition ranges produce Rust's exact `regex parse error:` diagnostic,
  including the caret line.

**Not handled:**

* diagnostics for less common syntax errors fall back to the JS engine's own
  message, wrapped in Rust's frame. The text differs; the exit code (1) and the
  stream (stdout) do not.
* inline flags that are not leading, `(?x)` verbose mode, and `(?U)` swap-greedy
  are rejected rather than emulated.
* `\D`, `\W`, `\S` *inside* a character class keep JS's ASCII meaning, since
  negated property escapes cannot be expressed there.

## 5. Help text wrapping

clap v2 wraps help output to the terminal width, falling back to 120 columns
when it cannot detect one. `loc-js` embeds the 120-column rendering verbatim, so
it matches every piped or redirected invocation but does not reflow for a narrow
terminal.

clap also colourises errors and help on a TTY. `loc-js` always emits plain text.

## 6. Threading

**Rust:** `num_cpus::get()` OS threads stealing individual files from a shared
deque.

**loc-js:** the same number of `worker_threads`, pulling *batches* of files. A
`postMessage` round trip costs orders of magnitude more than a `Stealer::steal`,
so per-file messaging would be slower than not threading at all. Workers are
only spawned above 512 files; below that the startup cost dominates.

Set `LOC_JS_THREADS=1` to force the single-threaded path. Output is identical
either way — the test suite asserts it.

## 7. Platform notes

* Path separators follow the host, as in Rust. On Windows the reported paths use
  `\`, which affects what your `--include`/`--exclude` regexes must match — the
  same caveat as the original.
* `loc-js` always writes `\n`, never `\r\n`, matching Rust's `println!`.

---

## Deliberately preserved quirks

These are bugs in the original that `loc-js` reproduces on purpose. They are
listed here so nobody "fixes" one by accident.

* **`last_n_chars` mixes bytes and chars.** In `--files` mode the path column is
  produced by `s.chars().skip(s.len() - n)` where `s.len()` is a *byte* count.
  For a path containing multi-byte UTF-8 this skips too far and prints fewer
  than 25 characters — sometimes none at all.
* **A single invalid UTF-8 byte zeroes the whole file.** `count()` bails out with
  `Count::default()`, discarding every line already tallied.
* **Blank lines inside block comments count as blank**, not as comment.
* **The `contains_utf8` scanner guard is over-eager.** When a line contains any
  multi-byte character the scanner may skip past a perfectly valid comment
  delimiter. The original source says as much in a `TODO`.
* **`found_code >= multis.len()`** decides code-vs-comment, not `found_code > 0`.
  For a language with several block-comment styles this systematically favours
  "comment".
* **Fortran comment markers are only required to be the first non-whitespace
  character**, not the first character of the line as the language demands.
* **Comment delimiters inside string literals are not recognised as strings**, so
  a `/*` in a string can open a block comment.
* **`git_global` is never disabled.** `-u` and `-uu` turn off `.gitignore`,
  `.ignore` and `.git/info/exclude`, but the user's *global* gitignore still
  applies. `WalkBuilder` leaves `git_global(true)` untouched.
* **`require_git` defaults to true**, so `.gitignore` files are inert outside a
  git repository. `.ignore` files work everywhere.
* **The hidden-file filter is a fallback.** It is applied only when no ignore
  rule matched, so a whitelist rule un-hides a dotfile — ripgrep's own `.ignore`
  depends on this with `!/.github/`.
* **`--sort` errors go to stdout and exit 0.** So does
  `--files --sort Language`. Only a bad regex exits non-zero.
* **`--exclude` and `--include` are greedy.** `loc --exclude foo .` swallows the
  `.` as a second pattern, leaving no target, so the default `.` is used and the
  pattern `(foo)|(.)` then excludes everything.
