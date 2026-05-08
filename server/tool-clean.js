// Real cleaner — measures and (optionally) deletes from a strict allowlist of
// well-known cache directories. Will NEVER touch user files.

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { dirSize } = require("./walker");

// Each category is a list of candidate paths; existing ones are summed/cleaned.
function categories() {
  const home = os.homedir();
  const tmp  = os.tmpdir();
  const local = process.env.LOCALAPPDATA  || path.join(home, "AppData", "Local");
  const roam  = process.env.APPDATA       || path.join(home, "AppData", "Roaming");

  return [
    { id: "temp", name: "Windows Temp Files", paths: [
      tmp,
      path.join(local, "Temp")
    ]},
    { id: "cache", name: "Chrome Cache", paths: [
      path.join(local, "Google", "Chrome", "User Data", "Default", "Cache"),
      path.join(local, "Google", "Chrome", "User Data", "Default", "Code Cache"),
      path.join(local, "Google", "Chrome", "User Data", "Default", "GPUCache")
    ]},
    { id: "ffcache", name: "Firefox Cache", paths: [
      path.join(local, "Mozilla", "Firefox", "Profiles")
    ], filter: f => /\\cache2\\/i.test(f) },
    { id: "edgecache", name: "Edge Cache", paths: [
      path.join(local, "Microsoft", "Edge", "User Data", "Default", "Cache"),
      path.join(local, "Microsoft", "Edge", "User Data", "Default", "Code Cache"),
      path.join(local, "Microsoft", "Edge", "User Data", "Default", "GPUCache")
    ]},
    { id: "prefetch", name: "Prefetch", paths: [
      path.join(process.env.SystemRoot || "C:\\Windows", "Prefetch")
    ]},
    { id: "dnscache", name: "DNS Cache", paths: [], dynamic: "dns" },
    { id: "thumbs", name: "Thumbnail Cache", paths: [
      path.join(local, "Microsoft", "Windows", "Explorer")
    ], filter: f => /thumbcache_|iconcache_/i.test(f) },
    { id: "logs", name: "Windows Event Logs", paths: [], dynamic: "logs" },
    { id: "recycle", name: "Recycle Bin", paths: [], dynamic: "recycle" }
  ];
}

function fmtBytes(b) {
  if (b >= 1024 * 1024 * 1024)  return (b / 1024 / 1024 / 1024).toFixed(2) + " GB";
  if (b >= 1024 * 1024)         return (b / 1024 / 1024).toFixed(0) + " MB";
  if (b >= 1024)                return (b / 1024).toFixed(0) + " KB";
  return b + " B";
}

function getCategorySize(cat) {
  let bytes = 0, files = 0;
  for (const p of cat.paths) {
    try { fs.accessSync(p); }
    catch { continue; }
    const st = dirSize(p);
    bytes += st.bytes;
    files += st.files;
  }
  return { bytes, files };
}

async function scan() {
  const cats = categories();
  return cats.map(c => {
    if (c.dynamic) {
      // dynamic categories don't have a measurable size from JS — give a synthetic small estimate
      return { id: c.id, name: c.name, bytes: 0, files: 0,
               display: "—", dynamic: c.dynamic, available: true };
    }
    const present = c.paths.some(p => { try { fs.accessSync(p); return true; } catch { return false; } });
    if (!present) return { id: c.id, name: c.name, bytes: 0, files: 0, display: "—", available: false };
    const { bytes, files } = getCategorySize(c);
    return { id: c.id, name: c.name, bytes, files, display: fmtBytes(bytes), available: true };
  });
}

// Recursively delete every file under each path of every selected category.
// Returns total bytes freed and a per-category breakdown.
async function clean(selectedIds, opts = {}) {
  const cats = categories().filter(c => selectedIds.includes(c.id));
  const result = { totalBytes: 0, totalFiles: 0, perCategory: [] };

  for (const c of cats) {
    const before = c.dynamic ? { bytes: 0, files: 0 } : getCategorySize(c);
    let freed   = 0;
    let removed = 0;

    if (c.dynamic === "dns") {
      // ipconfig /flushdns — tiny, instant, safe.
      try { await runCmd("ipconfig.exe", ["/flushdns"]); } catch {}
    } else if (c.dynamic === "recycle") {
      // PowerShell: Clear-RecycleBin -Force — won't error if empty.
      try {
        await runCmd("powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command",
           "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"]);
      } catch {}
    } else if (c.dynamic === "logs") {
      // Skipped — clearing event logs requires admin and removes audit data.
    } else {
      for (const p of c.paths) {
        try { fs.accessSync(p); } catch { continue; }
        const stats = wipeDir(p, c.filter);
        freed   += stats.freed;
        removed += stats.removed;
      }
    }

    const after = c.dynamic ? { bytes: 0, files: 0 } : getCategorySize(c);
    result.totalBytes += freed || (before.bytes - after.bytes);
    result.totalFiles += removed;
    result.perCategory.push({
      id:    c.id,
      name:  c.name,
      bytesFreed:    freed || (before.bytes - after.bytes),
      filesRemoved:  removed,
      display:       fmtBytes(freed || (before.bytes - after.bytes))
    });
  }
  result.display = fmtBytes(result.totalBytes);
  return result;
}

// Wipe every file inside `dir`, but never `dir` itself; tolerate locked files.
function wipeDir(dir, filter) {
  let freed = 0, removed = 0;
  recurse(dir);
  return { freed, removed };

  function recurse(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        recurse(full);
        // Try to remove the (now empty) directory, ignore failures.
        try { fs.rmdirSync(full); } catch {}
      } else if (e.isFile()) {
        if (filter && !filter(full)) continue;
        try {
          const st = fs.statSync(full);
          fs.unlinkSync(full);
          freed   += st.size;
          removed += 1;
        } catch { /* in-use or admin-only — skip */ }
      }
    }
  }
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process");
    const p = spawn(cmd, args, { windowsHide: true });
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error("exit " + code)));
    p.on("error", reject);
  });
}

module.exports = { scan, clean, fmtBytes };
