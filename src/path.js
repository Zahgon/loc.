// Reimplementations of the two `std::path::Path` methods `lang_from_ext`
// depends on. Node's `path.basename` / `path.extname` do NOT match Rust and
// silently produce different languages for dotfiles, so they are not used.

const IS_WINDOWS = process.platform === "win32";

/**
 * @param {string} ch
 * @returns {boolean}
 */
function isSeparator(ch) {
  return ch === "/" || (IS_WINDOWS && ch === "\\");
}

/**
 * `Path::file_name()`.
 *
 * Returns the final `Component::Normal` of the path, or `null` when there is
 * none. Trailing separators and `.` components are skipped; a trailing `..`
 * yields `null` (Rust returns `None` because `..` is a `ParentDir`, not a
 * `Normal`, component).
 *
 *   "foo/bar"  -> "bar"      "foo/bar/" -> "bar"     "foo/."  -> "foo"
 *   "foo/.."   -> null       "/"        -> null      ""       -> null
 *   "."        -> null       ".."       -> null      "a//b"   -> "b"
 *
 * @param {string} filepath
 * @returns {string | null}
 */
export function rustFileName(filepath) {
  /** @type {string[]} */
  const components = [];
  let current = "";
  for (const ch of filepath) {
    if (isSeparator(ch)) {
      if (current.length > 0) components.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0) components.push(current);

  for (let i = components.length - 1; i >= 0; i -= 1) {
    const c = components[i];
    if (c === ".") continue;
    if (c === "..") return null;
    return c;
  }
  return null;
}

/**
 * `Path::extension()`.
 *
 * Rust splits the file name at the LAST `.`; if the part before that dot is
 * empty the whole name is treated as the stem and there is no extension.
 *
 *   "foo.tar.gz" -> "gz"     "foo"   -> null    ".gitignore" -> null
 *   "foo."       -> ""       "..."   -> ""      ".."         -> null
 *
 * @param {string} filepath
 * @returns {string | null}
 */
export function rustExtension(filepath) {
  const fileName = rustFileName(filepath);
  if (fileName === null) return null;
  if (fileName === "..") return null;

  const dot = fileName.lastIndexOf(".");
  if (dot === -1) return null; // no dot at all -> `before` is None
  if (dot === 0) return null; // `before` is "" -> whole name is the stem
  return fileName.slice(dot + 1);
}
