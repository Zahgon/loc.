import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  EMPTY_GITIGNORE,
  gitignoreFromContents,
  parseGitignoreLine,
} from "../src/gitignore.js";
import {
  joinDisplayPath,
  resetGlobalGitignoreCache,
  walk,
} from "../src/walk.js";

/**
 * @param {string} pattern
 * @param {string} candidate
 * @param {boolean} [isDir]
 */
function matches(pattern, candidate, isDir = false) {
  const gi = gitignoreFromContents("/root", pattern);
  return gi.matched(`/root/${candidate}`, isDir);
}

describe("parseGitignoreLine", () => {
  it("skips blanks and comments", () => {
    assert.equal(parseGitignoreLine(""), null);
    assert.equal(parseGitignoreLine("   "), null);
    assert.equal(parseGitignoreLine("# comment"), null);
  });

  it("records negation, anchoring and directory-only flags", () => {
    const g = parseGitignoreLine("!/build/");
    assert.ok(g);
    assert.equal(g.isWhitelist, true);
    assert.equal(g.isOnlyDir, true);
  });

  it("treats \\# and \\! as literals", () => {
    assert.equal(matches("\\#notacomment\n", "#notacomment"), "ignore");
    assert.equal(matches("\\!bang\n", "!bang"), "ignore");
  });
});

describe("gitignore matching", () => {
  it("matches a bare name at any depth", () => {
    assert.equal(matches("anywhere.c\n", "anywhere.c"), "ignore");
    assert.equal(matches("anywhere.c\n", "a/b/anywhere.c"), "ignore");
  });

  it("anchors a leading slash to the ignore file's directory", () => {
    assert.equal(matches("/rootonly.c\n", "rootonly.c"), "ignore");
    assert.equal(matches("/rootonly.c\n", "sub/rootonly.c"), "none");
  });

  it("anchors any pattern containing a slash", () => {
    assert.equal(matches("a/b.c\n", "a/b.c"), "ignore");
    assert.equal(matches("a/b.c\n", "x/a/b.c"), "none");
  });

  it("restricts trailing-slash patterns to directories", () => {
    assert.equal(matches("build/\n", "build", true), "ignore");
    assert.equal(matches("build/\n", "build", false), "none");
  });

  it("expands /**/ to zero or more directories", () => {
    assert.equal(matches("deep/**/gen.c\n", "deep/gen.c"), "ignore");
    assert.equal(matches("deep/**/gen.c\n", "deep/a/gen.c"), "ignore");
    assert.equal(matches("deep/**/gen.c\n", "deep/a/b/gen.c"), "ignore");
    assert.equal(matches("deep/**/gen.c\n", "other/a/gen.c"), "none");
  });

  it("expands a leading **/", () => {
    assert.equal(matches("**/anywhere.c\n", "anywhere.c"), "ignore");
    assert.equal(matches("**/anywhere.c\n", "x/y/anywhere.c"), "ignore");
  });

  it("expands a trailing /** to the contents but not the directory", () => {
    assert.equal(matches("logs/**\n", "logs/a.c"), "ignore");
    assert.equal(matches("logs/**\n", "logs/a/b.c"), "ignore");
    assert.equal(matches("logs/**\n", "logs", true), "none");
  });

  it("keeps * and ? from crossing a separator", () => {
    assert.equal(matches("*.c\n", "a.c"), "ignore");
    assert.equal(matches("src/*.c\n", "src/a.c"), "ignore");
    assert.equal(matches("src/*.c\n", "src/deep/a.c"), "none");
    assert.equal(matches("a?.c\n", "ab.c"), "ignore");
    assert.equal(matches("a?.c\n", "a/b.c"), "none");
  });

  it("supports character classes", () => {
    assert.equal(matches("brack[0-9].c\n", "brack7.c"), "ignore");
    assert.equal(matches("brack[0-9].c\n", "brackX.c"), "none");
    assert.equal(matches("brack[!0-9].c\n", "brackX.c"), "ignore");
  });

  it("honours escaped trailing spaces", () => {
    assert.equal(matches("spaced\\ name.c\n", "spaced name.c"), "ignore");
    assert.equal(matches("trailing.c   \n", "trailing.c"), "ignore");
  });

  it("lets the last matching pattern win", () => {
    assert.equal(matches("*.tmp.c\n!keep.tmp.c\n", "keep.tmp.c"), "whitelist");
    assert.equal(matches("*.tmp.c\n!keep.tmp.c\n", "drop.tmp.c"), "ignore");
    assert.equal(matches("!keep.tmp.c\n*.tmp.c\n", "keep.tmp.c"), "ignore");
  });

  it("never matches the root directory itself", () => {
    const gi = gitignoreFromContents("/root", "*\n");
    assert.equal(gi.matched("/root", true), "none");
  });

  it("ignores paths outside its root", () => {
    const gi = gitignoreFromContents("/root", "*.c\n");
    assert.equal(gi.matched("/elsewhere/a.c", false), "none");
  });
});

describe("joinDisplayPath", () => {
  it("reproduces Rust's PathBuf::push rather than path.join", () => {
    assert.equal(joinDisplayPath(".", "a.c"), "./a.c");
    assert.equal(joinDisplayPath("./", "a.c"), "./a.c");
    assert.equal(joinDisplayPath("src", "lib.rs"), "src/lib.rs");
    assert.equal(joinDisplayPath("/", "x"), "/x");
    assert.equal(joinDisplayPath("", "x"), "x");
  });
});

describe("hidden-file precedence", () => {
  /** @param {string} label @param {string | null} ignoreContents */
  function tree(label, ignoreContents) {
    const dir = mkdtempSync(path.join(os.tmpdir(), `loc-js-hidden-${label}-`));
    mkdirSync(path.join(dir, ".github"), { recursive: true });
    writeFileSync(path.join(dir, ".github", "x.c"), "int x;\n");
    writeFileSync(path.join(dir, "plain.c"), "int y;\n");
    if (ignoreContents !== null) {
      writeFileSync(path.join(dir, ".ignore"), ignoreContents);
    }
    resetGlobalGitignoreCache();
    return [...walk(dir, { useIgnore: true, ignoreHidden: true })].map((p) =>
      path.relative(dir, p),
    );
  }

  it("skips dotfiles when no ignore rule has an opinion", () => {
    const found = tree("plain", null);
    assert.deepEqual(found, ["plain.c"]);
  });

  it("lets a whitelist rule un-hide a dotted directory", () => {
    const found = tree("whitelist", "!/.github/\n").sort();
    assert.deepEqual(found, [path.join(".github", "x.c"), "plain.c"]);
  });
});

describe("Gitignore.isEmpty", () => {
  it("is true when the file contributed no usable pattern", () => {
    assert.equal(gitignoreFromContents("/root", "").isEmpty(), true);
    assert.equal(
      gitignoreFromContents("/root", "# only a comment\n\n   \n").isEmpty(),
      true,
    );
    assert.equal(EMPTY_GITIGNORE.isEmpty(), true);
  });

  it("is false as soon as one pattern parses", () => {
    const gi = gitignoreFromContents("/root", "# lead comment\nbuild/\n");
    assert.equal(gi.isEmpty(), false);
    assert.equal(gi.matched("/root/build", true), "ignore");
  });
});

describe("git info/exclude", () => {
  /**
   * Build a repository whose `.git` is either a real directory or the
   * `gitdir:` pointer file that worktrees and submodules use.
   * @param {string} label
   * @param {"dir" | "pointer" | "pointer-malformed" | "none"} form
   * @param {string | null} excludeContents
   */
  function repo(label, form, excludeContents) {
    const dir = mkdtempSync(path.join(os.tmpdir(), `loc-js-exclude-${label}-`));
    writeFileSync(path.join(dir, "plain.c"), "int y;\n");
    writeFileSync(path.join(dir, "secret.c"), "int z;\n");

    if (form === "dir") {
      mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
      if (excludeContents !== null) {
        writeFileSync(
          path.join(dir, ".git", "info", "exclude"),
          excludeContents,
        );
      }
    } else if (form === "pointer" || form === "pointer-malformed") {
      const gitDir = mkdtempSync(
        path.join(os.tmpdir(), `loc-js-gitdir-${label}-`),
      );
      mkdirSync(path.join(gitDir, "info"), { recursive: true });
      if (excludeContents !== null) {
        writeFileSync(path.join(gitDir, "info", "exclude"), excludeContents);
      }
      writeFileSync(
        path.join(dir, ".git"),
        form === "pointer" ? `gitdir: ${gitDir}\n` : "not a gitdir line\n",
      );
    }

    resetGlobalGitignoreCache();
    return [...walk(dir, { useIgnore: true, ignoreHidden: true })]
      .map((p) => path.relative(dir, p))
      .sort();
  }

  it("honours patterns from a .git directory", () => {
    assert.deepEqual(repo("dir", "dir", "secret.c\n"), ["plain.c"]);
  });

  it("follows a gitdir: pointer file to the real git directory", () => {
    assert.deepEqual(repo("pointer", "pointer", "secret.c\n"), ["plain.c"]);
  });

  it("ignores a .git file with no gitdir: line", () => {
    assert.deepEqual(repo("malformed", "pointer-malformed", "secret.c\n"), [
      "plain.c",
      "secret.c",
    ]);
  });

  it("tolerates a .git directory with no info/exclude", () => {
    assert.deepEqual(repo("noexclude", "dir", null), ["plain.c", "secret.c"]);
  });

  it("does not look for an exclude file outside a repository", () => {
    assert.deepEqual(repo("nogit", "none", null), ["plain.c", "secret.c"]);
  });
});
