// Shared filesystem walker — bounded, skips noisy dirs, no symlink traversal.

const fs   = require("fs");
const path = require("path");

const SKIP = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "venv", ".venv", "env", "__pycache__",
  "dist", "build", "out", ".next", ".nuxt",
  ".cache", "coverage", ".turbo", ".parcel-cache"
]);

function walk(dir, exts, maxFiles = 1000, maxDepth = 8) {
  const out = [];
  const startStat = safeStat(dir);
  if (!startStat || !startStat.isDirectory()) {
    if (startStat && startStat.isFile() && exts.some(e => dir.endsWith(e))) {
      return [dir];
    }
    return [];
  }
  recurse(dir, 0);
  return out;

  function recurse(d, depth) {
    if (out.length >= maxFiles)  return;
    if (depth > maxDepth)        return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (SKIP.has(e.name))       continue;
      if (e.isSymbolicLink())     continue;       // do not follow symlinks
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        recurse(full, depth + 1);
      } else if (e.isFile()) {
        if (!exts.length || exts.some(ext => e.name.toLowerCase().endsWith(ext))) {
          out.push(full);
        }
      }
    }
  }
}

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// "abc\n def\n" + index 7 → line 2.
function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

// Total bytes of a directory, recursive, with same skip rules.
function dirSize(dir, maxFiles = 50_000) {
  let bytes = 0, count = 0;
  recurse(dir, 0);
  return { bytes, files: count };

  function recurse(d, depth) {
    if (count >= maxFiles || depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (count >= maxFiles) return;
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        recurse(full, depth + 1);
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(full);
          bytes += st.size;
          count++;
        } catch { /* ignore */ }
      }
    }
  }
}

module.exports = { walk, lineOf, dirSize, safeStat };
