import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { run } from "../src/cli.js";
import { compileRustRegex, combineRegexes } from "../src/rust-regex.js";

const HEADER =
  "--------------------------------------------------------------------------------\n" +
  " Language             Files        Lines        Blank      Comment         Code\n" +
  "--------------------------------------------------------------------------------\n";

const root = mkdtempSync(path.join(os.tmpdir(), "loc-js-cli-"));
const originalCwd = process.cwd();

before(() => {
  mkdirSync(path.join(root, "sub"), { recursive: true });
  writeFileSync(path.join(root, "a.c"), "/* c */\nint a;\n\nint b;\n");
  writeFileSync(path.join(root, "b.py"), "# py\nx = 1\n");
  writeFileSync(path.join(root, "sub", "c.py"), "y = 2\n");
  writeFileSync(path.join(root, "unknown.zzz"), "whatever\n");
  process.chdir(root);
});

after(() => process.chdir(originalCwd));

describe("summary output", () => {
  it("renders the table with a Total row", async () => {
    const r = await run(["."]);
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      HEADER +
        " C                        1            4            1            1            2\n" +
        " Python                   2            3            0            1            2\n" +
        "--------------------------------------------------------------------------------\n" +
        " Total                    3            7            1            2            4\n" +
        "--------------------------------------------------------------------------------\n",
    );
  });

  it("still prints the frame when nothing matches", async () => {
    const r = await run(["--include", "\\.nothing$"]);
    assert.equal(
      r.stdout,
      HEADER +
        "--------------------------------------------------------------------------------\n" +
        " Total                    0            0            0            0            0\n" +
        "--------------------------------------------------------------------------------\n",
    );
  });

  it("treats a missing target as empty without failing", async () => {
    const r = await run(["does-not-exist"]);
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, / Total {20}0/);
  });

  it("sorts by language using byte order", async () => {
    const r = await run([".", "--sort", "Language"]);
    const langs = r.stdout
      .split("\n")
      .filter((l) => l.startsWith(" ") && !l.startsWith(" Language") && !l.startsWith(" Total"))
      .map((l) => l.trim().split(/\s{2,}/)[0]);
    assert.deepEqual(langs, ["C", "Python"]);
  });
});

describe("--files output", () => {
  it("omits the grand total and trailing separator", async () => {
    const r = await run(["--files", "."]);
    assert.ok(!r.stdout.includes(" Total "));
    assert.ok(r.stdout.includes("|./a.c"));
    assert.ok(r.stdout.includes("|./sub/c.py"));
    assert.ok(r.stdout.trimEnd().split("\n").at(-1)?.startsWith("|"));
  });

  it("rejects sorting by Language on stdout with exit code 0", async () => {
    const r = await run(["--files", "--sort", "Language"]);
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      "Error: cannot sort by Language or Files when --files is present\n",
    );
  });

  it("rejects sorting by Files the same way", async () => {
    const r = await run(["--files", "--sort", "Files"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^Error: cannot sort by Language or Files/);
  });
});

describe("--sort validation", () => {
  it("suggests a close value on stdout and exits 0", async () => {
    const r = await run(["--sort", "cdoe"]);
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.equal(
      r.stdout,
      "Error: invalid value for --sort: 'cdoe', perhaps you meant 'Code'?\n" +
        " Hint: legal values are Code, Comment, Blank, Lines, Language, and Files\n",
    );
  });

  it("omits the suggestion when nothing is close", async () => {
    const r = await run(["--sort", "xyzzy"]);
    assert.equal(
      r.stdout,
      "Error: invalid value for --sort: 'xyzzy'\n" +
        " Hint: legal values are Code, Comment, Blank, Lines, Language, and Files\n",
    );
  });
});

describe("filters", () => {
  it("applies include before exclude, so exclude wins", async () => {
    const r = await run(["--include", "\\.py$", "--exclude", "sub", "--", "."]);
    assert.match(r.stdout, / Python {19}1/);
  });

  it("reports a bad regex on stdout and exits 1", async () => {
    const r = await run(["--exclude", "("]);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^Error processing exclude regex: regex parse error:/);
    assert.match(r.stdout, /error: unclosed group/);
  });

  it("reports a bad include regex separately", async () => {
    const r = await run(["--include", "["]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^Error processing include regex:/);
    assert.match(r.stdout, /error: unclosed character class/);
  });
});

describe("rust-regex compatibility", () => {
  it("combines multiple values into alternation groups", () => {
    assert.equal(combineRegexes(["a", "b"]), "(a)|(b)");
  });

  it("rejects look-around like the Rust crate does", () => {
    const r = compileRustRegex("(?=x)");
    assert.equal(r.ok, false);
    assert.match(r.message, /look-around/);
  });

  it("rejects backreferences like the Rust crate does", () => {
    const r = compileRustRegex("(a)\\1");
    assert.equal(r.ok, false);
    assert.match(r.message, /backreferences are not supported/);
  });

  it("rejects an inverted repetition range", () => {
    const r = compileRustRegex("a{2,1}");
    assert.equal(r.ok, false);
    assert.match(r.message, /the start must be <= the end/);
  });

  it("lifts leading inline flags onto RegExp flags", () => {
    const r = compileRustRegex("(?i)ABC");
    assert.equal(r.ok, true);
    assert.ok(r.regex.test("abc"));
  });

  it("searches unanchored, matching Regex::is_match", () => {
    const r = compileRustRegex("b");
    assert.equal(r.ok, true);
    assert.ok(r.regex.test("abc"));
  });
});
