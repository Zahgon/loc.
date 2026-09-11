# loc-js

`loc-js` counts lines of code. It is a faithful JavaScript port of
[`cgag/loc`](https://github.com/cgag/loc) v0.5.0, a Rust implementation of
[cloc](http://cloc.sourceforge.net/).

> **Upstream deprecation notice, carried over from the original README**
>
> *2019-10-07:* "I really haven't been on top of accepting pull requests or
> looking at issues, you guys should definitely look at
> [scc](https://github.com/boyter/scc). It's faster and more accurate than this,
> and Boyter has written a great series of blog posts detailing how it got this
> way: <https://boyter.org/posts/sloc-cloc-code/>"
>
> *2018-03-08:* "[tokei](https://github.com/XAMPPRocky/tokei) is smarter and more
> accurate so please give that a look and see if there are any wild
> discrepancies."
>
> Those recommendations still stand. This port exists to make `loc`'s exact
> behaviour — quirks included — available to JavaScript tooling without a Rust
> toolchain.

## Installation

```sh
npm install --global loc-js   # then: loc
npx loc-js                    # or without installing
npm install loc-js            # as a library
```

Requires Node.js 18 or newer. No runtime dependencies.

## Usage

By default `loc` counts the current directory:

```sh
$ loc
--------------------------------------------------------------------------------
 Language             Files        Lines        Blank      Comment         Code
--------------------------------------------------------------------------------
 Lua                      2       387088        24193       193544       169351
 C                        5        45372         8923         3947        32502
 JavaScript              26         5132          450         1071         3611
 Markdown                 2          212           43            0          169
 Terraform                1           89           13           11           65
 JSON                     1           44            0            0           44
 Ada                      2           53           12            9           32
 Solidity                 1           16            3            3           10
 Gherkin                  1           12            2            2            8
 Groovy                   1           17            1           10            6
 Zig                      1            9            2            2            5
 Nix                      1            8            2            3            3
 OCaml                    1           13            4            6            3
 Reason                   1           13            4            6            3
 Handlebars               1            4            0            2            2
 Haskell                  1           14            4            8            2
 PowerShell               1            9            1            6            2
 Python                   1            6            2            2            2
 Ruby                     1            4            0            2            2
--------------------------------------------------------------------------------
 Total                   51       438115        33659       198634       205822
--------------------------------------------------------------------------------
```

Pass one or many targets:

```sh
$ loc src bin
--------------------------------------------------------------------------------
 Language             Files        Lines        Blank      Comment         Code
--------------------------------------------------------------------------------
 JavaScript              15         3142          245          774         2123
--------------------------------------------------------------------------------
 Total                   15         3142          245          774         2123
--------------------------------------------------------------------------------
```

Use `--files` for a per-file breakdown:

```sh
$ loc --files src
--------------------------------------------------------------------------------
 Language             Files        Lines        Blank      Comment         Code
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
 JavaScript              14         3138          244          774         2120
--------------------------------------------------------------------------------
|src/tables.js                      624            6           17          601
|src/args.js                        323           31           66          226
|src/cli.js                         290           30           47          213
|src/walk.js                        363           37          123          203
|src/rust-regex.js                  261           23           74          164
|src/counter.js                     255           30           72          153
|src/gitignore.js                   285           24          116          145
|src/pool.js                        153           16           39           98
|src/utf8.js                        159            8           61           90
|src/lang.js                        137           15           46           76
|src/format.js                      134            8           64           62
|src/worker.js                       57            8           10           39
|src/path.js                         74            6           35           33
|src/index.js                        23            2            4           17
```

Columns are sorted by `Code` descending. Choose another with `--sort`
(`Code`, `Comment`, `Blank`, `Lines`, and — outside `--files` mode —
`Language` and `Files`):

```sh
$ loc --files --sort Comment test/differential
--------------------------------------------------------------------------------
 Language             Files        Lines        Blank      Comment         Code
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
 JavaScript               2          453           43          111          299
--------------------------------------------------------------------------------
|test/differential/run.mjs          291           29           56          206
|erential/make-torture.mjs          162           14           55           93
```

`--include` and `--exclude` take regular expressions matched against each path:

```sh
$ loc --include 'count'
--------------------------------------------------------------------------------
 Language             Files        Lines        Blank      Comment         Code
--------------------------------------------------------------------------------
 JavaScript               3          473           58           94          321
--------------------------------------------------------------------------------
 Total                    3          473           58           94          321
--------------------------------------------------------------------------------
```

### Options

```
loc 0.5.0
Curtis Gagliardi <curtis@curtis.io>
counts things quickly hopefully

USAGE:
    loc [FLAGS] [OPTIONS] [--] [target]...

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
```

Note that `--include` and `--exclude` are greedy, exactly as in the original:
`loc --exclude foo .` treats `.` as a *second* exclude pattern rather than a
target. Use `--` or put the target first: `loc . --exclude foo`.

## Ignored and hidden files

By default `loc` respects `.gitignore` and `.ignore` files and skips hidden
files and directories.

* `-u` stops honouring ignore files.
* `-uu` additionally counts hidden files and directories.

Two inherited subtleties: `.gitignore` files only take effect inside a git
repository (`.ignore` files work anywhere), and your *global* gitignore applies
even under `-uu`.

## Library API

```js
import { count, langFromExt, Lang } from "loc-js";

const lang = langFromExt("src/main.rs");   // "Rust"
const c = count("src/main.rs");            // { code, comment, blank, lines }
```

`count()` returns an all-zero result for a missing or unreadable file, and for
any file that is not valid UTF-8.

## Performance

Measured over a 206 MiB corpus of ten repositories (Node 22, Apple Silicon):

| | best of 3 |
|---|---|
| `loc` (Rust, release) | 186 ms |
| `loc-js` | 552 ms |

About 3x the Rust runtime. Counting is the fast part; most of the gap is
directory walking and process startup. Run `npm run bench` to reproduce.

## Equivalence with the Rust original

The Rust original is vendored unmodified under [`source_rust/`](source_rust) so
the reference implementation stays available for verification. Nothing in the
shipped package reads it; it is needed only by `npm run test:diff`,
`npm run check:tables` and `npm run bench`, and it is excluded from the npm
tarball.

`npm run test:diff` builds that Rust binary and compares both implementations
across a corpus of repositories and a 25-entry argument matrix, checking stdout,
stderr and exit codes. `node test/differential/make-torture.mjs` generates a
synthetic tree covering gitignore negation, anchored and `**` patterns, CRLF,
BOMs, invalid UTF-8, non-ASCII paths, shebang detection, dotfiles and symlinks.

Every intentional deviation is documented in [DIFFERENCES.md](DIFFERENCES.md).
Bugs in the original are reproduced on purpose and marked `// BUG-COMPAT:` in
the source.

The `Lang` enum, the extension table, the per-language comment configuration and
the shebang table are **generated** from the Rust source by
`tools/gen-tables.mjs`. `npm run check:tables` fails if `src/tables.js` drifts.

## Known issues

Inherited from the original:

* Fortran comment markers are only required to be the first non-whitespace
  character of a line rather than the first character.
* Comment delimiters inside string literals are not recognised as strings, so
  the middle of a multi-line string containing `/*` is counted as comment.
* A file containing any invalid UTF-8 counts as zero lines.

## Supported languages

- ActionScript
- Ada
- Agda
- AmbientTalk
- ASP
- ASP.NET
- Assembly
- Autoconf
- Awk
- Batch
- Bourne Shell
- C
- C Shell
- C#
- C++
- C/C++ Header
- Clojure
- ClojureC
- ClojureScript
- CMake
- CoffeeScript
- ColdFusion
- ColdFusionScript
- Coq
- Crystal
- CSS
- CUDA
- CUDA Header
- D
- Dart
- DeviceTree
- Dhall
- Docker
- Elixir
- Elm
- Erlang
- F#
- Forth
- FORTRAN Legacy
- FORTRAN Modern
- Gherkin
- GLSL
- Go
- Groovy
- Handlebars
- Haskell
- Haxe
- Hex
- HTML
- Idris
- INI
- Intel Hex
- Isabelle
- Jai
- Java
- JavaScript
- JSON
- Jsx
- Julia
- Kotlin
- Lean
- Less
- LinkerScript
- Lisp
- Lua
- Make
- Makefile
- Markdown
- Mustache
- Nim
- Nix
- Objective-C
- Objective-C++
- OCaml
- OpenCL
- Oz
- Pascal
- Perl
- PHP
- Plain Text
- Polly
- PowerShell
- Prolog
- Protobuf
- Puppet
- PureScript
- Pyret
- Python
- Qcl
- Qml
- R
- Razor
- Reason
- reStructuredText
- RON
- Ruby
- RubyHtml
- Rust
- SaltStack
- Sass
- Scala
- SML
- Solidity
- SQL
- Stylus
- Svelte
- Swift
- Tcl
- Terraform
- TeX
- Toml
- TypeScript
- Typescript JSX
- UnrealScript
- VimL
- Vue
- Wolfram
- XML
- Yacc
- YAML
- Z Shell
- Zig

## License

MIT. Copyright (c) 2016 Curtis Gagliardi for the original Rust implementation;
this port carries the same license.
