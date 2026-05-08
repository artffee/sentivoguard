// SentivoGuard — dev server with REAL backend APIs.
// Standard library only — no npm install.
//
// Endpoints:
//   GET  /api/health                   — backend identity
//   GET  /api/connections              — real TCP connections (PowerShell)
//   GET  /api/clean/scan               — real cache sizes per category
//   POST /api/clean/run   {ids: [...]} — actually delete from selected cats
//   POST /api/scan/folder {target: x}  — real folder scan
//   POST /api/scan/npm    {target: x}  — real npm scan (path to a package dir)
//   *                                  — static files

const http = require("http");
const fs   = require("fs");
const path = require("path");
const url  = require("url");

const { getConnections } = require("./server/tool-netstat");
const { scan: cleanScan, clean: cleanRun } = require("./server/tool-clean");
const { scanFolder }    = require("./server/scanner-folder");
const { scanNpm }       = require("./server/scanner-npm");
const { scanPip }       = require("./server/scanner-pip");
const { scanGem }       = require("./server/scanner-gem");
const { scanGithub }    = require("./server/scanner-github");
const { scanDocker }    = require("./server/scanner-docker");
const { scanExtension } = require("./server/scanner-extension");
const { scanDisk, quickScanPaths } = require("./server/scanner-disk");
const Q   = require("./server/quarantine");
const VT  = require("./server/tool-virustotal");
const W   = require("./server/tool-watcher");
const L   = require("./server/license");
const OS_ = require("./server/tool-os");

// Start the real-time watcher daemon as soon as the server boots.
W.start();

const ROOT = __dirname;
const PORT = (process.env.SG_PORT && Number(process.env.SG_PORT)) || 4173;
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".pdf":  "application/pdf"
};

// ─── Helpers ────────────────────────────────────────────────────────

function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({
    "access-control-allow-origin":  "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  }, headers));
  res.end(body);
}

function json(res, status, obj) {
  send(res, status, { "content-type": "application/json" }, JSON.stringify(obj));
}

function readBody(req, max = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > max) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new Error("invalid_json"); }
}

// ─── API handlers ───────────────────────────────────────────────────

async function api(req, res, pathname) {
  // CORS preflight
  if (req.method === "OPTIONS") return send(res, 204, {}, "");

  try {
    if (pathname === "/api/health" && req.method === "GET") {
      // Report whether cross-device login (Upstash KV) is available — the
      // marketing pages use this to show the right messaging.
      let crossDevice = false;
      try { crossDevice = require("./lib/store").configured(); } catch {}
      return json(res, 200, {
        ok:       true,
        platform: process.platform,
        node:     process.version,
        version:  "2.1.0",
        capabilities: {
          connections:      process.platform === "win32",
          clean:            true,
          scanNpm:          true,
          scanFolder:       true,
          crossDeviceLogin: crossDevice
        }
      });
    }

    if (pathname === "/api/connections" && req.method === "GET") {
      const r = await getConnections();
      return json(res, 200, r);
    }

    if (pathname === "/api/clean/scan" && req.method === "GET") {
      const cats = await cleanScan();
      return json(res, 200, { ok: true, categories: cats });
    }

    if (pathname === "/api/clean/run" && req.method === "POST") {
      const body = await readJson(req);
      if (!Array.isArray(body.ids) || !body.ids.length) {
        return json(res, 400, { ok: false, error: "no_categories_selected" });
      }
      const result = await cleanRun(body.ids);
      return json(res, 200, Object.assign({ ok: true }, result));
    }

    if (pathname === "/api/scan/folder" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.target) return json(res, 400, { ok: false, error: "missing_target" });
      const r = await scanFolder(body.target);
      return json(res, 200, r);
    }

    if (pathname === "/api/scan/npm" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.target) return json(res, 400, { ok: false, error: "missing_target" });
      const r = await scanNpm(body.target);
      return json(res, 200, r);
    }

    if (pathname === "/api/scan/pip" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.target) return json(res, 400, { ok: false, error: "missing_target" });
      return json(res, 200, await scanPip(body.target));
    }

    if (pathname === "/api/scan/gem" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.target) return json(res, 400, { ok: false, error: "missing_target" });
      return json(res, 200, await scanGem(body.target));
    }

    if (pathname === "/api/scan/github" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.target) return json(res, 400, { ok: false, error: "missing_target" });
      return json(res, 200, await scanGithub(body.target));
    }

    if (pathname === "/api/scan/docker" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.target) return json(res, 400, { ok: false, error: "missing_target" });
      return json(res, 200, await scanDocker(body.target));
    }

    if (pathname === "/api/scan/extension" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.target) return json(res, 400, { ok: false, error: "missing_target" });
      return json(res, 200, await scanExtension(body.target));
    }

    // ── OS tools (read-only status) ─────────────────────────────
    if (pathname === "/api/tool/defend"  && req.method === "GET")
      return json(res, 200, await OS_.defendStatus());
    if (pathname === "/api/tool/dns"     && req.method === "GET")
      return json(res, 200, await OS_.dnsStatus());
    if (pathname === "/api/tool/drivers" && req.method === "GET")
      return json(res, 200, await OS_.driversList());
    if (pathname === "/api/tool/wall"    && req.method === "GET")
      return json(res, 200, await OS_.firewallStatus());
    if (pathname === "/api/tool/block"   && req.method === "GET")
      return json(res, 200, OS_.hostsStatus());

    if (pathname === "/api/scan/disk/preset" && req.method === "GET") {
      return json(res, 200, { ok: true, paths: quickScanPaths() });
    }

    // ── License ─────────────────────────────────────────────────
    if (pathname === "/api/license/verify" && req.method === "POST") {
      const body = await readJson(req);
      const r = L.verify(body.token || "");
      // Don't echo full payload to renderer if invalid — just the error code.
      if (!r.ok) return json(res, 200, { ok: false, error: r.error });
      return json(res, 200, {
        ok:       true,
        email:    r.payload.sub,
        plan:     r.payload.plan,
        devices:  r.payload.devices,
        expires:  r.payload.exp,
        tier:     r.tier
      });
    }

    // ── Real-time watcher ───────────────────────────────────────
    if (pathname === "/api/realtime/status" && req.method === "GET") {
      return json(res, 200, { ok: true, ...W.status() });
    }
    if (pathname === "/api/realtime/recent" && req.method === "GET") {
      return json(res, 200, { ok: true, events: W.recent(100) });
    }
    if (pathname === "/api/realtime/start" && req.method === "POST") {
      W.start(); return json(res, 200, { ok: true });
    }
    if (pathname === "/api/realtime/stop" && req.method === "POST") {
      W.stop();  return json(res, 200, { ok: true });
    }
    if (pathname === "/api/realtime/events" && req.method === "GET") {
      // Server-Sent Events stream.
      res.writeHead(200, {
        "content-type":               "text/event-stream",
        "cache-control":              "no-cache",
        "connection":                 "keep-alive",
        "x-accel-buffering":          "no",
        "access-control-allow-origin": "*"
      });
      // Initial hello + recent backlog so the UI has context immediately.
      res.write("data: " + JSON.stringify({ type: "hello", status: W.status() }) + "\n\n");
      for (const ev of W.recent(20).reverse()) {
        res.write("data: " + JSON.stringify(ev) + "\n\n");
      }
      const keepAlive = setInterval(() => {
        try { res.write(": ping\n\n"); } catch {}
      }, 25_000);
      const unsub = W.subscribe(ev => {
        try { res.write("data: " + JSON.stringify(ev) + "\n\n"); }
        catch {}
      });
      req.on("close", () => { unsub(); clearInterval(keepAlive); });
      return;
    }

    // ── VirusTotal ──────────────────────────────────────────────
    if (pathname === "/api/virustotal/status" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        configured: VT.hasKey(),
        rate: VT.rateStatus()
      });
    }

    if (pathname === "/api/virustotal/key" && req.method === "POST") {
      const body = await readJson(req);
      if (typeof body.key !== "string") return json(res, 400, { ok: false, error: "missing_key" });
      VT.saveKey(body.key);
      return json(res, 200, { ok: true, configured: VT.hasKey() });
    }

    if (pathname === "/api/virustotal/key" && req.method === "DELETE") {
      VT.clearKey();
      return json(res, 200, { ok: true });
    }

    if (pathname === "/api/virustotal/lookup" && req.method === "POST") {
      const body = await readJson(req);
      if (body.sha256) return json(res, 200, await VT.lookupHash(body.sha256));
      if (body.path)   return json(res, 200, await VT.lookupFile(body.path));
      return json(res, 400, { ok: false, error: "missing_sha256_or_path" });
    }

    // ── Quarantine ──────────────────────────────────────────────
    if (pathname === "/api/quarantine" && req.method === "GET") {
      return json(res, 200, Q.list());
    }

    if (pathname === "/api/quarantine" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.path) return json(res, 400, { ok: false, error: "missing_path" });
      const r = await Q.quarantineOne(body.path, body.reason || "", body.finding || null);
      return json(res, r.ok ? 200 : 400, r);
    }

    if (pathname === "/api/quarantine/bulk" && req.method === "POST") {
      const body = await readJson(req);
      if (!Array.isArray(body.items) || !body.items.length)
        return json(res, 400, { ok: false, error: "no_items" });
      const r = await Q.quarantineMany(body.items);
      return json(res, 200, r);
    }

    if (pathname === "/api/quarantine/restore" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.id) return json(res, 400, { ok: false, error: "missing_id" });
      const r = await Q.restoreOne(body.id, { force: !!body.force });
      return json(res, r.ok ? 200 : 400, r);
    }

    if (pathname === "/api/quarantine/delete" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.id) return json(res, 400, { ok: false, error: "missing_id" });
      const r = await Q.deleteOne(body.id);
      return json(res, r.ok ? 200 : 400, r);
    }

    if (pathname === "/api/whitelist" && req.method === "GET") {
      return json(res, 200, Q.whitelistList());
    }

    if (pathname === "/api/whitelist" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.path) return json(res, 400, { ok: false, error: "missing_path" });
      return json(res, 200, Q.whitelistAdd(body.path));
    }

    if (pathname === "/api/whitelist/remove" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.path) return json(res, 400, { ok: false, error: "missing_path" });
      return json(res, 200, Q.whitelistRemove(body.path));
    }

    if (pathname === "/api/scan/disk" && req.method === "POST") {
      const body = await readJson(req);
      // NDJSON streaming response — one JSON object per line.
      res.writeHead(200, {
        "content-type":               "application/x-ndjson",
        "cache-control":              "no-cache",
        "x-accel-buffering":          "no",
        "access-control-allow-origin": "*"
      });

      const opts = {
        quick:    body.quick !== false,
        target:   body.target || null,
        maxFiles: Math.min(Number(body.maxFiles) || 50_000, 200_000),
        aborted:  false
      };

      // If the client disconnects mid-stream, the next yield short-circuits.
      req.on("close", () => { opts.aborted = true; });
      req.on("aborted", () => { opts.aborted = true; });

      try {
        for await (const ev of scanDisk(opts)) {
          if (opts.aborted) break;
          if (!res.write(JSON.stringify(ev) + "\n")) {
            await new Promise(r => res.once("drain", r));
          }
        }
      } catch (e) {
        try { res.write(JSON.stringify({ type: "error", error: e.message }) + "\n"); } catch {}
      }
      try { res.end(); } catch {}
      return;
    }

    json(res, 404, { ok: false, error: "not_found", pathname });
  } catch (e) {
    json(res, 500, { ok: false, error: "server_error", detail: e.message });
  }
}

// ─── Static handler ─────────────────────────────────────────────────

function serveStatic(req, res, pathname) {
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const file = path.join(ROOT, decodeURIComponent(pathname));
  if (!file.startsWith(ROOT)) return send(res, 403, {}, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, {}, "Not found: " + pathname);
    send(res, 200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }, data);
  });
}

// ─── Server ─────────────────────────────────────────────────────────

http.createServer((req, res) => {
  const u = url.parse(req.url || "/");
  const pathname = u.pathname || "/";
  if (pathname.startsWith("/api/")) return api(req, res, pathname);
  serveStatic(req, res, pathname);
}).listen(PORT, HOST, () => {
  console.log("SentivoGuard backend: http://" + HOST + ":" + PORT);
  console.log("  GET  /api/health");
  console.log("  GET  /api/connections          (real netstat)");
  console.log("  GET  /api/clean/scan           (real cache sizes)");
  console.log("  POST /api/clean/run            {ids:[...]}");
  console.log("  POST /api/scan/folder          {target:'<path>'}");
  console.log("  POST /api/scan/npm             {target:'<path-to-pkg>'}");
  console.log("  GET  /api/scan/disk/preset     (returns the quick-scan path list)");
  console.log("  POST /api/scan/disk            {quick:true|target:'<path>'}  — NDJSON stream");
  console.log("  GET  /api/quarantine           (list)  · POST quarantine/restore/delete");
  console.log("  GET  /api/virustotal/status    · POST /api/virustotal/lookup {sha256|path}");
  console.log("  GET  /api/realtime/events      (SSE stream of file events)");
});
