import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Lang, checkShebang, counterConfigForLang, langDisplayName, langFromExt } from "../src/lang.js";
import { rustExtension, rustFileName } from "../src/path.js";
import { COMMENT_CONFIG, EXT_TO_LANG, LANG_DISPLAY_NAME } from "../src/tables.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "loc-js-lang-"));

/**
 * @param {string} name
 * @param {string} contents
 * @returns {string}
 */
function fixture(name, contents) {
  const full = path.join(tmp, name);
  writeFileSync(full, contents);
  return full;
}

describe("rustFileName", () => {
  const cases = /** @type {[string, string | null][]} */ ([
    ["foo/bar", "bar"],
    ["foo/bar/", "bar"],
    ["foo/.", "foo"],
    ["foo/..", null],
    ["/", null],
    ["", null],
    [".", null],
    ["..", null],
    ["a//b", "b"],
    ["./foo", "foo"],
    ["foo", "foo"],
  ]);
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(rustFileName(input), expected);
    });
  }
});

describe("rustExtension", () => {
  // Node's `path.extname` disagrees on almost every one of these.
  const cases = /** @type {[string, string | null][]} */ ([
    ["foo.tar.gz", "gz"],
    ["foo", null],
    [".gitignore", null],
    ["foo.", ""],
    [".foo.bar", "bar"],
    ["a.b.c.d", "d"],
    ["...", ""],
    ["..", null],
    [".", null],
    ["dir.d/file", null],
  ]);
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(rustExtension(input), expected);
    });
  }
});

describe("langFromExt", () => {
  const cases = /** @type {[string, string][]} */ ([
    ["src/main.rs", Lang.Rust],
    ["Makefile", Lang.Makefile],
    ["GNUmakefile", Lang.Makefile],
    ["makefile.am", Lang.Makefile],
    ["deep/path/Makefile.in", Lang.Makefile],
    ["Dockerfile", Lang.Docker],
    ["CMakeLists.txt", Lang.CMake],
    ["cmakelists.txt", Lang.CMake],
    ["foo.tar.gz", Lang.Unrecognized],
    ["UPPER.C", Lang.C],
    ["mixed.Rb", Lang.Ruby],
    ["a.hpp", Lang.CCppHeader],
    ["a.mjs", Lang.JavaScript],
    ["a.tsx", Lang.Tsx],
    ["a.thy", Lang.Isabelle],
    ["a.v", Lang.Coq],
    ["a.m", Lang.ObjectiveC],
  ]);
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => assert.equal(langFromExt(input), expected));
  }

  it("throws when the path has no file name, as Rust's expect() panics", () => {
    assert.throws(() => langFromExt(".."), /no filename/);
  });

  it("falls back to the whole lowercased name when there is no extension", () => {
    // `.gitignore` has no Rust extension and no shebang, so the file name
    // itself is looked up — and matches nothing.
    assert.equal(langFromExt(fixture(".gitignore", "target\n")), Lang.Unrecognized);
  });

  it("uses the file name as an extension when it happens to match", () => {
    assert.equal(langFromExt(fixture("lua", "print(1)\n")), Lang.Lua);
  });
});

describe("checkShebang", () => {
  const hits = /** @type {[string, string][]} */ ([
    ["#!/usr/bin/env python3\nx=1\n", "py"],
    ["#!python\n", "py"],
    ["#!/bin/bash\n", "sh"],
    ["#!/usr/bin/env sh\n", "sh"],
    ["#!/usr/bin/env perl6\n", "pl"],
    ["#!/usr/bin/env runhaskell\n", "hs"],
    ["#!/usr/bin/csh\n", "csh"],
    ["#!/usr/bin/env node\n", "js"],
    ["#!/usr/bin/ruby\n", "rb"],
    ["#!/bin/bash\r\n", "sh"],
  ]);
  hits.forEach(([contents, ext], i) => {
    it(`${JSON.stringify(contents)} -> ${ext}`, () => {
      assert.equal(checkShebang(fixture(`hit${i}`, contents)), ext);
    });
  });

  const misses = [
    "#!/usr/bin/env python3.11\n",
    "#!/bin/bash \n",
    " #!/bin/bash\n",
    "#!/usr/bin/env  node\n",
    "",
    "no shebang at all\n",
  ];
  misses.forEach((contents, i) => {
    it(`${JSON.stringify(contents)} -> null`, () => {
      assert.equal(checkShebang(fixture(`miss${i}`, contents)), null);
    });
  });

  it("returns null for an unreadable path", () => {
    assert.equal(checkShebang(path.join(tmp, "does-not-exist")), null);
  });

  it("returns null for invalid UTF-8", () => {
    const p = path.join(tmp, "invalid");
    writeFileSync(p, Buffer.from([0x23, 0x21, 0xff, 0x0a]));
    assert.equal(checkShebang(p), null);
  });
});

describe("tables", () => {
  it("has a display name for every Lang variant", () => {
    for (const variant of Object.values(Lang)) {
      assert.equal(typeof LANG_DISPLAY_NAME[variant], "string", variant);
      assert.equal(langDisplayName(variant), LANG_DISPLAY_NAME[variant]);
    }
  });

  it("has a comment config for every Lang variant except Unrecognized", () => {
    for (const variant of Object.values(Lang)) {
      if (variant === Lang.Unrecognized) continue;
      assert.ok(COMMENT_CONFIG[variant] !== undefined, variant);
      const cfg = counterConfigForLang(variant);
      assert.equal(cfg.singles.length, COMMENT_CONFIG[variant].singles.length);
      assert.equal(cfg.multis.length, COMMENT_CONFIG[variant].multis.length);
    }
  });

  it("reproduces the Rust `unreachable!()` for Unrecognized", () => {
    assert.throws(() => counterConfigForLang(Lang.Unrecognized), /unreachable/);
  });

  it("maps every extension to a known Lang", () => {
    for (const [ext, lang] of Object.entries(EXT_TO_LANG)) {
      assert.ok(Object.hasOwn(Lang, lang), `${ext} -> ${lang}`);
    }
  });

  it("does not resolve prototype properties as extensions", () => {
    assert.equal(langFromExt("evil.constructor"), Lang.Unrecognized);
    assert.equal(langFromExt("evil.__proto__"), Lang.Unrecognized);
  });

  it("keeps the documented display-name oddities", () => {
    assert.equal(LANG_DISPLAY_NAME.CCppHeader, "C/C++ Header");
    assert.equal(LANG_DISPLAY_NAME.CSharp, "C#");
    assert.equal(LANG_DISPLAY_NAME.Text, "Plain Text");
    assert.equal(LANG_DISPLAY_NAME.VimScript, "VimL");
    assert.equal(LANG_DISPLAY_NAME.Zsh, "Z Shell");
    assert.equal(LANG_DISPLAY_NAME.Tsx, "Typescript JSX");
    assert.equal(LANG_DISPLAY_NAME.ReStructuredText, "reStructuredText");
  });
});
