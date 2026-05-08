// SentivoGuard — real-time file watcher daemon.
// Watches Downloads + Temp + AppData/Roaming for new files, runs cheap
// heuristics (filename + location + size), and pushes findings to subscribed
// SSE clients via the eventBus.

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const { SUSPICIOUS_NAMES, locationRisk, EXTS } = require("./patterns");
const { isWhitelisted } = require("./quarantine");

// ─── Pub/sub event bus ─────────────────────────────────────────────

const subscribers = new Set();
function subscribe(cb) { subscribers.add(cb); return () => subscribers.delete(cb); }
function publish(ev)   { for (const cb of subscribers) { try { cb(ev); } catch {} } }

// ─── Watcher state ─────────────────────────────────────────────────

const state = {
  running: false,
  watchers: [],
  paths:   [],
  recentEvents: [],     // ring buffer (last 200)
  startedAt: null,
  totalEvents: 0,
  totalFindings: 0
};

const MAX_RECENT = 200;

// Debounce: same path within N ms → single event.
const debounceMs = 1500;
const lastSeen = new Map();

function defaultPaths() {
  const home  = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const roam  = process.env.APPDATA       || path.join(home, "AppData", "Roaming");
  return [
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    os.tmpdir(),
    path.join(local, "Temp"),
    roam
  ].filter(p => safeExists(p));
}

function safeExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function isInteresting(filePath) {
  const lower = filePath.toLowerCase();
  return EXTS.disk_text  .some(e => lower.endsWith(e)) ||
         EXTS.disk_binary.some(e => lower.endsWith(e));
}

function inspect(filePath) {
  const findings = [];
  const base = path.basename(filePath);

  for (const rule of SUSPICIOUS_NAMES) {
    if (rule.rx.test(base)) {
      findings.push({ severity: rule.severity, message: rule.message, kind: "name" });
      break;
    }
  }

  const loc = locationRisk(filePath);
  if (loc) findings.push({ severity: loc.severity, message: loc.message, kind: "location" });

  return findings;
}

function record(ev) {
  state.recentEvents.unshift(ev);
  if (state.recentEvents.length > MAX_RECENT) state.recentEvents.pop();
  state.totalEvents++;
  if (ev.findings && ev.findings.length) state.totalFindings++;
  publish(ev);
}

function start(paths) {
  if (state.running) return state;
  state.paths = (paths && paths.length ? paths : defaultPaths()).slice(0, 8);
  state.startedAt = Date.now();

  for (const p of state.paths) {
    let w;
    try {
      w = fs.watch(p, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const full = path.join(p, filename);

        // Debounce
        const now = Date.now();
        const last = lastSeen.get(full) || 0;
        if (now - last < debounceMs) return;
        lastSeen.set(full, now);

        // Only flag files that exist (filter out deletes)
        let stat;
        try { stat = fs.statSync(full); } catch { return; }
        if (!stat.isFile()) return;
        if (isWhitelisted(full)) return;
        if (!isInteresting(full)) return;

        const findings = inspect(full);
        const ev = {
          type:     "file_event",
          eventType,
          path:     full,
          name:     path.basename(full),
          size:     stat.size,
          mtime:    stat.mtimeMs,
          watchedRoot: p,
          findings,
          ts:       now
        };
        record(ev);
      });
    } catch (e) {
      publish({ type: "error", message: "Could not watch " + p + ": " + e.message, ts: Date.now() });
      continue;
    }
    if (w) state.watchers.push(w);
  }

  state.running = state.watchers.length > 0;
  publish({ type: "started", paths: state.paths, ts: Date.now() });
  return state;
}

function stop() {
  for (const w of state.watchers) {
    try { w.close(); } catch {}
  }
  state.watchers = [];
  state.running = false;
  publish({ type: "stopped", ts: Date.now() });
}

function status() {
  return {
    running:        state.running,
    paths:          state.paths,
    startedAt:      state.startedAt,
    totalEvents:    state.totalEvents,
    totalFindings:  state.totalFindings,
    recentCount:    state.recentEvents.length,
    subscribers:    subscribers.size
  };
}

function recent(limit = 50) {
  return state.recentEvents.slice(0, Math.min(limit, MAX_RECENT));
}

module.exports = {
  start, stop, status, recent,
  subscribe,
  defaultPaths,
  isInteresting
};
