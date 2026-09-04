import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HELP_TEXT, editDistance, parseArgs, parseSort } from "../src/args.js";

/** @param {readonly string[]} argv */
function ok(argv) {
  const r = parseArgs(argv);
  assert.equal(r.kind, "ok", `expected success for ${JSON.stringify(argv)}`);
  return /** @type {{ kind: "ok", matches: import("../src/args.js").Matches }} */ (r).matches;
}

describe("parseArgs", () => {
  it("defaults everything", () => {
    assert.deepEqual(ok([]), {
      exclude: [],
      include: [],
      sort: null,
      files: false,
      unrestricted: 0,
      target: [],
    });
  });

  it("collects positional targets", () => {
    assert.deepEqual(ok(["src", "tests"]).target, ["src", "tests"]);
  });

  it("counts -u occurrences, including bundled shorts", () => {
    assert.equal(ok(["-u"]).unrestricted, 1);
    assert.equal(ok(["-uu"]).unrestricted, 2);
    assert.equal(ok(["-u", "-u"]).unrestricted, 2);
    assert.equal(ok(["-uuu"]).unrestricted, 3);
    assert.equal(ok(["--unrestricted", "--unrestricted"]).unrestricted, 2);
  });

  it("makes --exclude greedy, swallowing what looks like a target", () => {
    // This is clap v2's `multiple(true)` behaviour and it is load bearing:
    // `loc --exclude foo .` counts nothing because `.` becomes a pattern.
    const m = ok(["--exclude", "foo", "."]);
    assert.deepEqual(m.exclude, ["foo", "."]);
    assert.deepEqual(m.target, []);
  });

  it("stops greedy collection at the next flag", () => {
    const m = ok(["--exclude", "a", "b", "--include", "c", "."]);
    assert.deepEqual(m.exclude, ["a", "b"]);
    assert.deepEqual(m.include, ["c", "."]);
  });

  it("does not continue greedily after the --flag=value form", () => {
    const m = ok(["--exclude=zzz", "."]);
    assert.deepEqual(m.exclude, ["zzz"]);
    assert.deepEqual(m.target, ["."]);
  });

  it("accepts a positional before an option", () => {
    const m = ok([".", "--exclude", "zzz"]);
    assert.deepEqual(m.target, ["."]);
    assert.deepEqual(m.exclude, ["zzz"]);
  });

  it("treats everything after -- as a target", () => {
    assert.deepEqual(ok(["--exclude", "zzz", "--", "-weird"]).target, ["-weird"]);
  });

  it("takes a single --sort value", () => {
    assert.equal(ok(["--sort", "Lines", "."]).sort, "Lines");
    assert.equal(ok(["--sort=Lines"]).sort, "Lines");
    assert.deepEqual(ok(["--sort", "Lines", "."]).target, ["."]);
  });

  it("prints help to stdout and exits 0", () => {
    for (const flag of ["--help", "-h"]) {
      const r = parseArgs([flag]);
      assert.equal(r.kind, "exit");
      assert.equal(r.code, 0);
      assert.equal(r.stdout, HELP_TEXT);
    }
  });

  it("prints the version to stdout and exits 0", () => {
    for (const flag of ["--version", "-V"]) {
      const r = parseArgs([flag]);
      assert.equal(r.kind, "exit");
      assert.equal(r.code, 0);
      assert.equal(r.stdout, "loc 0.5.0\n");
    }
  });

  const errors = /** @type {[string[], string][]} */ ([
    [
      ["--bogus"],
      "error: Found argument '--bogus' which wasn't expected, or isn't valid in this context\n\nUSAGE:\n    loc [FLAGS] [OPTIONS] [--] [target]...\n\nFor more information try --help\n",
    ],
    [
      ["-x"],
      "error: Found argument '-x' which wasn't expected, or isn't valid in this context\n\nUSAGE:\n    loc [FLAGS] [OPTIONS] [--] [target]...\n\nFor more information try --help\n",
    ],
    [
      ["-ux"],
      "error: Found argument '-x' which wasn't expected, or isn't valid in this context\n\nUSAGE:\n    loc --unrestricted\n\nFor more information try --help\n",
    ],
    [
      ["--sort"],
      "error: The argument '--sort <COLUMN>' requires a value but none was supplied\n\nUSAGE:\n    loc --sort <COLUMN>\n\nFor more information try --help\n",
    ],
    [
      ["--exclude"],
      "error: The argument '--exclude <REGEX>...' requires a value but none was supplied\n\nUSAGE:\n    loc --exclude <REGEX>...\n\nFor more information try --help\n",
    ],
    [
      ["--sort", "Code", "--sort", "Lines"],
      "error: The argument '--sort <COLUMN>' was provided more than once, but cannot be used multiple times\n\nUSAGE:\n    loc --sort <COLUMN>\n\nFor more information try --help\n",
    ],
  ]);
  for (const [argv, stderr] of errors) {
    it(`rejects ${argv.join(" ")}`, () => {
      const r = parseArgs(argv);
      assert.equal(r.kind, "exit");
      assert.equal(r.code, 1);
      assert.equal(r.stderr, stderr);
    });
  }
});

describe("editDistance", () => {
  it("matches the edit-distance crate", () => {
    assert.equal(editDistance("", ""), 0);
    assert.equal(editDistance("kitten", "sitting"), 3);
    assert.equal(editDistance("cdoe", "code"), 2);
    assert.equal(editDistance("files", "lines"), 2);
    assert.equal(editDistance("abc", ""), 3);
  });
});

describe("parseSort", () => {
  const exact = /** @type {[string, string][]} */ ([
    ["blank", "Blank"],
    ["Blank", "Blank"],
    ["code", "Code"],
    ["Code", "Code"],
    ["comment", "Comment"],
    ["Comment", "Comment"],
    ["lines", "Lines"],
    ["Lines", "Lines"],
    ["language", "Language"],
    ["Language", "Language"],
    ["files", "Files"],
    ["Files", "Files"],
  ]);
  for (const [input, sort] of exact) {
    it(`accepts ${input}`, () => assert.deepEqual(parseSort(input), { ok: true, sort }));
  }

  const suggestions = /** @type {[string, string | null][]} */ ([
    ["cdoe", "Code"],
    ["bank", "Blank"],
    ["Langauge", "Language"],
    ["fil", "Files"],
    ["xyzzy", null],
    // Uppercase misses the exact arm and then lands on Lines at distance 2,
    // before Files is ever considered. Order of the candidate list matters.
    ["FILES", "Lines"],
  ]);
  for (const [input, suggestion] of suggestions) {
    it(`rejects ${input} suggesting ${suggestion ?? "nothing"}`, () => {
      assert.deepEqual(parseSort(input), { ok: false, suggestion });
    });
  }
});
