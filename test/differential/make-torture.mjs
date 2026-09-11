#!/usr/bin/env node
// Build a synthetic corpus exercising the edge cases real repositories do not
// reliably contain: gitignore negation, nested/anchored patterns, CRLF, BOMs,
// invalid UTF-8, non-ASCII paths and content, shebang detection, dotfiles and
// symlinks.
//
//   node test/differential/make-torture.mjs [outDir]

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? "/tmp/loc-torture";

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/**
 * @param {string} rel
 * @param {string | Buffer} contents
 */
function write(rel, contents) {
  const full = path.join(outDir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

// --- gitignore semantics ----------------------------------------------------
write(
  ".gitignore",
  [
    "build/",
    "*.tmp.c",
    "!keep.tmp.c",
    "/rootonly.c",
    "deep/**/gen.c",
    "**/anywhere.c",
    "spaced\\ name.c",
    "# a comment",
    "",
    "  ",
    "brack[0-9].c",
  ].join("\n") + "\n",
);
write(".ignore", "!/.hidden-but-whitelisted/\nlocal-only.py\n");
write("nested/.gitignore", "sub.c\n!important.sub.c\n");

write("keep.tmp.c", "int keep(void) { return 1; }\n");
write("drop.tmp.c", "int drop(void) { return 0; }\n");
write("rootonly.c", "int root_only;\n");
write("sub/rootonly.c", "int not_root_only;\n");
write("build/ignored.c", "int ignored;\n");
write("deep/a/b/gen.c", "int generated;\n");
write("anywhere.c", "int a;\n");
write("x/y/anywhere.c", "int b;\n");
write("spaced name.c", "int spaced;\n");
write("brack7.c", "int bracket;\n");
write("brackX.c", "int not_bracket;\n");
write("nested/sub.c", "int sub;\n");
write("nested/important.sub.c", "int important;\n");
write("local-only.py", "print('ignored by .ignore')\n");
write(".hidden-but-whitelisted/inside.c", "int whitelisted;\n");
write(".plain-hidden/inside.c", "int hidden;\n");
write(".hiddenfile.c", "int hidden_file;\n");

// --- line endings, BOMs, terminators ---------------------------------------
write("eol/crlf.c", "/* c */\r\nint crlf;\r\n\r\n// tail\r\n");
write("eol/no-trailing-newline.c", "int last_line_has_no_newline;");
write("eol/empty.c", "");
write("eol/only-newlines.c", "\n\n\n");
write("eol/bom.c", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("int after_bom;\n")]));
write("eol/lone-cr.c", "int a;\rint b;\n");

// --- encoding ---------------------------------------------------------------
write("enc/invalid-utf8.c", Buffer.from([0x69, 0x6e, 0x74, 0x20, 0xff, 0xfe, 0x3b, 0x0a]));
write(
  "enc/utf8-comments.c",
  "/* héllo wörld — ünïcode */\nint café = 1; // ☕ comment\n/* 日本語のコメント */\nint 未使用;\n",
);
write("enc/utf8-in-multiline.c", "/* α\nβ */ int after;\n");
write("enc/héllo-wörld-with-a-very-long-ünïcode-name.c", "int long_unicode_path;\n");
write("enc/日本語.c", "int japanese_path;\n");
write("enc/nbsp-indent.c", "\u00a0int nbsp_indented;\n\u30001;\n");

// --- shebang detection ------------------------------------------------------
write("shebang/python_no_ext", "#!/usr/bin/env python3\nx = 1  # comment\n");
write("shebang/bash_no_ext", "#!/bin/bash\necho hi # comment\n");
write("shebang/node_no_ext", "#!/usr/bin/env node\n// comment\nconsole.log(1);\n");
write("shebang/ruby_no_ext", "#!/usr/bin/ruby\n=begin\nblock\n=end\nputs 1\n");
write("shebang/near-miss_no_ext", "#!/usr/bin/env python3.11\nx = 1\n");
write("shebang/trailing-space_no_ext", "#!/bin/bash \necho hi\n");
write("shebang/crlf_no_ext", "#!/bin/bash\r\necho hi\n");

// --- filename-driven detection ---------------------------------------------
write("names/Makefile", "all:\n\t# not a comment to make\n\techo hi\n");
write("names/GNUmakefile", "all:\n\techo hi\n");
write("names/Makefile.am", "SUBDIRS = .\n");
write("names/Dockerfile", "# comment\nFROM scratch\n");
write("names/CMakeLists.txt", "# comment\nproject(x)\n#[[ block\ncomment ]]\nadd_library(x)\n");
write("names/.gitattributes", "* text=auto\n");
write("names/noext", "just text\n");
write("names/trailing.", "int weird;\n");
write("names/a.b.c.d", "unknown extension chain\n");
write("names/UPPER.C", "int upper_ext;\n");
write("names/mixed.Rb", "puts 1\n");

// --- comment torture --------------------------------------------------------
write(
  "comments/nested.hs",
  "{- outer {- inner -} still outer -}\nmain = return ()\n{- multi\nline\n-}\n",
);
write(
  "comments/mixed.c",
  [
    "int a; /* trailing */",
    "/* leading */ int b;",
    "int c; // line",
    "/* unterminated",
    "still inside",
    "*/ int d;",
    "/**/int e;",
    "/* a */ /* b */ int f;",
    "// /* not a block */",
    "/* // not a line */ int g;",
  ].join("\n") + "\n",
);
write(
  "comments/quotes.py",
  ["'''", "docstring", "'''", "x = 1  # trailing", "s = '''inline'''", "# full line"].join("\n") + "\n",
);
write("comments/pascal.pas", "(* block *)\n// line\n{ curly }\nbegin end.\n");
write("comments/isabelle.thy", "(* ml *)\n{* alt *}\n\\<open>angle\\<close>\nterm x\n");
write("comments/lua.lua", "--[[ block\nstill ]]\n-- line\nprint(1)\n");
write("comments/vim.vim", '" comment\nset nu\n');
write("comments/fortran.f", "c legacy comment\nC also\n! bang\n* star\n      program x\n");
write("comments/coffee.coffee", "###\nblock\n###\n# line\nx = 1\n");
write("comments/cmake-block.cmake", "#[[ block\ncomment ]]\nset(x 1)\n");
write("comments/forth.4th", "\\ line comment\n( paren comment )\n: foo ;\n");
write("comments/perl.pl", "=pod\npodtext\n=cut\nprint 1; # comment\n");
write("comments/asp.asa", "' comment\nREM comment\nresponse.write 1\n");
write("comments/text.txt", "no comment syntax\n\nat all\n");
write("comments/data.json", '{\n  "a": 1\n}\n');
write("comments/empty-lang.md", "# Heading\n\nBody\n");

// --- symlinks ---------------------------------------------------------------
try {
  symlinkSync(path.join(outDir, "keep.tmp.c"), path.join(outDir, "link-to-file.c"));
  mkdirSync(path.join(outDir, "linktarget"), { recursive: true });
  writeFileSync(path.join(outDir, "linktarget/inside.c"), "int inside_link;\n");
  symlinkSync(path.join(outDir, "linktarget"), path.join(outDir, "link-to-dir"));
  symlinkSync(path.join(outDir, "nowhere"), path.join(outDir, "broken-link.c"));
} catch {
  process.stderr.write("symlinks unavailable; skipping\n");
}

// Making it a real repository matters: `require_git` defaults to true, so
// .gitignore files are inert outside one.
execFileSync("git", ["init", "-q", "."], { cwd: outDir });
writeFileSync(path.join(outDir, ".git/info/exclude"), "excluded-by-git-info.c\n");
write("excluded-by-git-info.c", "int excluded;\n");

process.stdout.write(`${outDir}\n`);
