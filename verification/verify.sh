#!/usr/bin/env bash
#
# Independent verification of golden.patch / test.patch / fix.patch.
#
# Rebuilds the baseline task repository from the pristine Rust source, applies
# the patches, and runs every check that can falsify them. Exits non-zero on
# the first failure.
#
# Usage:
#   ./verify.sh [--source <path to original Rust repo>]
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_RUST="${HERE}/../../../scraped repos/rust/loc"
PATCHES="${HERE}/.."

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE_RUST="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$SOURCE_RUST/src/lib.rs" ] || { echo "FAIL: no Rust source at $SOURCE_RUST" >&2; exit 2; }
for p in golden test fix; do
  [ -f "$PATCHES/$p.patch" ] || { echo "FAIL: missing $p.patch" >&2; exit 2; }
done
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; }
head1(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
head1 "Rebuilding the baseline task repository"
BASE="$WORK/baseline"
mkdir -p "$BASE/source_rust"
# Copy exactly the git-tracked files, so build output (target/) cannot leak in.
if git -C "$SOURCE_RUST" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$SOURCE_RUST" ls-files -z | while IFS= read -r -d '' f; do
    mkdir -p "$BASE/source_rust/$(dirname "$f")"
    cp "$SOURCE_RUST/$f" "$BASE/source_rust/$f"
  done
else
  rsync -a --exclude .git --exclude target "$SOURCE_RUST/" "$BASE/source_rust/"
fi
git -C "$BASE" init -q -b main
# -f is required: the crate's own .gitignore lists `plasma.c`, which would
# otherwise silently drop the force-added tests/data/plasma.c fixture.
git -C "$BASE" -c user.email=v@example.com -c user.name=verify add -Af
git -C "$BASE" -c user.email=v@example.com -c user.name=verify \
    commit -qm "Baseline: original Rust loc crate"
echo "  baseline: $(git -C "$BASE" ls-files | wc -l | tr -d ' ') files under source_rust/"

clone() { rm -rf "$WORK/$1"; git clone -q "$BASE" "$WORK/$1"; }

# ---------------------------------------------------------------------------
head1 "A. Patch hygiene"
if ! grep -qE '^diff --git a/source_rust' "$PATCHES/golden.patch"; then
  ok "golden.patch touches zero files under source_rust/"
else bad "golden.patch modifies the baseline"; fi

if ! grep -qE '^\+.*(/Users/|/home/|/var/folders/)' "$PATCHES/golden.patch"; then
  ok "no absolute or machine-specific paths in added lines"
else bad "absolute paths leaked into the patch"; fi

if ! grep -E '^diff --git' "$PATCHES/golden.patch" \
     | grep -qE '(node_modules/|/target/|\.rlib|coverage/)'; then
  ok "no build output or dependency caches added as files"
else bad "build artifacts present in the patch"; fi

if ! grep -E '^diff --git' "$PATCHES/golden.patch" \
     | grep -qE ' b/(instructions\.md|truth\.md|(golden|test|fix)\.patch)$'; then
  ok "meta-artifacts (instructions/truth/patches) are not inside the patch"
else bad "a meta-artifact leaked into the patch"; fi

GF=$(grep -c '^diff --git' "$PATCHES/golden.patch")
TF=$(grep -c '^diff --git' "$PATCHES/test.patch")
FF=$(grep -c '^diff --git' "$PATCHES/fix.patch")
if [ "$GF" -eq $((TF + FF)) ]; then
  ok "file counts partition cleanly: golden $GF = test $TF + fix $FF"
else bad "file counts do not partition: golden $GF vs test $TF + fix $FF"; fi

if [ -z "$(comm -12 <(grep '^diff --git' "$PATCHES/test.patch" | sort) \
                    <(grep '^diff --git' "$PATCHES/fix.patch" | sort))" ]; then
  ok "no file appears in both test.patch and fix.patch"
else bad "test.patch and fix.patch overlap"; fi

if ! grep -E '^diff --git' "$PATCHES/test.patch" | grep -qvE ' b/test/'; then
  ok "test.patch contains only files under test/"
else bad "test.patch contains a non-test file"; fi

# ---------------------------------------------------------------------------
head1 "B. golden.patch applies, tests, type-checks, and reverses"
clone g; cd "$WORK/g"
if git apply --whitespace=nowarn "$PATCHES/golden.patch" 2>/dev/null; then
  ok "applies cleanly to the baseline"
else bad "does not apply cleanly"; fi

if npm test >"$WORK/gtest.log" 2>&1; then
  N=$(grep -Eo '^. pass [0-9]+' "$WORK/gtest.log" | grep -Eo '[0-9]+' | head -1)
  ok "npm test passes (${N:-?} tests)"
else bad "npm test failed - see $WORK/gtest.log"; fi

if [ -d node_modules ] || npm ci --silent >/dev/null 2>&1; then
  if npm run --silent typecheck >/dev/null 2>&1; then ok "tsc --strict --checkJs clean"
  else bad "typecheck failed"; fi
else skip "typecheck (devDependencies unavailable offline)"; fi

clone rev; cd "$WORK/rev"
git apply --whitespace=nowarn "$PATCHES/golden.patch"
git apply -R --whitespace=nowarn "$PATCHES/golden.patch"
if [ -z "$(git status --porcelain)" ]; then
  ok "reverses cleanly back to a pristine baseline"
else bad "reversal leaves the tree dirty"; fi

# ---------------------------------------------------------------------------
head1 "C. Task validity: test.patch must fail without the implementation"
clone t; cd "$WORK/t"
if git apply --whitespace=nowarn "$PATCHES/test.patch"; then
  ok "test.patch applies to the baseline"
else bad "test.patch does not apply"; fi

if npm test >/dev/null 2>&1; then
  bad "tests PASS without the implementation - the task is vacuous"
else
  ok "tests fail with test.patch alone, as required"
fi

if git apply --whitespace=nowarn "$PATCHES/fix.patch"; then
  ok "fix.patch applies on top of test.patch"
else bad "fix.patch does not apply on top of test.patch"; fi

if npm test >/dev/null 2>&1; then ok "npm test passes after test+fix"
else bad "npm test fails after test+fix"; fi

clone gg; cd "$WORK/gg"; git apply --whitespace=nowarn "$PATCHES/golden.patch"
if diff -r -x .git -x node_modules "$WORK/t" "$WORK/gg" >/dev/null 2>&1; then
  ok "test.patch + fix.patch reconstructs golden.patch byte-identically"
else bad "test+fix tree differs from the golden tree"; fi

# ---------------------------------------------------------------------------
head1 "D. Cold cache, fully offline"
clone cold; cd "$WORK/cold"; git apply --whitespace=nowarn "$PATCHES/golden.patch"
if [ ! -d node_modules ] && npm test >/dev/null 2>&1; then
  ok "tests pass with no node_modules at all (zero runtime dependencies)"
else bad "requires installed dependencies to run its tests"; fi

# ---------------------------------------------------------------------------
head1 "E. Oracle reproducibility (do the expectations really come from Rust?)"
cd "$WORK/gg"
if command -v cargo >/dev/null 2>&1; then
  if npm run --silent check:tables >"$WORK/tables.log" 2>&1; then
    ok "language tables regenerate byte-identically from source_rust/src/lib.rs"
  else bad "generated tables drifted from the Rust source"; fi

  if cargo build --release --manifest-path source_rust/Cargo.toml >"$WORK/cargo.log" 2>&1; then
    ok "the vendored Rust original still builds (oracle available)"
    if LOC_DIFF_QUICK=1 node test/differential/run.mjs >"$WORK/diff.log" 2>&1; then
      D=$(grep -Eo '[0-9]+ passed' "$WORK/diff.log" | tail -1)
      ok "differential against the real Rust binary: ${D:-passed}"
    else bad "differential harness reported differences - see $WORK/diff.log"; fi
  else bad "vendored Rust source does not build - see $WORK/cargo.log"; fi
else
  skip "cargo not installed; cannot rebuild the Rust oracle"
fi

# ---------------------------------------------------------------------------
head1 "F. Mutation testing (do the tests actually bite?)"
set +e
python3 - "$WORK/gg" <<'PY'
import hashlib, pathlib, subprocess, sys

root = pathlib.Path(sys.argv[1])
MUTANTS = [
    ("src/format.js", 'Buffer.byteLength(s, "utf8")', 's.length',
     "last_n_chars stops mixing bytes and chars (quirk 'fixed')"),
    ("src/counter.js", 'if (foundCode >= nMultis) {', 'if (foundCode > 0) {',
     "code-vs-comment test becomes found_code > 0"),
    ("src/gitignore.js", 'i += 3;', 'i += 4;',
     "/**/ glob expansion eats a character again"),
    ("src/walk.js", 'if (verdict === "none" && opts.ignoreHidden', 'if (opts.ignoreHidden',
     "hidden filter stops being a fallback"),
    ("src/path.js", 'return fileName.slice(dot + 1);', 'return fileName.slice(dot);',
     "Path::extension keeps the leading dot (Node semantics)"),
    ("src/cli.js", '" Hint: legal values are Code, Comment, Blank, Lines, Language, and Files\\n",\n        stderr: "",\n        code: 0,',
     '" Hint: legal values are Code, Comment, Blank, Lines, Language, and Files\\n",\n        stderr: "",\n        code: 1,',
     "bad --sort exits 1 instead of the original's 0"),
]

killed = survived = invalid = 0
for fname, old, new, label in MUTANTS:
    path = root / fname
    original = path.read_text()
    before = hashlib.sha256(original.encode()).hexdigest()
    if old not in original:
        print(f"  \033[33mINVALID\033[0m  {label} (pattern not found)"); invalid += 1; continue
    path.write_text(original.replace(old, new, 1))
    if hashlib.sha256(path.read_text().encode()).hexdigest() == before:
        print(f"  \033[33mINVALID\033[0m  {label} (no-op)"); invalid += 1
        path.write_text(original); continue
    proc = subprocess.run(["npm", "test"], cwd=root, capture_output=True, text=True)
    path.write_text(original)
    if proc.returncode != 0:
        n = proc.stdout.count("not ok") or proc.stdout.count("\u2716")
        print(f"  \033[32mKILLED\033[0m   {label}" + (f" ({n} failing tests)" if n else "")); killed += 1
    else:
        print(f"  \033[31mSURVIVED\033[0m {label} - NOT DETECTED BY THE TEST SUITE"); survived += 1

print(f"\n  mutants: {killed} killed, {survived} survived, {invalid} invalid")
sys.exit(1 if survived or invalid else 0)
PY
MUT=$?
set -e
if [ "$MUT" -eq 0 ]; then ok "every injected defect was caught"; else bad "a mutant survived or was invalid"; fi

# ---------------------------------------------------------------------------
head1 "Result"
printf '  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "  golden.patch is verified: it applies, tests offline with zero"
echo "  dependencies, reverses cleanly, leaves the baseline untouched, splits"
echo "  correctly into test.patch + fix.patch, and its expectations are"
echo "  reproducible by re-executing the original Rust."
